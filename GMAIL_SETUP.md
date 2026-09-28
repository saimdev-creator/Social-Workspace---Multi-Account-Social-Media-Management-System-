# Gmail connector: setup and implementation

The first real connector is implemented. Google credentials are optional at startup: the Gmail page shows **Gmail API not configured** until a Desktop OAuth configuration is imported. No Google credentials were supplied during development; automated verification uses fixtures, not live mailboxes.

## Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project dedicated to this application.
2. Under **APIs & Services → Library**, find **Gmail API** and enable it for that project.
3. Open **Google Auth Platform** (or **OAuth consent screen**). Configure Branding with an app name, support email and developer contact. Choose External audience for personal Gmail accounts; an eligible Google Workspace organization can choose Internal for organization-only use. For External testing, keep publishing status Testing and add every mailbox you intend to authorize under Test users.
4. In **Data Access**, add exactly `https://www.googleapis.com/auth/gmail.modify`. This single restricted scope covers reading, read/unread changes and sending replies; the app does not request full-mail access or unrelated Google permissions. Wider distribution may require Google verification and Workspace administrators may restrict access. See [Google scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes).
5. Under **Clients → Create client** (or **Credentials → Create OAuth client ID**), choose **Desktop app**, name it, and download its JSON configuration. Web application credentials are rejected by this app.
6. There is no hosted callback, JavaScript origin or fixed redirect port to enter. Authorization opens in your default browser. The app creates a temporary IPv4 loopback listener at `http://127.0.0.1:<random-port>/`, with the exact URL included in the authorization request, PKCE S256 and random state. Keep Social Workspace running until the browser returns to localhost and the mailbox confirmation appears. See [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).
7. Keep the downloaded JSON in a private local location, such as your Downloads folder. In Social Workspace open **Gmail → Import Google OAuth JSON** and select it. You do not need to place it in the source tree, set environment variables or paste it into chat. Import reads the file without moving it; the original download remains under your control.

The imported configuration, refresh/access tokens, cached email and send receipts are encrypted by Electron `safeStorage` in `<userData>/gmail-connector/state.enc` (normally `%APPDATA%/social-workspace/gmail-connector/state.enc` on this installation). Encryption failure stops connector storage; there is no plaintext fallback. These data are separate from `accounts.json`, renderer localStorage and Electron session partitions. They are not part of account metadata exports.

## Connect and verify account #1

1. Open the Gmail platform page and use an existing Gmail account card. If you have none, use the existing **Add Account** action; creating an account follows the original app behavior.
2. Click **Connect Gmail** on that card. Choose the intended Google mailbox in the external browser and approve the Gmail permission.
3. Return to Social Workspace and check both the email address and workspace display name before clicking **Confirm this mailbox**. OAuth consent alone does not bind the mailbox until confirmed.
4. Click **Sync this account**, turn **Demo Mode OFF**, and open **Unified Inbox**. Select Gmail and that account in the filters. The account option includes its connected email address; records show **Official**, never Demo.
5. Look for a known email received in the last 30 days among the latest 25 inbox messages. Search searches this local window only. If necessary, send yourself a test email separately, wait at least ten seconds since the previous sync, and click Refresh.
6. Mark a test message read/unread and check Gmail. Use **Open in Gmail** to open its thread in your default browser; check the selected browser mailbox. To test replying, choose a suitable test message, review the displayed sending mailbox and recipient, type your reply, and explicitly click **Send reply**.

## Connect account #2 and subsequent accounts

Use a different saved Gmail card (or Add Account), click **Connect Gmail**, select the second Google address and confirm the mapping. The OAuth client configuration is shared, but tokens, cache, sync state and API operations are separate for each existing app `accountId`. Add this address as a Google test user too. Both mailboxes appear together in the generic inbox; the account filter separates them. A mailbox already connected to another card is rejected, and reconnect cannot silently replace a card's mailbox identity. To deliberately rebind, explicitly Disconnect API first.

Rename changes the display name shown in normalized messages without changing identity or partitions. **Disconnect API** removes only that account's local connector tokens, cached messages and receipts; it leaves the workspace account and browser session intact. It does not revoke the Google project's grant globally, because that can affect other connections. You can manage/revoke application access separately in your Google Account when desired. A new connection requires consent again after local disconnect.

## Architecture and behavior

- `main.js` validates the saved account and registers its Gmail provider with the generic `ConnectorRegistry`. The narrow preload bridge exposes public status and explicit actions. OAuth configuration and tokens never enter renderer responses.
- `services/gmail/oauth.js` handles Desktop authorization code + PKCE, random callback state, cancellation, timeout, token exchange and offline refresh. `secureStore.js` provides encrypted atomic persistence and fails closed on unreadable existing data.
- `gmailService.js` owns per-account mailbox identity, tokens, locks, recent sync, remote read/unread and replies. Confirmation binds the canonical Gmail email to the unchanged app account ID. One account's failure does not stop other accounts' requests.
- `message.js` parses Gmail MIME into plain text and constructs threaded MIME replies. Every normalized record carries `id`, `connectorMessageId`, `platform`, `accountId`, current `accountName`, `conversationId` (Gmail thread ID), sender ID/name/email, subject, body, timestamp, unread state, official source, original URL and mailbox metadata. Composite UI keys include platform/account/thread/message, so identical provider IDs across mailboxes do not collide.
- Sync retrieves up to 25 Inbox messages from the last 30 days. Opening the inbox reuses cache for 60 seconds; explicit refresh has a ten-second minimum interval. A selected account refresh only syncs that account. No background polling runs. Subsequent sync replaces the recent snapshot, capturing new emails and current labels; cache survives restart.
- Cached results are explicitly labeled on offline/server/rate-limit errors. Missing authorization and expired/revoked credentials have setup/reconnect states. Read/unread updates commit locally after Gmail succeeds. Canceling OAuth leaves existing browser login alone.
- Replies use the trusted cached sender/Reply-To, authorized mailbox, thread ID, subject and RFC reply headers. Sending requires a click. A persistent request ledger prevents automatic duplicate retries if confirmation is uncertain; the user is directed to check Gmail Sent. See [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending) and [threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads).
- AI Leads remains generic and pending in real mode. The normalized message contract is ready for later classification; Gmail-specific classification, Ollama and automatic AI replies were not added. Demo ON continues using the existing mock store; switching modes does not delete it.

## Limitations

- Live OAuth consent, Google policy/admin approval and delivery still require manual verification with your configured project. API fixtures cannot prove a Google grant will be accepted.
- This is a bounded recent-message view, not full mailbox/history synchronization or a complete thread timeline. No paging older messages, Gmail-wide search, background sync or push notifications yet. History-based incremental synchronization is a later optimization.
- Plain-text email viewing and one-recipient replies only. Attachments, inline images, HTML rendering, CC/BCC, reply-all, aliases, archive/category editing, draft synchronization and showing sent messages in the inbox are not implemented. Use Gmail for these.
- Open in Gmail supplies the authorized email as `authuser`; the external browser has its own sessions and may require sign-in. OAuth does not establish or verify an Electron/browser login.
- After an uncertain send, check Sent in Gmail; the app deliberately does not retry that same message/content automatically. Use Gmail directly if another send is required. Disconnect removes local receipts as well as tokens/cache.
- Other real platform connectors, real publishing, analytics and AI lead enrichment still need their respective official integrations. Mock AI and Demo Mode remain available.

## Files changed in this pass

New: `services/gmail/errors.js`, `secureStore.js`, `oauth.js`, `message.js`, `gmailService.js`; `renderer/gmail.js`; `tests/gmail.test.cjs`; this document.

Updated: `main.js`, `preload.js`, `services/connectors.js`, `renderer/index.html`, `renderer/script.js`, `renderer/inbox.js`, `renderer/style.css`, `package.json`, `tests/electron-smoke.cjs`, `README.md`, `GMAIL_INTEGRATION_PLAN.md`. Other pre-existing working-tree changes belong to earlier enhancement passes. No dependencies were added.

## Verification and preservation

- `npm run check`: syntax checks across application modules.
- `npm test`: 17 domain/Gmail tests covering empty configuration, explicit multi-account mapping, normalization, sync/cache persistence, remote read changes, refresh failure, offline cached results, MIME safety, reply idempotency, encrypted store failure, OAuth state/PKCE/cancellation.
- `npm run test:electron`: isolated temporary profile with mock Google HTTP and a real local loopback callback; covers setup/import, two connections, official inbox, account filtering, explicit reply, read action, original URL, Demo separation, disconnect and existing workspace/session regression flows. Expected local offline fixture emits `ERR_EMPTY_RESPONSE`. No personal profile launches were used.
- Existing app account metadata remains byte-identical across tested Gmail API operations and disconnect. Fixture Facebook, Instagram and Gmail cookies and partitions remain intact. WhatsApp fallback regression also passes. Personal account/session data was not read, reset, restored or migrated by this pass; live personal login validity was not tested.
