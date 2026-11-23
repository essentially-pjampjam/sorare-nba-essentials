import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

/** Minimal in-memory D1 mock supporting the SQL statements used by the Worker. */
function createMockD1() {
  const rateLimits = new Map<string, { count: number; reset_at: number }>();
  const challenges: Array<{
    username: string;
    challenge_code: string;
    expires_at: number;
    created_at: number;
  }> = [];
  const users = new Map<string, { verified_at: string; updated_at: string }>();
  const cardTags = new Map<string, Map<string, { tag: string; updated_at: string }>>();

  function makeStatement(sql: string, params: unknown[] = []) {
    const execRun = async () => {
      if (sql.startsWith("INSERT OR REPLACE INTO rate_limits")) {
        rateLimits.set(String(params[0]), { count: 1, reset_at: Number(params[1]) });
      } else if (sql.startsWith("UPDATE rate_limits SET count = count + 1")) {
        const key = String(params[0]);
        const row = rateLimits.get(key);
        if (row) row.count += 1;
      } else if (sql.startsWith("DELETE FROM auth_challenges WHERE expires_at < ?")) {
        const now = Number(params[0]);
        for (let i = challenges.length - 1; i >= 0; i--) {
          if (challenges[i].expires_at < now) challenges.splice(i, 1);
        }
      } else if (sql.startsWith("INSERT INTO auth_challenges")) {
        challenges.push({
          username: String(params[0]),
          challenge_code: String(params[1]),
          expires_at: Number(params[2]),
          created_at: Number(params[3]),
        });
      } else if (sql.startsWith("DELETE FROM auth_challenges WHERE username = ?")) {
        const u = String(params[0]);
        for (let i = challenges.length - 1; i >= 0; i--) {
          if (challenges[i].username === u) challenges.splice(i, 1);
        }
      } else if (sql.startsWith("INSERT INTO users")) {
        users.set(String(params[0]), {
          verified_at: String(params[1]),
          updated_at: String(params[2]),
        });
      } else if (sql.startsWith("DELETE FROM card_tags WHERE username = ?")) {
        cardTags.delete(String(params[0]));
      } else if (sql.startsWith("INSERT OR REPLACE INTO card_tags")) {
        for (let i = 0; i < params.length; i += 4) {
          const username = String(params[i]);
          const slug = String(params[i + 1]);
          const tag = String(params[i + 2]);
          const updatedAt = String(params[i + 3]);
          let map = cardTags.get(username);
          if (!map) {
            map = new Map();
            cardTags.set(username, map);
          }
          map.set(slug, { tag, updated_at: updatedAt });
        }
      }
      return { success: true };
    };

    return {
      bind: (...nextParams: unknown[]) => makeStatement(sql, nextParams),
      first: async <T,>(): Promise<T | null> => {
        if (sql.startsWith("SELECT count, reset_at FROM rate_limits")) {
          return (rateLimits.get(String(params[0])) as T | undefined) ?? null;
        }
        if (sql.startsWith("SELECT expires_at FROM auth_challenges")) {
          const found = challenges.find(
            (c) => c.username === String(params[0]) && c.challenge_code === String(params[1]),
          );
          return (found ? { expires_at: found.expires_at } : null) as T | null;
        }
        return null;
      },
      all: async <T,>(): Promise<{ results: T[] }> => {
        if (sql.startsWith("SELECT card_slug, tag, updated_at FROM card_tags")) {
          const map = cardTags.get(String(params[0]));
          if (!map) return { results: [] };
          const results = Array.from(map.entries()).map(([card_slug, v]) => ({
            card_slug,
            tag: v.tag,
            updated_at: v.updated_at,
          }));
          return { results: results as T[] };
        }
        return { results: [] };
      },
      run: execRun,
      _execRun: execRun,
    };
  }

  return {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (stmts: Array<{ _execRun?: () => Promise<unknown>; run: () => Promise<unknown> }>) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function makeEnv(): Env {
  return {
    DB: createMockD1() as unknown as Env["DB"],
    JWT_SECRET: "test-secret-key-for-hmac-sha256-signing",
  };
}

describe("Cloudflare Worker profile verification & tag sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("verifies challenge code in profile.status, clubName, or nickname using live Sorare schema (no bio)", async () => {
    const fields: Array<"status" | "clubName" | "nickname"> = ["status", "clubName", "nickname"];

    for (const field of fields) {
      const env = makeEnv();
      const chRes = await worker.fetch(
        new Request("https://worker.example/api/auth/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
          body: JSON.stringify({ username: "pjampjam" }),
        }),
        env,
      );
      expect(chRes.status).toBe(200);
      const chBody = (await chRes.json()) as { username: string; challengeCode: string };
      expect(chBody.challengeCode).toMatch(/^SORARE-ESSENTIALS-[A-Z2-9]{6}$/);

      let sentQuery = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
          const parsed = JSON.parse(String(init?.body ?? "{}")) as { query: string };
          sentQuery = parsed.query;
          return new Response(
            JSON.stringify({
              data: {
                user: {
                  slug: "pjampjam",
                  nickname: field === "nickname" ? chBody.challengeCode.toLowerCase() : "pjampjam",
                  profile: {
                    status: field === "status" ? `Verifying ${chBody.challengeCode}` : null,
                    clubName: field === "clubName" ? chBody.challengeCode : "2K FC",
                  },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }),
      );

      const verifyRes = await worker.fetch(
        new Request("https://worker.example/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
          body: JSON.stringify({ username: "pjampjam", challengeCode: chBody.challengeCode }),
        }),
        env,
      );
      expect(verifyRes.status).toBe(200);
      expect(sentQuery).toContain("status");
      expect(sentQuery).toContain("clubName");
      expect(sentQuery).not.toContain("bio");

      const verifyBody = (await verifyRes.json()) as { username: string; token: string };
      expect(verifyBody.username).toBe("pjampjam");
      expect(verifyBody.token.split(".")).toHaveLength(3);

      // Use issued JWT to PUT tags and read them publicly via GET /api/tags/:username
      const putRes = await worker.fetch(
        new Request("https://worker.example/api/tags", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${verifyBody.token}`,
          },
          body: JSON.stringify({
            tags: {
              "lebron-james-2026-limited-1": "core",
              "jayson-tatum-2026-limited-2": "sell",
            },
          }),
        }),
        env,
      );
      expect(putRes.status).toBe(200);

      const getRes = await worker.fetch(
        new Request("https://worker.example/api/tags/pjampjam"),
        env,
      );
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { tags: Record<string, string> };
      expect(getBody.tags).toEqual({
        "lebron-james-2026-limited-1": "core",
        "jayson-tatum-2026-limited-2": "sell",
      });
    }
  });

  it("returns 403 with CORS headers when Sorare returns User not found or fetch throws", async () => {
    const env = makeEnv();
    const chRes = await worker.fetch(
      new Request("https://worker.example/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.6.7.8" },
        body: JSON.stringify({ username: "ghost-user" }),
      }),
      env,
    );
    const { challengeCode } = (await chRes.json()) as { challengeCode: string };

    // Case 1: Sorare returns GraphQL NOT_FOUND error (data.user absent)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "User(slug=ghost-user) not found" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const notFoundRes = await worker.fetch(
      new Request("https://worker.example/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.6.7.8" },
        body: JSON.stringify({ username: "ghost-user", challengeCode }),
      }),
      env,
    );
    expect(notFoundRes.status).toBe(403);
    expect(notFoundRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

    // Case 2: Sorare fetch rejects with network/timeout error
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network timeout");
      }),
    );
    const netErrRes = await worker.fetch(
      new Request("https://worker.example/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.6.7.8" },
        body: JSON.stringify({ username: "ghost-user", challengeCode }),
      }),
      env,
    );
    expect(netErrRes.status).toBe(403);
    expect(netErrRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
