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

4. If screenshots are stored in private Vercel Blob URLs, set:

   `BLOB_READ_WRITE_TOKEN=<your_vercel_blob_token>`

5. Start the server:

   ```bash
   npm run dev
   ```

6. Open:

   `http://localhost:3000`

## API Endpoints

- `GET /api/health`
- `GET /api/overview`
- `GET /api/funnel-leads?limit=100`
- `GET /api/funnel-events?limit=100`
- `GET /api/upgrade-transactions?limit=100`
- `GET /api/upgrade-transactions/:id/screenshot`
- `POST /api/funnel-leads`
- `POST /api/upgrade-transactions`

## Input Validation

- Incoming text fields are sanitized (trimmed, control characters removed, whitespace collapsed).
- Phone numbers are validated server-side before insert.
- Accepted phone format: must start with `09` or `+251` and contain at least 10 digits.

## Notes

- Queries assume exact table names with capitals: `"FunnelLead"`, `"FunnelEvent"`, `"UpgradeTransaction"`.
- Screenshot proxy allows private blob hosts (`*.blob.vercel-storage.com`) and can use `BLOB_READ_WRITE_TOKEN`.
- If your schema uses different names/columns, update `server.js` accordingly.