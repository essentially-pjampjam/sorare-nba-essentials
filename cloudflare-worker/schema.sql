-- Cloudflare D1 schema for pjampjam's Sorare NBA Essentials public card tags.
-- Apply locally:  wrangler d1 execute sorare-essentials-tags --local --file=./schema.sql
-- Apply remote:   wrangler d1 execute sorare-essentials-tags --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  username TEXT NOT NULL,
  challenge_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (username, challenge_code)
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires
  ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS card_tags (
  username TEXT NOT NULL,
  card_slug TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('keep', 'sell', 'core', 'trade')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (username, card_slug)
);

CREATE INDEX IF NOT EXISTS idx_card_tags_username
  ON card_tags (username);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
