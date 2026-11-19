import { describe, expect, it } from "vitest";
import {
  buildArenaBoardUrl,
  buildArenaLineupsUrl,
  buildArenaOngoingUrl,
  buildCardUrl,
  buildMarketPlayerUrl,
  buildPrevLineupsUrl,
  buildProLineupsUrl,
  buildProPlayUrl,
  buildSetPlayUrl,
  buildSquadLineupUrl,
  isAllowedSorareUrl,
  isProhibitedSorareUrl,
  normalizeSorareSlug,
  PROHIBITED_SORARE_NBA_PATHS,
  SORARE_NBA_CARD_URL,
  SORARE_NBA_MARKET_URL,
  SORARE_ORIGIN,
} from "./routes";

describe("routes", () => {
  it("exposes expected base constants and prohibited path list", () => {
    expect(SORARE_ORIGIN).toBe("https://sorare.com");
    expect(SORARE_NBA_MARKET_URL).toBe("https://sorare.com/nba/market");
    expect(SORARE_NBA_CARD_URL).toBe("https://sorare.com/nba/cards");
    expect(PROHIBITED_SORARE_NBA_PATHS).toEqual(["/nba/arena", "/nba/set"]);
  });

  it("normalizes slugs and rejects empty or unsafe values", () => {
    expect(normalizeSorareSlug("  nba-21-23-nov-2026  ")).toBe("nba-21-23-nov-2026");
    expect(normalizeSorareSlug("")).toBeNull();
    expect(normalizeSorareSlug("   ")).toBeNull();
    expect(normalizeSorareSlug(null)).toBeNull();
    expect(normalizeSorareSlug(undefined)).toBeNull();
    expect(normalizeSorareSlug("null")).toBeNull();
    expect(normalizeSorareSlug("undefined")).toBeNull();
    expect(normalizeSorareSlug("bad/slug")).toBeNull();
    expect(normalizeSorareSlug("bad\\slug")).toBeNull();
    expect(normalizeSorareSlug("bad?slug")).toBeNull();
    expect(normalizeSorareSlug("bad#slug")).toBeNull();
    expect(normalizeSorareSlug("../secret")).toBeNull();
    expect(normalizeSorareSlug(".")).toBeNull();
    expect(normalizeSorareSlug("..")).toBeNull();
    expect(normalizeSorareSlug("foo\nbar")).toBeNull();
    expect(normalizeSorareSlug("foo\rbar")).toBeNull();
    expect(normalizeSorareSlug("foo\0bar")).toBeNull();
    expect(normalizeSorareSlug("foo\tbar")).toBeNull();
  });

  it("builds verified Pro, Arena, and Set/Series URLs", () => {
    expect(buildProPlayUrl()).toBe("https://sorare.com/nba/play");
    expect(buildProLineupsUrl()).toBe("https://sorare.com/nba/lineups/pro");
    expect(buildPrevLineupsUrl()).toBe("https://sorare.com/nba/lineups/prev");
    expect(buildArenaOngoingUrl()).toBe("https://sorare.com/nba/lineups/arena/ongoing");

    expect(buildArenaLineupsUrl()).toBe("https://sorare.com/nba/lineups/arena/ongoing");
    expect(buildArenaLineupsUrl(null)).toBe("https://sorare.com/nba/lineups/arena/ongoing");
    expect(buildArenaLineupsUrl("  ")).toBe("https://sorare.com/nba/lineups/arena/ongoing");
    expect(buildArenaLineupsUrl("ongoing")).toBe("https://sorare.com/nba/lineups/arena/ongoing");
    expect(buildArenaLineupsUrl("bad/slug")).toBe("https://sorare.com/nba/lineups/arena/ongoing");
    expect(buildArenaLineupsUrl("nba-21-23-nov-2026")).toBe(
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );

    expect(buildArenaBoardUrl(null, "lb")).toBe("https://sorare.com/nba/play");
    expect(buildArenaBoardUrl("nba-21-23-nov-2026", null)).toBe("https://sorare.com/nba/play");
    expect(
      buildArenaBoardUrl(
        "nba-21-23-nov-2026",
        "nba-21-23-nov-2026-nba_limited_in_season_champion",
      ),
    ).toBe(
      "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion",
    );

    expect(buildSetPlayUrl()).toBe("https://sorare.com/nba/series/play");
    expect(buildSetPlayUrl("arcade")).toBe("https://sorare.com/nba/series/play");
    expect(buildSetPlayUrl("squad")).toBe("https://sorare.com/nba/series/squad");
    expect(buildSetPlayUrl("hot_streak")).toBe("https://sorare.com/nba/series/play");
    expect(buildSetPlayUrl("hot_streak", "series-uuid-123")).toBe(
      "https://sorare.com/nba/series/series-uuid-123/lineups",
    );

    expect(buildSquadLineupUrl()).toBe("https://sorare.com/nba/series/squad");
    expect(buildSquadLineupUrl("BoardStep:abc-123")).toBe(
      "https://sorare.com/nba/series/squad/lineups/BoardStep%3Aabc-123",
    );
  });

  it("builds URI-encoded card and market player URLs with safe fallbacks", () => {
    expect(buildCardUrl("aaron-gordon-2026-limited-42")).toBe(
      "https://sorare.com/nba/cards/aaron-gordon-2026-limited-42",
    );
    expect(buildCardUrl("bad/card")).toBe(SORARE_NBA_MARKET_URL);
    expect(buildCardUrl("")).toBe(SORARE_NBA_MARKET_URL);

    expect(buildMarketPlayerUrl("nikola-jokic")).toBe(
      "https://sorare.com/nba/market?player=nikola-jokic",
    );
    expect(buildMarketPlayerUrl("nikola-jokic", "limited")).toBe(
      "https://sorare.com/nba/market?player=nikola-jokic&rarity=limited",
    );
    expect(buildMarketPlayerUrl("player with space", "super_rare")).toBe(
      "https://sorare.com/nba/market?player=player%20with%20space&rarity=super_rare",
    );
    expect(buildMarketPlayerUrl("")).toBe(SORARE_NBA_MARKET_URL);
  });

  it("detects prohibited 404 routes and validates all builder outputs as allowed", () => {
    expect(isProhibitedSorareUrl("https://sorare.com/nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/nba/arena/")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/nba/set")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/nba/set/play")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/nba/%61rena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/nba/set%2fplay")).toBe(true);
    expect(isProhibitedSorareUrl("https://[invalid/nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com:abc/nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com//nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com///nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("///nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/%2f/nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("/%2f/nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/%5cnba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("/%5cnba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/\\nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("/\\nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com//nba/set")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com//nba/set/play")).toBe(true);
    expect(isProhibitedSorareUrl(null as unknown as string)).toBe(false);
    expect(isProhibitedSorareUrl(undefined as unknown as string)).toBe(false);
    expect(isProhibitedSorareUrl(123 as unknown as string)).toBe(false);

    expect(isAllowedSorareUrl("https://sorare.com/nba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com/nba/set")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com/nba/%61rena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com/nba/set%2fplay")).toBe(false);
    expect(isAllowedSorareUrl("https://[invalid/nba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com//nba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com///nba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com/%2f/nba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com/%5cnba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com/\\nba/arena")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com//nba/set")).toBe(false);
    expect(isAllowedSorareUrl("https://sorare.com//nba/set/play")).toBe(false);
    expect(isAllowedSorareUrl(null as unknown as string)).toBe(false);
    expect(isAllowedSorareUrl("http://sorare.com/nba/play")).toBe(false);
    expect(isAllowedSorareUrl("https://evil.com/nba/play")).toBe(false);
    expect(isAllowedSorareUrl("/nba/play")).toBe(false);

    const allBuiltUrls = [
      buildProPlayUrl(),
      buildProLineupsUrl(),
      buildPrevLineupsUrl(),
      buildArenaOngoingUrl(),
      buildArenaLineupsUrl("nba-21-23-nov-2026"),
      buildArenaBoardUrl("nba-21-23-nov-2026", "nba_limited_in_season_champion"),
      buildSetPlayUrl("arcade"),
      buildSetPlayUrl("squad"),
      buildSetPlayUrl("hot_streak"),
      buildSetPlayUrl("hot_streak", "series-uuid-123"),
      buildSquadLineupUrl("BoardStep:abc-123"),
      buildCardUrl("aaron-gordon-2026-limited-42"),
      buildMarketPlayerUrl("aaron-gordon", "limited"),
    ];

    for (const built of allBuiltUrls) {
      expect(isProhibitedSorareUrl(built)).toBe(false);
      expect(isAllowedSorareUrl(built)).toBe(true);
    }
  });
});
