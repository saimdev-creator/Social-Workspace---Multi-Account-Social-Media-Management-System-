# Second safe enhancement pass

## WhatsApp diagnosis

Installed runtime: Electron **31.7.7**, Chromium **126.0.6478.234**. A disposable-profile diagnostic used the unmodified user agent:

```text
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.234 Electron/31.7.7 Safari/537.36
```

The fresh browser reached WhatsApp's QR login screen after initial loading. The application has no custom WhatsApp headers or user-agent overrides, and remote views already use sandboxing, context isolation and disabled Node integration.

Consequently, the reported compatibility/update screen was **not reproduced in a clean profile**. The exact cause in the existing embedded session remains unconfirmed; this test does not establish whether its stored site state, application-specific browser identification or WhatsApp's checks caused the rejection. It would be inaccurate to claim Chromium 126 categorically cannot run WhatsApp Web. No stored session was reset to investigate it.

Reproduce the isolated diagnostic with:

```powershell
.\node_modules\.bin\electron.cmd tests/whatsapp-diagnostic.cjs
```

## Exact fallback

- WhatsApp account Open shows an embedded-unavailable explanation and the normal saved account cards instead of loading the unreliable embedded page.
- Each saved WhatsApp account has **Open WhatsApp in External Browser**.
- The new IPC handler validates that the ID belongs to a saved WhatsApp account and opens only the fixed URL `https://web.whatsapp.com/`.
- The UI explains that the external browser uses its own login. It does not transfer cookies or preserve per-workspace-account isolation in that external browser.
- Existing account IDs, partition names, session-clearing behavior and authentication settings are unchanged. Opening this fallback does not rewrite metadata. The original browser path remains in place for Instagram, Facebook, Gmail and other platforms.
- No spoofing, runtime upgrade, weakened webPreferences, header interception or scraping was added.

## Demo/real separation and inbox

The sidebar switch persists in `social-workspace.preferences.v1`. The original demo storage key and its contents are untouched when switching modes.

ON retains mock messaging, mock AI and simulated publishing. OFF hides simulated data across Dashboard, Inbox, Leads, Composer, Scheduler, Calendar, Analytics, Reports and Listening. Real saved-account totals remain visible where appropriate. Unconfigured integrations show “No real connector configured yet”; demo records are never substituted for failed real requests. Demo publishing is also blocked when the mode is off.

The Inbox now actually loads through its data provider, with loading, error/retry, partial-account failure and empty states. Platform and account filters remain distinct and include explicit Read and Unread options. Selected message keys include platform, account, conversation and message identity, avoiding collisions between accounts. Long messages and names wrap. Read/category/archive changes persist in the demo store, or go through the corresponding real provider. Late async results cannot restore demo messages after switching to real mode.

Demo source links are disabled with a reason. Real source links are resolved in the main process from that account's registered connector and checked against HTTPS platform domains, then opened in the same account partition. No arbitrary renderer-supplied URL or borrowed account session is used.

## Connector contracts

`ConnectorRegistry.register(platform, accountId, provider)` requires a separate connection per account, including multiple accounts on the same platform. Providers live in the main process and receive only canonical account ID, platform and display name, not cookies or partition metadata.

Supported methods:

- `listMessages(account, payload, {signal})`
- `listLeads(account, payload, {signal})`
- `getAnalytics(account, payload, {signal})`
- `listPosts(account, payload, {signal})`
- `publish(account, payload, {signal})`
- `updateMessage(account, payload, {signal})`

Collection methods return arrays. `updateMessage` returns the updated normalized message. Requests have a bounded timeout and providers should honor the abort signal. Unregistered capabilities return `pending`; failed providers return recoverable error states without leaking provider error details.

Normalized messages include `id`, `platform`, `accountId`, canonical `accountName`, `conversationId`, `senderId`, `senderName`, `message`, ISO `timestamp`, boolean `unread`, status/category, explicit `sourceType` and a validated original URL. Wrong-account results and demo records are rejected at the real boundary. Lead and analytics/post results have their own validation. Real publishing explicitly rejects demo-tagged inputs before provider delivery.

No official provider is registered and no external message is sent. The real-mode screens are preparation for future approved integrations, not a claim of working live connectivity. The mock AI provider remains available; no Ollama or paid API dependency was added.

## Files changed in this pass

Modified:

- `main.js`: WhatsApp fallback and restricted external/source-link/connector IPC.
- `preload.js`: narrow methods for those IPC calls.
- `renderer/index.html`: mode control and new script imports.
- `renderer/script.js`: fallback account UI and browser visibility handling.
- `renderer/workspace.js`: mode routing, explicit demo badges, publish guard; inbox extracted into its own file.
- `renderer/style.css`: mode/fallback styles, wrapping, error and selection states.
- `package.json`: include new modules in syntax checks.
- `tests/domain.test.cjs`, `tests/electron-smoke.cjs`: additional safety tests.
- `README.md`: second-pass usage notes.

Created:

- `services/connectors.js`
- `services/workspaceMode.js`
- `renderer/inbox.js`
- `renderer/realWorkspace.js`
- `tests/whatsapp-diagnostic.cjs`
- `SECOND_PASS_REPORT.md`

No new dependencies. This pass did not change `services/accountManager.js`, `services/sessionManager.js`, `services/workspaceData.js`, `data/accounts.json` or existing partition identifiers.

## Tests and preservation limits

- `npm run check`: passed.
- `npm test`: **8 passed**, including mode persistence without demo changes, canonical normalization, cross-account separation, URL validation, provider failures and demo-publish rejection.
- `npm run test:electron`: passed. Existing browser/account tests remain, with additional real-mode empty states on every page, byte-for-byte demo-store preservation on toggling, provider error/retry, late-result suppression, WhatsApp external URL validation, no WhatsApp embedded view, and an Instagram fixture reopened with its cookie retained after switching through WhatsApp.
- `npm start`: launched. Another instance held the normal profile, so Chromium emitted cache/quota lock errors. The duplicate verification launch was stopped; cache/session files were not manually cleared. Clean temporary-profile Electron regression runs passed.
- The normal profile initially contained one WhatsApp account. It later became empty; the user confirmed that they deliberately deleted that WhatsApp account during testing. That deletion was left intact, with no attempted restoration or invented replacement metadata.
- No Instagram account entry was available in the current normal metadata to open through the app. Its personal logged-in state therefore remains **unverified**, despite successful Instagram fixture regression. Existing Instagram/Gmail partition directories were observed but neither edited nor used to reconstruct accounts.

To verify the updated UI in the normal profile, close the already-running old instance and run `npm start`. Do not delete profile/cache folders. If the personal Instagram account lives in another profile or copy of the app, identify that profile before testing its login.

## Still requires official APIs

Actual inbox aggregation, replies, real lead classification, analytics, publishing and listening need approved platform APIs, account-specific authorization and appropriate permissions. WhatsApp personal-chat aggregation is not implemented. The external browser action does not create an official connector. Real publishing controls remain pending until a reviewed official workflow is configured.
