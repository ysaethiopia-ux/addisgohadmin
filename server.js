const path = require("path");
const crypto = require("crypto");
const express = require("express");
const dotenv = require("dotenv");
const { neon } = require("@neondatabase/serverless");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || "admin123";
if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_SECRET) {
  console.log("Notice: ADMIN_PASSWORD is not set in .env. Using default local passcode: 'admin123'");
}

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is missing. API calls to Neon will fail until it is configured.");
}

const sql = neon(process.env.DATABASE_URL || "postgresql://invalid");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// --- COOKIE & AUTHENTICATION UTILITIES ---

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const [rawKey, ...valParts] = pair.split("=");
    const key = rawKey?.trim();
    if (key) {
      cookies[key] = decodeURIComponent(valParts.join("=").trim());
    }
  });
  return cookies;
}

function createSessionToken() {
  const payload = {
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    nonce: crypto.randomBytes(16).toString("hex")
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_PASSWORD)
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadStr, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_PASSWORD)
    .update(payloadStr)
    .digest("base64url");

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) {
      return false;
    }
    return true;
  } catch (_e) {
    return false;
  }
}

function verifyPassword(inputPassword) {
  if (!inputPassword || typeof inputPassword !== "string") return false;
  const inputBuf = Buffer.from(inputPassword);
  const expectedBuf = Buffer.from(ADMIN_PASSWORD);
  if (inputBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(inputBuf, inputBuf);
    return false;
  }
  return crypto.timingSafeEqual(inputBuf, expectedBuf);
}

function isAuthenticated(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === ADMIN_PASSWORD || verifySessionToken(token)) {
      return true;
    }
  }

  const cookies = parseCookies(req);
  if (cookies.admin_session && verifySessionToken(cookies.admin_session)) {
    return true;
  }

  return false;
}

function requireAdminAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }

  return res.status(401).json({
    error: "Unauthorized",
    code: "AUTH_REQUIRED",
    message: "Admin authentication required. Please log in."
  });
}

// --- SANITIZATION & VALIDATION ---

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
    return sql`SELECT "id", "fullName", "email", "phone", "status" FROM "FunnelLead" ORDER BY "createdAt" DESC LIMIT ${safeLimit};`;
  }
  if (tableName === "FunnelEvent") {
    return sql`
      SELECT 
        fe."id",
        COALESCE(fl."fullName", 'Unknown Lead') AS "personName",
        fl."phone",
        fl."email",
        fe."eventType",
        fe."metadata",
        fe."createdAt",
        fe."leadId"
      FROM "FunnelEvent" fe
      LEFT JOIN "FunnelLead" fl ON fe."leadId" = fl."id"
      WHERE fe."eventType" != 'DOWNLOAD_CLICKED'
      ORDER BY fe."createdAt" DESC
      LIMIT ${safeLimit};
    `;
  }
  if (tableName === "UpgradeTransaction") {
    return sql`SELECT "id", "firstName", "lastName", "phone", "transactionNo", "screenshotUrl" FROM "UpgradeTransaction" ORDER BY "createdAt" DESC LIMIT ${safeLimit};`;
  }
  throw new Error("Unsupported table");
}

async function checkTrafficSessionTable() {
  try {
    const rows = await sql`
      SELECT 1 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'TrafficSession' 
      LIMIT 1;
    `;
    return rows.length > 0;
  } catch (_e) {
    return false;
  }
}

// --- PUBLIC ROUTES ---

app.get("/api/health", async (_req, res) => {
  try {
    await sql`SELECT 1;`;
    return res.json({ ok: true, db: "connected" });
  } catch (error) {
    return res.status(500).json({ ok: false, db: "disconnected", message: error.message });
  }
});

app.get("/api/auth/status", (req, res) => {
  return res.json({ authenticated: isAuthenticated(req) });
});

app.post("/api/auth/login", (req, res) => {
  const password = req.body?.password;
  if (!password || !verifyPassword(password)) {
    return res.status(401).json({ error: "Invalid admin passcode" });
  }

  const token = createSessionToken();
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${isProd ? "; Secure" : ""}`
  );
  return res.json({ ok: true, message: "Authenticated successfully" });
});

app.post("/api/auth/logout", (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
  );
  return res.json({ ok: true, message: "Logged out" });
});

// --- PROTECTED ADMIN API ROUTES ---

app.get("/api/overview", requireAdminAuth, async (_req, res) => {
  try {
    const [leadCount] = await sql`SELECT COUNT(*)::int AS total FROM "FunnelLead";`;
    const [eventCount] = await sql`SELECT COUNT(*)::int AS total FROM "FunnelEvent" WHERE "eventType" != 'DOWNLOAD_CLICKED';`;
    const [transactionCount] = await sql`SELECT COUNT(*)::int AS total FROM "UpgradeTransaction";`;
    const [clickCount] = await sql`SELECT COUNT(*)::int AS total FROM "ClickEvent";`;

    return res.json({
      totals: {
        funnelLead: leadCount?.total || 0,
        funnelEvent: eventCount?.total || 0,
        upgradeTransaction: transactionCount?.total || 0,
        clickEvent: clickCount?.total || 0
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch overview",
      message: error.message
    });
  }
});

app.get("/api/funnel-leads", requireAdminAuth, async (req, res) => {
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

app.post("/api/funnel-leads", requireAdminAuth, async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, 120);
    const email = sanitizeEmail(req.body?.email);
    const status = sanitizeText(req.body?.status || "NEW", 50);
    const phone = requireValidPhone(req.body?.phone);

    if (!name) return badRequest(res, "name is required");
    if (!email || !isValidEmail(email)) return badRequest(res, "A valid email is required");

    const rows = await sql`
      INSERT INTO "FunnelLead" ("fullName", "email", "phone", "status")
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

app.get("/api/funnel-events", requireAdminAuth, async (req, res) => {
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

app.get("/api/upgrade-transactions", requireAdminAuth, async (req, res) => {
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

app.post("/api/upgrade-transactions", requireAdminAuth, async (req, res) => {
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

app.get("/api/upgrade-transactions/:id/screenshot", requireAdminAuth, async (req, res) => {
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

// --- LEAD TRACKING / MARKETING ANALYTICS ENDPOINT ---

app.get("/api/analytics/marketing", requireAdminAuth, async (req, res) => {
  try {
    const rawStart = req.query.startDate ? String(req.query.startDate).trim() : null;
    const rawEnd = req.query.endDate ? String(req.query.endDate).trim() : null;

    let startDateIso = null;
    let endDateIso = null;

    if (rawStart) {
      const d = new Date(rawStart);
      if (!isNaN(d.getTime())) {
        startDateIso = d.toISOString();
      }
    }

    if (rawEnd) {
      const d = new Date(rawEnd);
      if (!isNaN(d.getTime())) {
        endDateIso = d.toISOString();
      }
    }

    const hasTrafficSession = await checkTrafficSessionTable();

    // 1. ClickEvent clicks
    const clicksPromise = sql`
      SELECT 
        CASE 
          WHEN LOWER(COALESCE(source, '')) LIKE '%instagram%' OR LOWER(COALESCE(source, '')) LIKE '%ig%' THEN 'instagram'
          WHEN LOWER(COALESCE(source, '')) LIKE '%facebook%' OR LOWER(COALESCE(source, '')) LIKE '%fb%' THEN 'facebook'
          ELSE 'direct_other'
        END AS channel,
        COUNT(*)::int AS count
      FROM "ClickEvent"
      WHERE (${startDateIso}::timestamp IS NULL OR "createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR "createdAt" <= ${endDateIso}::timestamp)
      GROUP BY channel;
    `;

    // 2. FunnelLead: New registered leads
    const leadsPromise = sql`
      SELECT 
        CASE 
          WHEN LOWER(COALESCE(source, '')) LIKE '%instagram%' OR LOWER(COALESCE(source, '')) LIKE '%ig%' THEN 'instagram'
          WHEN LOWER(COALESCE(source, '')) LIKE '%facebook%' OR LOWER(COALESCE(source, '')) LIKE '%fb%' THEN 'facebook'
          ELSE 'direct_other'
        END AS channel,
        COUNT(*)::int AS count
      FROM "FunnelLead"
      WHERE (${startDateIso}::timestamp IS NULL OR "createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR "createdAt" <= ${endDateIso}::timestamp)
      GROUP BY channel;
    `;

    // 3. FunnelEvent: Registration events
    const eventsPromise = sql`
      SELECT 
        COUNT(*)::int AS count
      FROM "FunnelEvent"
      WHERE "eventType" = 'REGISTRATION_COMPLETED'
        AND (${startDateIso}::timestamp IS NULL OR "createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR "createdAt" <= ${endDateIso}::timestamp);
    `;

    // 4. UpgradeTransaction: Upgrade submissions & confirmed upgrades
    const transactionsPromise = sql`
      SELECT 
        CASE 
          WHEN LOWER(COALESCE(source, '')) LIKE '%instagram%' OR LOWER(COALESCE(source, '')) LIKE '%ig%' THEN 'instagram'
          WHEN LOWER(COALESCE(source, '')) LIKE '%facebook%' OR LOWER(COALESCE(source, '')) LIKE '%fb%' THEN 'facebook'
          ELSE 'direct_other'
        END AS channel,
        COUNT(*)::int AS submissions,
        COUNT(*) FILTER (WHERE UPPER(status) IN ('APPROVED', 'CONFIRMED'))::int AS confirmed
      FROM "UpgradeTransaction"
      WHERE (${startDateIso}::timestamp IS NULL OR "createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR "createdAt" <= ${endDateIso}::timestamp)
      GROUP BY channel;
    `;

    // 5. Recent attributed sample records (latest 10 leads & 10 transactions)
    const recentLeadsPromise = sql`
      SELECT "id", "fullName", "email", "phone", "source", "status", "createdAt"
      FROM "FunnelLead"
      WHERE (${startDateIso}::timestamp IS NULL OR "createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR "createdAt" <= ${endDateIso}::timestamp)
      ORDER BY "createdAt" DESC
      LIMIT 10;
    `;

    const recentTxPromise = sql`
      SELECT "id", "firstName", "lastName", "paymentMethod", "source", "status", "createdAt", "transactionNo"
      FROM "UpgradeTransaction"
      WHERE (${startDateIso}::timestamp IS NULL OR "createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR "createdAt" <= ${endDateIso}::timestamp)
      ORDER BY "createdAt" DESC
      LIMIT 10;
    `;

    const recentEventsPromise = sql`
      SELECT 
        fe."id",
        fe."eventType",
        fe."metadata",
        fe."createdAt",
        COALESCE(fl."fullName", 'Unknown Lead') AS "personName",
        fl."phone",
        fe."leadId"
      FROM "FunnelEvent" fe
      LEFT JOIN "FunnelLead" fl ON fe."leadId" = fl."id"
      WHERE fe."eventType" != 'DOWNLOAD_CLICKED'
        AND (${startDateIso}::timestamp IS NULL OR fe."createdAt" >= ${startDateIso}::timestamp)
        AND (${endDateIso}::timestamp IS NULL OR fe."createdAt" <= ${endDateIso}::timestamp)
      ORDER BY fe."createdAt" DESC
      LIMIT 10;
    `;

    const [clicksRows, leadsRows, eventsRows, txRows, recentLeads, recentTx, recentEvents] = await Promise.all([
      clicksPromise,
      leadsPromise,
      eventsPromise,
      transactionsPromise,
      recentLeadsPromise,
      recentTxPromise,
      recentEventsPromise
    ]);

    // Build channel breakdown maps
    const channels = {
      instagram: {
        channel: "instagram",
        label: "Instagram",
        clicks: 0,
        uniqueVisitors: hasTrafficSession ? 0 : null,
        totalVisits: hasTrafficSession ? 0 : null,
        newRegisteredLeads: 0,
        upgradeSubmissions: 0,
        confirmedUpgrades: 0
      },
      facebook: {
        channel: "facebook",
        label: "Facebook",
        clicks: 0,
        uniqueVisitors: hasTrafficSession ? 0 : null,
        totalVisits: hasTrafficSession ? 0 : null,
        newRegisteredLeads: 0,
        upgradeSubmissions: 0,
        confirmedUpgrades: 0
      },
      direct_other: {
        channel: "direct_other",
        label: "Direct / Other",
        clicks: 0,
        uniqueVisitors: hasTrafficSession ? 0 : null,
        totalVisits: hasTrafficSession ? 0 : null,
        newRegisteredLeads: 0,
        upgradeSubmissions: 0,
        confirmedUpgrades: 0
      }
    };

    // Populate clicks
    clicksRows.forEach((row) => {
      const key = channels[row.channel] ? row.channel : "direct_other";
      channels[key].clicks += row.count || 0;
    });

    // Populate leads
    leadsRows.forEach((row) => {
      const key = channels[row.channel] ? row.channel : "direct_other";
      channels[key].newRegisteredLeads += row.count || 0;
    });

    // Populate transactions
    txRows.forEach((row) => {
      const key = channels[row.channel] ? row.channel : "direct_other";
      channels[key].upgradeSubmissions += row.submissions || 0;
      channels[key].confirmedUpgrades += row.confirmed || 0;
    });

    // Compute totals
    const total = {
      channel: "total",
      label: "Total",
      clicks: channels.instagram.clicks + channels.facebook.clicks + channels.direct_other.clicks,
      uniqueVisitors: hasTrafficSession ? 0 : null,
      totalVisits: hasTrafficSession ? 0 : null,
      newRegisteredLeads:
        channels.instagram.newRegisteredLeads +
        channels.facebook.newRegisteredLeads +
        channels.direct_other.newRegisteredLeads,
      upgradeSubmissions:
        channels.instagram.upgradeSubmissions +
        channels.facebook.upgradeSubmissions +
        channels.direct_other.upgradeSubmissions,
      confirmedUpgrades:
        channels.instagram.confirmedUpgrades +
        channels.facebook.confirmedUpgrades +
        channels.direct_other.confirmedUpgrades
    };

    // Compute conversion rate for each channel
    function attachRates(item) {
      const leadCount = item.newRegisteredLeads || 0;
      const subCount = item.upgradeSubmissions || 0;
      const confCount = item.confirmedUpgrades || 0;
      return {
        ...item,
        leadToSubmissionRate: leadCount > 0 ? Number(((subCount / leadCount) * 100).toFixed(1)) : 0,
        confirmedConversionRate: leadCount > 0 ? Number(((confCount / leadCount) * 100).toFixed(1)) : 0
      };
    }

    const formattedChannels = {
      instagram: attachRates(channels.instagram),
      facebook: attachRates(channels.facebook),
      direct_other: attachRates(channels.direct_other),
      total: attachRates(total)
    };

    return res.json({
      filters: {
        startDate: startDateIso,
        endDate: endDateIso
      },
      trafficSessionAvailable: hasTrafficSession,
      registrationEventsCount: eventsRows[0]?.count || 0,
      channels: formattedChannels,
      recentActivity: {
        leads: recentLeads,
        events: recentEvents,
        transactions: recentTx
      }
    });
  } catch (error) {
    console.error("Marketing analytics error:", error);
    return res.status(500).json({
      error: "Failed to fetch marketing analytics",
      message: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`YSA-EX admin server running at http://localhost:${port}`);
});
