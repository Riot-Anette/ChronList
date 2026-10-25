# Release checklist

Do not announce account syncing as live until the AWS and two-account tests pass. Tests marked pending are deployment acceptance work, not known passing behavior.

## Checked in the authoring environment

- [x] JavaScript parses; local HTML asset links resolve.
- [x] API handler unit tests: owner scoping, access-token claims, validation, stale updates/deletes, and response boundaries.
- [x] Auth tests: PKCE/state, expired transactions, verified email, access-token-only storage, expiry, and sign-out.
- [x] Data tests: shared guest list cannot become signed-in fallback, paging, bearer headers, conflicts, unauthorized lockout, local receipts, guest migration, backup validation.
- [x] Desktop browser: guest add, edit, persistence after reload, completion timestamp, daily progress, weekly view, and test-alarm control.

## Must pass after deployment

- [ ] `sam validate --lint`, build, and deploy complete without errors.
- [ ] `apiBaseUrl` exactly matches the stack output; no placeholder remains.
- [ ] Netlify publishes only `public/`; backend source and tests are not served.
- [ ] Inspect response headers: CSP, no-store, nosniff, referrer policy, frame denial.
- [ ] Sign up, verify email, sign in, sign out, and password recovery all work.
- [ ] Expired/invalid tokens are rejected; signed-out tasks disappear promptly.
- [ ] GET /tasks without a token returns 401; no DynamoDB credentials exist in frontend files.
- [ ] Account A creates a task. Account B does not see it on the same browser after sign-out/sign-in.
- [ ] Account B cannot edit/delete A's task using A's task ID and B's own valid access token; A's task remains unchanged.
- [ ] Two devices signed in as A see add/edit/complete/delete changes after Sync now or the foreground poll.
- [ ] Two devices editing the same version produce a conflict instead of silently overwriting.
- [ ] On a conflict, cancel the form, Sync now, reopen the task and review before reapplying the intended change.
- [ ] Offline/cloud API failure reports an error; the edit form stays open; no false “saved” message appears.
- [ ] After a request times out, Sync now before retrying a create or delete: the server may have completed the operation.
- [ ] Guest originals remain unchanged when cloud sign-in fails. Copying guest tasks is explicit and works with two successive attempts without overwriting existing IDs.
- [ ] Export contains tasks but no tokens; restore rejects invalid files, adds new IDs, and preserves existing tasks. Store backups privately.
- [ ] Enable/Test alarm after every reload. Create two tasks due together and dismiss both in order.
- [ ] If the page is reloaded with an alarm already shown but not dismissed, its device receipt prevents replay. This package records delivery, not guaranteed acknowledgement.
- [ ] Mobile desktop-width and narrow-width layouts work; forms fit and calendar tasks remain operable.
- [ ] Mobile notification/audio restrictions are understood and tested on intended browsers.
- [ ] Operational alarm email subscription confirmed, alerts tested, and AWS Budget enabled.
- [ ] Point-in-time recovery and a restore drill are verified. Account deletion procedure is tested on a disposable account.
- [ ] Real operator/support contact and an explicit data-retention/deletion policy replace the public privacy page's launch note.

## Limits to communicate

Cloud saves require an internet connection and a valid session. The app polls while visible rather than maintaining a live socket. Alarms require the app open and the device awake; notification APIs are optional and browser-dependent. Sign-in may be required again after expiry. Guest tasks can be accessed by anyone using the same browser profile. Cross-device task times use each device's local timezone.
