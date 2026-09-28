# Gmail first: original implementation plan

This historical plan is superseded by the implemented first connector described in [GMAIL_SETUP.md](GMAIL_SETUP.md). The first release uses a bounded recent inbox snapshot, not history synchronization; Open in Gmail uses the external browser. See the setup document for current behavior and limitations.

## Authentication and account isolation

Use Google's Desktop OAuth authorization-code flow with PKCE, a random state value and a temporary loopback listener. Authorization opens in the system browser, not an Electron login view. Token exchange and refresh stay in the main process. Store refresh tokens using Windows-protected encryption in a separate connector store, never account metadata, renderer storage, exports or logs. Do not reuse or transfer Gmail browser cookies. [Google desktop OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app).

Each existing Gmail `accountId` gets its own OAuth connection and refresh token. After consent, fetch the authorized mailbox identity and ask the user to confirm its association with the selected workspace account. Never bind whichever Google account happens to be open without that confirmation. Keep IDs, display names and Electron partitions unchanged; disconnecting a connector affects only its OAuth connection.

For the requested read, mark-read and reply functionality, request `gmail.modify`, which includes reading and sending without permanent deletion. Avoid the broader full-mail scope and redundant scopes. This is a restricted scope; Google verification requirements depend on distribution and data handling. Begin with explicitly listed test users. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Unified Inbox ingestion

Implement a main-process Gmail provider behind the existing account-specific ConnectorRegistry. Start with paginated recent Inbox messages via `messages.list`/`messages.get`; parse MIME safely and display plain text or sanitized content. Maintain a per-account local cache and history cursor. Use bounded refresh while running, incremental history synchronization, and resync if history expires. No scraping or cloud push service is needed initially. [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync).

Every normalized message keeps `platform: gmail`, existing `accountId`, current canonical `accountName`, Gmail message ID, `conversationId: threadId`, sender identity, body, timestamp and unread state. Deduplicate by account plus message ID; group conversations by account plus thread ID. Display Official badges exclusively in real mode. A rename updates display metadata without changing token ownership or message identity.

## Read, reply and original conversation

- **Unread/read:** derive unread from the `UNREAD` label. Add/remove it through `messages.modify`; update the UI after success and keep prior state on failure. Archive separately removes `INBOX`. [Modify labels](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify).
- **Reply:** add a dedicated reply capability rather than using social-post publishing. The user reviews recipients, sending mailbox and content before Send. Build a MIME reply with Gmail `threadId`, matching subject and `In-Reply-To`/`References` headers. Prevent duplicate sends on uncertain responses and show the confirmed result. [Gmail threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads).
- **Open original:** add a Gmail-specific link resolver validated against real Gmail thread navigation. Use only the selected account's existing Electron partition, after the user confirms the web mailbox matches the OAuth mailbox. Never assume `/u/0` identifies the intended account. If a reliable thread link cannot be resolved, explain that limitation and offer the Gmail mailbox with message-search details. OAuth authorization does not establish an embedded-browser login.

## Setup required from you

1. A Google Cloud project with Gmail API enabled.
2. An OAuth consent configuration and a **Desktop app** OAuth client; import its downloaded client configuration locally rather than posting credentials in chat.
3. The Gmail addresses to connect, added as test users when using an external app in Testing, and consent for each mailbox. Workspace administrators may need to approve access.
4. Confirmation of the Gmail-address-to-workspace-account mapping and whether this is personal/internal use or intended for wider distribution.

No Gmail passwords or session cookies are required. Implementation order: OAuth and account binding → read-only inbox sync → read/archive actions → explicit replies → verified source links. Acceptance tests will cover two Gmail accounts, wrong-account rejection, token refresh/revocation, rename persistence, pagination/history recovery, MIME safety and failed actions without false success.
