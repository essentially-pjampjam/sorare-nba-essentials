# Privacy Policy - pjampjam's Sorare NBA Essentials

Last updated: 2026-11-18

**pjampjam's Sorare NBA Essentials** is an independent, client-side Chrome extension.

## Data Storage & Usage
- **Local-only storage (`chrome.storage.local`):** Your entered Sorare username/slug, per-rarity Essence balances, UI preferences, watchlist rules, optional Sorare API Key (encrypted on your device with a key that web pages cannot reach), and a temporary 10-minute market/collection cache are stored **exclusively on your local device** in Chrome storage.
- **No external servers or analytics:** This extension does not operate a backend server, collect telemetry, track browsing history, or transmit your API key or personal data to any third party.
- **Reading your open Sorare tabs (on your device only):** Some of your Sorare data is private and not in the public API (your lineups and their live rank, Squad, daily pickers, shop packs, sealed states, Essence). The extension reads it from the data your logged-in `sorare.com` tab has already loaded, inside your browser. It sends no requests with your session and nothing leaves your computer.
- **Direct Sorare API requests:** Queries are sent directly from Chrome's background service worker to `https://api.sorare.com/graphql` (and never include your `sorare.com` browser session cookies). If you provide a personal Sorare API key, it is sent solely in the `APIKEY` request header to `https://api.sorare.com/graphql`.

## Chrome Permissions Explained
- `sidePanel`: Renders the extension workspace in Chrome's native Side Panel.
- `storage`: Persists your local settings, watchlist rules, isolated local API key, and 10-minute API cache on your device.
- `scripting`: Reads the private data listed above from your own open `sorare.com` tabs (read-only, nothing is changed or submitted).
- `notifications`: Shows optional alerts you turn on (price moves, injuries, cutoff reminder).
- `alarms`: Runs optional periodic background checks every 10 minutes for user-configured Quest and player price watchlist alerts.
- Host permissions (`https://sorare.com/*`, `https://api.sorare.com/*`, `https://site.api.espn.com/*`): Detects your Sorare handle/craft route on `sorare.com`, opens Sorare market/card tabs cleanly when clicked, queries public Sorare NBA GraphQL data, and fetches public ESPN NBA injury/schedule feeds.
