# Connector enhancement report

## Working behavior

Gmail retains its existing Desktop OAuth, encrypted credentials/tokens, explicit mailbox binding, read/unread, reply and external Gmail behavior. Initial synchronization now requests 50 recent Inbox messages per connected account. Gmail's opaque `nextPageToken` is stored beside that account's existing cache. After selecting an account in Unified Inbox, **Load next 50** requests that token, fetches only those message bodies, merges them by Gmail message ID and hides itself when no token remains. Refresh begins a new first-page snapshot; the existing 60-second cache and ten-second forced-refresh guard remain. The app never requests the whole mailbox.

The encrypted store remains schema version 1. Existing entries without `nextPageToken` continue to load; their next normal refresh establishes pagination metadata. Account ID, current display name, OAuth mailbox, thread/message identity, sender, body, subject, timestamp, read state, reply state and source remain account-scoped. Per-account sync locks and four-at-a-time message detail requests limit load on modest Windows hardware.

Unified Inbox still requests the generic `messages` capability from every saved account. Official records are normalized by the shared registry and aggregated across providers. Platform, account, active/archived and read/unread filters operate on the combined collection. Gmail is the only live provider today; an official Facebook or Instagram provider can register the same account-scoped capability without changing the inbox.

AI Leads in real mode now requests normalized `messages`, independent of Gmail. `LocalLeadProvider` returns lead/non-lead, numeric score, priority, reason, replied state, suggested reply, source platform and source account. It is a simple local keyword-rule placeholder and every result says **Mock AI** / `mock-local-rules`; it is not a trained model and never sends a reply. Its interface can later be implemented by a local Ollama provider without adding platform logic to AI Leads. Demo Mode continues using its original mock records and badges.

The existing generic connector capabilities for messages, leads, analytics, posts and publishing remain the extension points for Create Post, Scheduler, Calendar, Analytics and Reports. Unsupported real screens continue to show empty/pending states. Gmail remains messaging-only. No real publishing, analytics, scheduled delivery or listening behavior is claimed.

## Meta foundation

Facebook and Instagram account pages now show official Meta connector setup panels. A local JSON file with `app_id` and `app_secret` can be imported into a separate Electron `safeStorage` encrypted file at `<userData>/meta-connector/state.enc`; the secret never enters renderer code or account metadata. Configuration alone produces **Facebook Page connection required** or **Instagram Professional account connection required**, plus **Permission/review required**. Missing configuration produces **Meta connector not configured** and **Meta app credentials required**. Store failures produce **Sync error**.

The connection controls are deliberately disabled. Nothing reports **Connected** until a later implementation completes official Meta authorization and verifies an eligible asset. No Page tokens, Instagram Professional identities, webhook subscriptions or conversations are fabricated. Saved Facebook/Instagram browser sessions are not inspected or reused.

To activate Meta later, the user must create a Meta developer/business app, choose supported messaging products/use cases, configure an official OAuth redirect, connect and select managed Facebook Pages and linked Instagram Professional accounts, request the exact permissions required by the chosen Graph API version, configure and verify webhooks, complete business verification and App Review where required, and supply a public HTTPS webhook service. Exact permission names and review requirements should be selected against Meta's current documentation when that implementation begins.

## Files changed

- `services/gmail/gmailService.js`, `services/gmail/message.js`: page-token sync, 50-item pages, deduplication, backward-compatible cache and replied state.
- `services/connectors.js`: paged collection metadata while retaining array-provider compatibility; normalized replied state.
- `renderer/inbox.js`: account-scoped Load next 50 and combined connector-state preservation.
- `services/workspaceData.js`, `renderer/workspace.js`, `renderer/realWorkspace.js`: connector-agnostic real-message lead provider and clearly labeled local mock results.
- `services/meta/metaService.js`, `renderer/meta.js`: official Meta configuration/status foundation.
- `main.js`, `preload.js`, `renderer/script.js`, `renderer/index.html`: narrow Meta IPC and platform setup integration.
- `tests/gmail.test.cjs`, `tests/domain.test.cjs`, `tests/electron-smoke.cjs`: pagination/deduplication, legacy-cache, normalization, mock-lead and Meta false-connected regressions.
- `package.json`: syntax-check coverage for the new modules.
- `CONNECTOR_ENHANCEMENT_REPORT.md`: this report.

No package dependency was added. No account creation, deletion, ID/partition rename, OAuth reauthorization, token migration, session clearing or personal profile launch is performed by this enhancement.

## Verification

- `npm run check`: passed.
- `npm test`: 20/20 tests passed. Coverage includes Gmail page tokens/deduplication and a schema-1 cache without pagination data, connector normalization, real-message local lead output, and proof that imported Meta credentials alone remain `connected: false`.
- `npm run test:electron`: passed in a fresh temporary profile with mocked Google APIs. It covers two Gmail accounts, official inbox aggregation, account filtering, Load More deduplication, read/reply/Open in Gmail, Demo separation, and unchanged account metadata and fixture cookies after connector disconnect. The deliberate offline fixture logs `ERR_EMPTY_RESPONSE`.

Automated Google and Meta calls use fixtures. Current personal Gmail connections and personal session partitions were not opened or altered. The next manual action is only needed for Meta development: prepare the developer/business app and webhook deployment before enabling authorization. Existing Gmail users need no setup; select one Gmail account in Unified Inbox to use Load next 50 after the next refresh.
