# ChronList

A responsive task planner with daily, weekly, and monthly views, priorities, notes, and browser reminders. The frontend runs on Netlify. Amazon Cognito provides sign-in; a deployable API Gateway/Lambda/DynamoDB backend provides per-user task storage.

**Release status:** production candidate, not a verified live cloud release. The backend must be deployed, `apiBaseUrl` configured, and the acceptance checklist completed before launching cloud accounts to users. The existing live site has not been replaced by this package.

## Features

- Create, edit, complete, search, sort, and delete tasks.
- Weekly and monthly planning with dated tasks.
- Cognito authorization-code sign-in with PKCE and state checking; hosted registration and password recovery.
- Tab-scoped access token storage, expiry handling, and sign-out clearing of the displayed account data.
- Guest storage remains in its existing browser key. Signed-in sessions never use it as a cloud fallback.
- Explicit copying of guest tasks into the signed-in account. Existing cloud IDs are not overwritten.
- Per-task cloud CRUD with version checks that reject stale changes.
- Foreground polling every 30 seconds and manual sync, paused while editing.
- Audible reminders and a queue of simultaneous reminders; device-local reminder receipts.
- JSON backup export and validated backup restore. Restoring adds new task IDs instead of replacing existing tasks.
- Keyboard focus styles, native modal reminder dialog, reduced-motion styles, and a privacy/data page.

## Structure

| Path | Purpose |
| --- | --- |
| `public/` | The only folder to publish to Netlify |
| `public/js/config.js` | Public Cognito configuration and API URL |
| `public/js/auth.js` | Sign-in, callback, expiry, sign-out |
| `public/js/data.js` | Guest/cloud data boundary, API calls, backups |
| `public/js/app.js` | Existing planner UI and task interactions |
| `backend/handler.py` | Authenticated per-user task API |
| `backend/template.yaml` | AWS SAM infrastructure |
| `tests/` | Dependency-free security and data tests using fake AWS adapters |
| `docs/DEPLOYMENT.md` | AWS + Netlify setup and rollback |
| `docs/RELEASE_CHECKLIST.md` | Required live acceptance tests |
| `docs/OPERATIONS.md` | Backups, monitoring, account deletion, limitations |
| `docs/PORTFOLIO.md` | Portfolio copy with deployment claims kept conditional |

## Run checks

Node.js 22+ and Python 3.10+ are sufficient for the local checks; no npm installation is needed. The Lambda runtime uses Python 3.13 and its bundled boto3 SDK.

```sh
npm run check
npm test
```

Open `public/` with VS Code Live Server to test guest mode. Authentication must be tested on the configured HTTPS production origin. Do not open the files with `file://`.

## Deployment

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Deploy the AWS backend first, copy its exact `ApiUrl` into `public/js/config.js`, then publish **public/** to the existing Netlify project. Git-connected Netlify deployment uses the included `netlify.toml` automatically. Manual drop uploads must contain `index.html` directly at the root of the uploaded folder.

All Cognito IDs in this repository are public configuration, not AWS credentials. Never add passwords, tokens, `.env` secrets, or AWS access keys to GitHub.

## Limits

This is an online-first cloud app. Cloud writes require a working API and valid session; there is no offline write queue. Sessions require sign-in again when the access token expires; no refresh tokens are retained. Reminders run only while the app is open and the device is awake. Mobile OS/browser restrictions can delay or suppress audio and notifications. Tasks use local wall-clock dates and times, so 09:00 means 09:00 in each device's timezone; use matching timezones across devices. Reminder delivery is not guaranteed and this app is not suitable for critical alerts.

No license is granted by this package. Choose a license before accepting outside contributions or distributing the source under an open-source license.
