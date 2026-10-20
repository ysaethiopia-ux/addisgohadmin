const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const { neon } = require("@neondatabase/serverless");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is missing. API calls to Neon will fail until it is configured.");
}

const sql = neon(process.env.DATABASE_URL || "postgresql://invalid");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function parseLimit(rawLimit, fallback = 100) {
  const value = Number(rawLimit);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, 1000);
}

function sanitizeText(input, maxLength = 255) {
  if (input === null || input === undefined) return "";

  const collapsed = String(input)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed.slice(0, maxLength);
}

function sanitizeOptionalText(input, maxLength = 255) {
  const text = sanitizeText(input, maxLength);
  return text.length ? text : null;
}

function sanitizeEmail(input) {
  const value = sanitizeText(input, 320).toLowerCase();
  return value;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizePhone(input) {
  return sanitizeText(input, 30).replace(/[\s()-]/g, "");
}

function isValidPhone(phone) {
  const cleaned = sanitizePhone(phone);
  const startsCorrectly = cleaned.startsWith("09") || cleaned.startsWith("+251");
  const digitsOnly = cleaned.replace(/\D/g, "");
  return startsCorrectly && digitsOnly.length >= 10;
}

function requireValidPhone(phone) {
  const cleaned = sanitizePhone(phone);
  if (!isValidPhone(cleaned)) {
    throw new Error("Phone must start with 09 or +251 and include at least 10 digits");
  }
  return cleaned;
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function parseDataImageUri(uri) {
  const raw = String(uri || "").trim();
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data image URI format");
  }

  const contentType = match[1];
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, "base64");

  if (!buffer.length) {
    throw new Error("Data image payload is empty");
  }

  return { contentType, buffer };
}

function isAllowedScreenshotHost(hostname) {
  return hostname.endsWith(".blob.vercel-storage.com");
}

async function fetchBlobImage(url) {
  const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_TOKEN || "";

  const attempts = [];
  if (token) {
    attempts.push({ Authorization: `Bearer ${token}` });
  }
  attempts.push({});

  let lastError = "Screenshot could not be fetched";

  for (const headers of attempts) {
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow"
    });

    if (!response.ok) {
      lastError = `Upstream image request failed with ${response.status}`;
      continue;
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType
    };
  }

  throw new Error(lastError);
}

async function loadTransactionScreenshot(id) {
  const rows = await sql`
    SELECT "screenshotUrl"
    FROM "UpgradeTransaction"
    WHERE id = ${id}
    LIMIT 1;
  `;

  const screenshotUrl = rows?.[0]?.screenshotUrl;
  if (!screenshotUrl) {
    return null;
  }

  const trimmed = String(screenshotUrl).trim();
  if (trimmed.startsWith("data:image/")) {
    return parseDataImageUri(trimmed);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch (_error) {
    throw new Error("Invalid screenshot URL");
  }

  if (!isAllowedScreenshotHost(parsedUrl.hostname)) {
    throw new Error("Screenshot host is not allowed");
  }

  return fetchBlobImage(parsedUrl.toString());
}

async function queryTable(tableName, limit) {
  const safeLimit = parseLimit(limit);
  if (tableName === "FunnelLead") {
    return sql`SELECT * FROM "FunnelLead" LIMIT ${safeLimit};`;
  }
  if (tableName === "FunnelEvent") {
    return sql`SELECT * FROM "FunnelEvent" LIMIT ${safeLimit};`;
  }
  if (tableName === "UpgradeTransaction") {
    return sql`SELECT * FROM "UpgradeTransaction" LIMIT ${safeLimit};`;
  }
  throw new Error("Unsupported table");
}

app.get("/api/health", async (_req, res) => {
  try {
    await sql`SELECT 1;`;
    return res.json({ ok: true, db: "connected" });
  } catch (error) {
    return res.status(500).json({ ok: false, db: "disconnected", message: error.message });
  }
});

app.post("/api/funnel-leads", async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, 120);
    const email = sanitizeEmail(req.body?.email);
    const status = sanitizeText(req.body?.status || "NEW", 50);
    const phone = requireValidPhone(req.body?.phone);

    if (!name) return badRequest(res, "name is required");
    if (!email || !isValidEmail(email)) return badRequest(res, "A valid email is required");

    const rows = await sql`
      INSERT INTO "FunnelLead" ("name", "email", "phone", "status")
      VALUES (${name}, ${email}, ${phone}, ${status})
      RETURNING *;
    `;

    return res.status(201).json({ data: rows[0] });
  } catch (error) {
    const isValidationError = /Phone must start/.test(error.message);
    return res.status(isValidationError ? 400 : 500).json({
      error: "Failed to create FunnelLead",
      message: error.message
    });
  }
});

app.get("/api/funnel-leads", async (req, res) => {
  try {
    const rows = await queryTable("FunnelLead", req.query.limit);
    return res.json({ data: rows, count: rows.length });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch FunnelLead",
      message: error.message
    });
  }
});

app.get("/api/funnel-events", async (req, res) => {
  try {
    const rows = await queryTable("FunnelEvent", req.query.limit);
    return res.json({ data: rows, count: rows.length });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch FunnelEvent",
      message: error.message
    });
  }
});

app.get("/api/upgrade-transactions", async (req, res) => {
  try {
    const rows = await queryTable("UpgradeTransaction", req.query.limit);
    return res.json({ data: rows, count: rows.length });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch UpgradeTransaction",
      message: error.message
    });
  }
});

app.post("/api/upgrade-transactions", async (req, res) => {
  try {
    const firstName = sanitizeText(req.body?.firstName, 80);
    const lastName = sanitizeText(req.body?.lastName, 80);
    const phone = requireValidPhone(req.body?.phone);
    const paymentMethod = sanitizeText(req.body?.paymentMethod, 60);
    const status = sanitizeText(req.body?.status || "PENDING_REVIEW", 50);
    const transactionNo = sanitizeOptionalText(req.body?.transactionNo, 120);
    const screenshotUrl = sanitizeOptionalText(req.body?.screenshotUrl, 4000);
    const leadId = sanitizeOptionalText(req.body?.leadId, 80);

    if (!firstName) return badRequest(res, "firstName is required");
    if (!lastName) return badRequest(res, "lastName is required");
    if (!paymentMethod) return badRequest(res, "paymentMethod is required");

    const rows = await sql`
      INSERT INTO "UpgradeTransaction" (
        "firstName",
        "lastName",
        "phone",
        "transactionNo",
        "screenshotUrl",
        "paymentMethod",
        "status",
        "leadId"
      )
      VALUES (
        ${firstName},
        ${lastName},
        ${phone},
        ${transactionNo},
        ${screenshotUrl},
        ${paymentMethod},
        ${status},
        ${leadId}
      )
      RETURNING *;
    `;

    return res.status(201).json({ data: rows[0] });
  } catch (error) {
    const isValidationError = /Phone must start/.test(error.message);
    return res.status(isValidationError ? 400 : 500).json({
      error: "Failed to create UpgradeTransaction",
      message: error.message
    });
  }
});

app.get("/api/overview", async (_req, res) => {
  try {
    const [leadCount] = await sql`SELECT COUNT(*)::int AS total FROM "FunnelLead";`;
    const [eventCount] = await sql`SELECT COUNT(*)::int AS total FROM "FunnelEvent";`;
    const [transactionCount] = await sql`SELECT COUNT(*)::int AS total FROM "UpgradeTransaction";`;

    return res.json({
      totals: {
        funnelLead: leadCount?.total || 0,
        funnelEvent: eventCount?.total || 0,
        upgradeTransaction: transactionCount?.total || 0
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch overview",
      message: error.message
    });
  }
});

app.get("/api/upgrade-transactions/:id/screenshot", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Transaction id is required" });
    }

    const image = await loadTransactionScreenshot(id);
    if (!image) {
      return res.status(404).json({ error: "Screenshot not found" });
    }

    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Type", image.contentType);
    return res.status(200).send(image.buffer);
  } catch (error) {
    return res.status(502).json({
      error: "Failed to load screenshot",
      message: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`YSA-EX admin server running at http://localhost:${port}`);
});
