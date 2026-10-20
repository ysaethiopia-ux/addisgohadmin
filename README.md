# YSA-EX Admin Dashboard

This project is a lightweight admin page for three Neon/Postgres tables:

- `FunnelLead`: registrations from Join Now form
- `FunnelEvent`: actions tracked per lead (telegram click, upgrade click, etc.)
- `UpgradeTransaction`: payment submissions

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment template and set your Neon URL:

   ```bash
   copy .env.example .env
   ```

3. Update `DATABASE_URL` in `.env` with your Neon connection string.

4. Start the server:

   ```bash
   npm run dev
   ```

5. Open:

   `http://localhost:3000`

## API Endpoints

- `GET /api/health`
- `GET /api/overview`
- `GET /api/funnel-leads?limit=100`
- `GET /api/funnel-events?limit=100`
- `GET /api/upgrade-transactions?limit=100`

## Notes

- Queries assume exact table names with capitals: `"FunnelLead"`, `"FunnelEvent"`, `"UpgradeTransaction"`.
- If your schema uses different names/columns, update `server.js` accordingly.