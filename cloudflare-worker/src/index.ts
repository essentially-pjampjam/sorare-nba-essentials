/**
 * Cloudflare Workers + D1 backend for pjampjam's Sorare NBA Essentials.
 *
 * Features:
 * - Passwordless 1-time Sorare Bio Verification Challenge -> HMAC-SHA256 signed JWT
 * - Strict anti-bloat guardrails: enum tags only (keep | sell | core | trade),
 *   max 500 tags/user, slug validation, and per-IP/user rate limits in D1
 * - Public read endpoint GET /api/tags/:username for gallery overlays
 */

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  MAX_TAGS_PER_USER?: string;
  CHALLENGE_TTL_MINUTES?: string;
  JWT_TTL_DAYS?: string;
}

type CardTag = "keep" | "sell" | "core" | "trade";
const ALLOWED_TAGS = new Set<CardTag>(["keep", "sell", "core", "trade"]);
const USERNAME_RE = /^[a-z0-9_-]{2,40}$/;
const CARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,139}$/i;
const SORARE_GRAPHQL_URL = "https://api.sorare.com/graphql";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })),
  );
  const signingInput = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

async function verifyJwt(token: string, secret: string): Promise<{ sub: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as {
      alg?: string;
    };
    if (header.alg !== "HS256") return null;

    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(sigB64),
      new TextEncoder().encode(`${headerB64}.${bodyB64}`),
    );
    if (!valid) return null;

    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(bodyB64))) as {
      sub?: string;
      exp?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    if (!parsed.sub || !parsed.exp || parsed.exp < now) return null;
    return { sub: parsed.sub };
  } catch {
    return null;
  }
}

async function checkRateLimit(
  db: D1Database,
  bucketKey: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare("SELECT count, reset_at FROM rate_limits WHERE bucket_key = ?")
    .bind(bucketKey)
    .first<{ count: number; reset_at: number }>();

  if (!row || row.reset_at <= now) {
    await db
      .prepare(
        "INSERT OR REPLACE INTO rate_limits (bucket_key, count, reset_at) VALUES (?, 1, ?)",
      )
      .bind(bucketKey, now + windowMs)
      .run();
    return true;
  }
  if (row.count >= limit) return false;
  await db
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?")
    .bind(bucketKey)
    .run();
  return true;
}

function generateChallengeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `SORARE-ESSENTIALS-${suffix}`;
}

async function fetchSorarePublicBio(username: string): Promise<string | null> {
  const query = `
    query VerifyManagerBio($slug: String!) {
      user(slug: $slug) {
        slug
        nickname
        profile {
          bio
        }
      }
    }
  `;
  const res = await fetch(SORARE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables: { slug: username } }),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    data?: {
      user?: {
        nickname?: string | null;
        profile?: { bio?: string | null } | null;
      } | null;
    };
  };
  const bio = payload.data?.user?.profile?.bio ?? "";
  const nick = payload.data?.user?.nickname ?? "";
  return `${bio}\n${nick}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, service: "sorare-nba-essentials-tags" });
    }

    // 1. Start 1-time Sorare Bio Verification Challenge
    if (request.method === "POST" && path === "/api/auth/challenge") {
      const allowed = await checkRateLimit(env.DB, `challenge:${ip}`, 10, 10 * 60_000);
      if (!allowed) return json({ error: "Too many challenge requests. Try again later." }, 429);

      const body = (await request.json().catch(() => ({}))) as { username?: string };
      const username = (body.username ?? "").trim().toLowerCase().replace(/^@/, "");
      if (!USERNAME_RE.test(username)) {
        return json({ error: "Invalid Sorare username slug." }, 400);
      }

      const ttlMinutes = Math.max(5, Number(env.CHALLENGE_TTL_MINUTES ?? "15") || 15);
      const now = Date.now();
      const expiresAt = now + ttlMinutes * 60_000;
      const challengeCode = generateChallengeCode();

      await env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(now).run();
      await env.DB.prepare(
        "INSERT INTO auth_challenges (username, challenge_code, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(username, challengeCode, expiresAt, now)
        .run();

      return json({
        username,
        challengeCode,
        expiresAtIso: new Date(expiresAt).toISOString(),
      });
    }

    // 2. Verify Sorare Bio and issue signed JWT
    if (request.method === "POST" && path === "/api/auth/verify") {
      if (!env.JWT_SECRET) {
        return json({ error: "Worker JWT_SECRET is not configured." }, 500);
      }
      const allowed = await checkRateLimit(env.DB, `verify:${ip}`, 12, 10 * 60_000);
      if (!allowed) return json({ error: "Too many verification attempts." }, 429);

      const body = (await request.json().catch(() => ({}))) as {
        username?: string;
        challengeCode?: string;
      };
      const username = (body.username ?? "").trim().toLowerCase().replace(/^@/, "");
      const challengeCode = (body.challengeCode ?? "").trim();
      if (!USERNAME_RE.test(username) || !challengeCode) {
        return json({ error: "Username and challengeCode are required." }, 400);
      }

      const row = await env.DB.prepare(
        "SELECT expires_at FROM auth_challenges WHERE username = ? AND challenge_code = ?",
      )
        .bind(username, challengeCode)
        .first<{ expires_at: number }>();

      if (!row || row.expires_at < Date.now()) {
        return json({ error: "Challenge code expired or not found. Generate a new code." }, 400);
      }

      const bioText = await fetchSorarePublicBio(username);
      if (!bioText || !bioText.includes(challengeCode)) {
        return json(
          { error: "Challenge code not found in your public Sorare bio yet. Save bio and retry." },
          403,
        );
      }

      const nowIso = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM auth_challenges WHERE username = ?").bind(username),
        env.DB.prepare(
          "INSERT INTO users (username, verified_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at",
        ).bind(username, nowIso, nowIso),
      ]);

      const ttlDays = Math.max(1, Number(env.JWT_TTL_DAYS ?? "30") || 30);
      const token = await signJwt({ sub: username }, env.JWT_SECRET, ttlDays * 86_400);
      return json({ username, token });
    }

    // 3. Authenticated PUT /api/tags (strict enum + max tags anti-bloat guardrail)
    if (request.method === "PUT" && path === "/api/tags") {
      if (!env.JWT_SECRET) {
        return json({ error: "Worker JWT_SECRET is not configured." }, 500);
      }
      const authHeader = request.headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const claims = token ? await verifyJwt(token, env.JWT_SECRET) : null;
      if (!claims) {
        return json({ error: "Unauthorized. Complete Sorare bio verification first." }, 401);
      }

      const allowed = await checkRateLimit(env.DB, `put:${claims.sub}`, 20, 10 * 60_000);
      if (!allowed) return json({ error: "Rate limit exceeded for tag updates." }, 429);

      const body = (await request.json().catch(() => ({}))) as {
        tags?: Record<string, unknown>;
      };
      if (!body.tags || typeof body.tags !== "object" || Array.isArray(body.tags)) {
        return json({ error: "Body must include a tags object." }, 400);
      }

      const maxTags = Math.max(10, Number(env.MAX_TAGS_PER_USER ?? "500") || 500);
      const entries = Object.entries(body.tags);
      if (entries.length > maxTags) {
        return json({ error: `Max ${maxTags} tags per manager.` }, 400);
      }

      const deduped = new Map<string, CardTag>();
      for (const [slug, rawTag] of entries) {
        const cleanSlug = slug.trim().toLowerCase();
        if (!CARD_SLUG_RE.test(cleanSlug)) continue;
        if (typeof rawTag !== "string" || !ALLOWED_TAGS.has(rawTag as CardTag)) {
          return json(
            { error: "Invalid tag value. Allowed values: keep, sell, core, trade." },
            400,
          );
        }
        deduped.set(cleanSlug, rawTag as CardTag);
      }

      const sanitized = Array.from(deduped.entries());
      const nowIso = new Date().toISOString();
      const statements: D1PreparedStatement[] = [
        env.DB.prepare("DELETE FROM card_tags WHERE username = ?").bind(claims.sub),
      ];
      // Multi-row INSERT OR REPLACE in chunks of 20 rows (80 bound params < D1's 100-param limit)
      const CHUNK_ROWS = 20;
      for (let i = 0; i < sanitized.length; i += CHUNK_ROWS) {
        const chunk = sanitized.slice(i, i + CHUNK_ROWS);
        const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
        const binds: string[] = [];
        for (const [slug, tag] of chunk) {
          binds.push(claims.sub, slug, tag, nowIso);
        }
        statements.push(
          env.DB.prepare(
            `INSERT OR REPLACE INTO card_tags (username, card_slug, tag, updated_at) VALUES ${placeholders}`,
          ).bind(...binds),
        );
      }
      await env.DB.batch(statements);

      return json({
        username: claims.sub,
        count: sanitized.length,
        updatedAtIso: nowIso,
      });
    }

    // 4. Public read endpoint GET /api/tags/:username
    const publicMatch = path.match(/^\/api\/tags\/([a-z0-9_-]{2,40})$/i);
    if (request.method === "GET" && publicMatch) {
      const username = publicMatch[1].toLowerCase();
      const rows = await env.DB.prepare(
        "SELECT card_slug, tag, updated_at FROM card_tags WHERE username = ?",
      )
        .bind(username)
        .all<{ card_slug: string; tag: CardTag; updated_at: string }>();

      const tags: Record<string, CardTag> = {};
      let latestUpdated: string | null = null;
      for (const r of rows.results ?? []) {
        if (ALLOWED_TAGS.has(r.tag)) {
          tags[r.card_slug] = r.tag;
          if (!latestUpdated || r.updated_at > latestUpdated) {
            latestUpdated = r.updated_at;
          }
        }
      }

      return json(
        {
          username,
          tags,
          updatedAtIso: latestUpdated,
        },
        200,
        { "Cache-Control": "public, max-age=120" },
      );
    }

    return json({ error: "Not found" }, 404);
  },
};
