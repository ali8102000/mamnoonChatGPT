# Tasks

- [x] Cancel SMS setup at the user's request; the connection card was cancelled and no SMS connection or code was added.
- [ ] Resolve password-recovery email delivery and choose the replacement for the link; SMS was cancelled, and the delivery logs do not establish inbox receipt.

- [x] Require real email, enable signup confirmation, and enlarge registration fields; four tests pass and mobile/desktop confirmation-pending behavior verified with a simulated signup response.
- [ ] Verify receipt and confirmation link with a user-owned mailbox; confirmation sending is enabled but inbox delivery cannot be checked without the user's email test.

- [x] Redraw all technician service icons in the new illustrated style and verify all 19 available services on mobile and desktop.
- [x] Remove customer navigation, offer optional full-screen location viewing, and simplify navigation labels.
- [x] Diagnose page-loading failure and restore public backend configuration when the generated environment file is omitted from deployment.
- [x] Ensure pickup search names the selected governorate, including Najaf, and double technician reach only.
- [x] Make all warning messages Arabic only.
- [x] Price all taxi categories at exactly 400 IQD per real driving kilometer, without base/minimum surcharges.
- [x] Show driver request popup and notification for 60 seconds, widen search in timed stages, then cancel unanswered requests.
- [x] Limit place suggestions to the selected governorate and price only confirmed Google road distances (17 tests passed; build OK).
- [x] Add bilingual welcome before sign-in.
- [x] Verify welcome navigation and returning visits.
- [x] Apply required package security update.
- [x] Diagnose uploaded error screenshot and verify preview readiness.
- [x] Verify signed-in access and authentication error states (restored session; invalid-phone validation).
- [x] Restore Google Maps connection for authenticated place search and route calculation.
- [ ] Enable Routes API access for the linked Google Maps connection; Google returns ACCESS_DENIED for routes.googleapis.com, so the connection owner must enable/authorize the service.
- [ ] Add always-visible automatic location control and prevent default-center selection.
- [ ] Verify location success, refusal, and retry; Google rendering requires an authorized published origin.
- [x] Admin CSV import helper with AI column mapping
- [x] Fix maps so they work for real (Google Maps connector)
- [x] Back arrow works on every screen
