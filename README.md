# Social Workspace

An Electron desktop workspace with isolated, persistent accounts for Facebook, Instagram, Threads, X, LinkedIn, WhatsApp, Pinterest, Gmail, Reddit and Discord. Built on the existing Electron + plain HTML/CSS/JavaScript application; no framework migration.

## Run

```powershell
npm install
npm start
```

Dependencies are already installed in this checkout. `npm start` remains `electron .`.

## Workspace features

- Dashboard: real saved-account totals and platform distribution, separately labeled demo activity and message metrics.
- Unified Inbox: local sample conversations, search, platform/account/read filters, archive/restore, categories, and read/unread actions.
- AI Leads: sample classifications, scores, service summaries, suggested replies, status and follow-up controls.
- Create Post: select multiple individual accounts per platform, attach local images, preview, save drafts, simulate publishing, and plan a schedule.
- Scheduler and monthly/weekly calendar: edit, duplicate, cancel, and review locally scheduled content.
- Analytics and Reports: local demo summaries and JSON report export. External performance metrics remain pending.
- Social Listening: manage keywords and match them against sample messages.

Demo Mode ON retains simulated messaging, AI and publishing. Demo Mode OFF supports real Gmail inbox messages, read/unread updates, explicitly sent replies and external original-conversation links after OAuth setup. Other real connectors, AI classification and publishing remain pending. There is no scraping, automatic sending, background scheduler, connected analytics, or Ollama requirement. Due posts are not sent. See [GMAIL_SETUP.md](GMAIL_SETUP.md).

## Accounts and sessions

Accounts retain the existing identifiers and persistent partition scheme. Switching views does not share or clear account cookies. Only one account BrowserView is loaded at a time, alongside any windows explicitly opened by the user.

The existing account store remains `accounts.json` under Electron's `userData` directory. The repository's `data/accounts.json` is an untouched initial template. Account rename, add, delete, manual login, browser navigation, detached windows, startup preferences, theme, metadata import/export and explicit session-clearing settings remain available.

Deleting an account still clears that account's session, as before. Clearing sessions from Settings signs accounts out. Navigating between workspace pages does neither. Saved session metadata is not proof of a valid website login; check the official platform page.

New demo data lives in the local renderer storage key `social-workspace.demo.v1`, separately from account metadata and account partitions. Draft images are limited to three PNG/JPEG/WebP files of up to 1 MB each. Storage failures are reported, and corrupt saved demo data is not overwritten automatically. No plaintext passwords, cookies or tokens are exported.

## Extension points

`services/platformManager.js` is the shared platform registry. `services/workspaceData.js` provides normalized sample messages, the local store, metrics, and mock messaging, AI and publishing provider contracts. `renderer/workspace.js` adds workspace pages to the original account renderer.

Future connectors must implement official platform authorization and per-account permissions. API credentials and real AI/network calls should remain behind the Electron main/preload boundary. WhatsApp Web is a manual browser destination; arbitrary personal chat aggregation is not provided.

## Validation

```powershell
npm run check
npm test
npm run test:electron
```

The Electron suite uses a fresh temporary user-data directory, isolated fixture accounts, and a local HTTP server. It never loads the normal user profile. Screenshots are generated under `tests/artifacts/` and excluded from Git.

See [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md) for the architecture audit, change inventory, results, limitations and manual account/session checklist.

## Second enhancement pass

The sidebar now has a persistent **Demo Mode** switch. ON shows the saved mock workspace; OFF hides it and requests only official, account-scoped connector data. Until providers are configured, real screens show pending/empty states. Switching modes never clears the demo store. Inbox records carry explicit Demo or Official labels, with loading, retry, read/unread, account filtering and safe source-link handling.

WhatsApp uses a graceful external-browser fallback. Each saved WhatsApp account offers **Open WhatsApp in External Browser**. The external browser uses its own login; it does not inherit the selected Electron partition. No user-agent spoofing, header changes, browser security changes or session resets are involved.

`services/connectors.js` defines main-process contracts for account-specific messages, leads, analytics and publishing. Gmail is the first real provider, registered separately for each existing Gmail account. `services/workspaceMode.js` stores only the mode preference, separately from existing demo records. See [SECOND_PASS_REPORT.md](SECOND_PASS_REPORT.md) for the earlier diagnostic evidence and [GMAIL_SETUP.md](GMAIL_SETUP.md) for the current connector.
