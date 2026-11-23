# Sorare NBA Essentials - Cloudflare Workers + D1 Card Tags Backend

Optional, zero-password backend for sharing public `Keep / Sell / Core / Trade` card tags across managers in **pjampjam's Sorare NBA Essentials**.

## Architecture & Guardrails

1. **1-Time Sorare Profile Verification Challenge (No Passwords):**
   - `POST /api/auth/challenge` generates a short code (`SORARE-ESSENTIALS-XXXXXX`, 15 min TTL).
   - The manager pastes the code into their Sorare profile status, club name, or nickname temporarily and calls `POST /api/auth/verify`.
   - The Worker checks Sorare's public GraphQL `user(slug) { slug nickname profile { status clubName } }`, deletes the challenge, and returns a signed HS256 JWT (30-day TTL).
2. **Strict Anti-Bloat Guardrails:**
   - Only strict enum tags are accepted (`keep`, `sell`, `core`, `trade`).
   - Max 500 tags per manager (`MAX_TAGS_PER_USER`).
   - Card slugs validated (`<= 140` chars) and rate limits enforced in D1 (`rate_limits` table).
3. **Public Gallery Read Endpoint:**
   - `GET /api/tags/:username` returns `{ username, tags, updatedAtIso }` with `Cache-Control: public, max-age=120` so visiting another manager's Sorare gallery in Chrome displays their public tags.

## Setup & Deployment

```bash
cd cloudflare-worker
npm install

# 1. Create the D1 database and paste the database_id into wrangler.toml
npx wrangler d1 create sorare-essentials-tags

# 2. Apply the SQL schema
npm run db:migrate:remote

# 3. Set a strong random HMAC secret for JWT signing
npx wrangler secret put JWT_SECRET

# 4. Deploy
npm run deploy
```

Then paste your deployed Worker URL (e.g. `https://sorare-nba-essentials-tags.<subdomain>.workers.dev`) into the Extension **Settings -> Cloud Card Tags Sync**.
