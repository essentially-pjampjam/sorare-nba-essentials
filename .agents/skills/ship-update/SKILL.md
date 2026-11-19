---
name: ship-update
description: Ship a new build of pjampjam's Sorare NBA Essentials (Chrome MV3 side panel). Use when a milestone or fix is done and needs a version bump, release notes, live-test list and a commit on the release branch.
---

# Ship an update

Follow these steps in order. Stop and ask the user when a step needs a decision.

## 1. Check the work
- `node scripts/verify.mjs --full` (invariants, then `npm run check`: typecheck, vitest, build). It must exit 0.
- Optional: `npm run test:e2e` and `npm run typecheck:e2e`.

## 2. See what is missing
- `node scripts/ship-helper.mjs next` (read-only) prints the versions, branch and a checklist.

## 3. Bump the version (every shipped change)
- `package.json` `version` (experimental builds: `X.Y.Z-exp.Mn`).
- `public/manifest.json`: numeric `version` (`X.Y.Z`) and `version_name` (the full label; `-exp` shows the red badge).
- `PROJECT_STATE.md` `Status:` line (gitignored, local only).

## 4. Write it down
- `CHANGELOG.md`: a section for the version with `Added:`, `Changed:`, `Fixed:` lines.
- `src/sidepanel/components/WhatsNewModal.tsx`: a `RELEASE_HIGHLIGHTS` entry, plain words for the user.
- `TESTING.md`: numbered live tests (`T1`, `T2`, ...) for this build; move passed ones to `## Done`.
- `INPUT_NEEDED.md`: open questions for the user under `## Decisions`, facts under `## FYI`, resolved ones under `## Answered`.
- New Sorare facts go to `docs/SORARE_FACTS.md` with the date and how they were checked.

## 5. Commit
- Commit on the release branch (never directly on `main`), message `vX.Y.Z Mn: short summary`.
- No attribution trailers in commit messages.
- Do not push or merge unless the user asks.

## 6. Next step for the user (manual)
- Reload the extension in `chrome://extensions`, check the header badge shows the new build, and run the `TESTING.md` list.
- Merge to `main` and pack the store zip (`npm run zip`) only after the user's live test passes.

## Rules to keep
- Sorare GraphQL calls only from `src/background/` through the rate-limited queue (max 120/min) and the 10-minute cache.
- `src/calculators/` stays pure (no chrome, DOM, window or network).
- Never mix auction prices into Instant Buy floors.
- No em-dash characters in `src/` or these workflow docs.
