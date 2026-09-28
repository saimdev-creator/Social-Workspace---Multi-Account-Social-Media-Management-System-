# WhatsApp account-status refinement

The existing external-only behavior is unchanged. The persistent in-app heading and Open feedback now say **Embedded WhatsApp unavailable**. The external button remains **Open WhatsApp in External Browser**.

Each card separates three facts:

| Field | Current status |
| --- | --- |
| Embedded access | Embedded Unavailable |
| Access method | External Browser Only |
| Electron login | Login Verification Required |

**Embedded Available** is reserved for a future successfully verified embedded path. It is not shown by this external-only build. External browser launch does not prove authentication, and neither statuses nor metadata are changed by it. The ambiguous “Open” suffix has been removed from WhatsApp cards.

Only renderer/script.js, renderer/style.css and the isolated Electron regression test changed for this UX refinement. No main/preload/session/connector implementation or stored account/demo data changed. Gmail remains planning-only; see GMAIL_INTEGRATION_PLAN.md.

Validation: syntax checks, all eight domain tests and the Electron regression suite passed. New assertions check exact status text, unchanged status after external launch, byte-for-byte fixture metadata preservation and retained WhatsApp/Gmail cookies. Existing Instagram/Facebook isolation and navigation checks also pass. Tests use temporary profiles and mock the external browser launch. This pass did not open or modify personal session stores; personal live authentication was not retested.
