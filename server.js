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

app.listen(port, () => {
  console.log(`YSA-EX admin server running at http://localhost:${port}`);
});
