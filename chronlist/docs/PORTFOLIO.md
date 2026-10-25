# Portfolio preparation

Use this description after deployment and the live acceptance checks pass. Until then describe cloud features as implemented and awaiting deployment validation.

## Project description

ChronList is a responsive task-planning application with daily, weekly, and monthly views, priorities, notes, completion tracking, and browser reminders. Its frontend uses HTML, CSS, and JavaScript on Netlify. Amazon Cognito handles account registration and sign-in using the authorization code flow with PKCE. An API Gateway HTTP API and Python Lambda store each account's tasks in DynamoDB, with ownership derived from verified JWT claims. Per-task version checks reject conflicting edits from multiple devices. Guest tasks remain separate, with explicit migration and JSON backup controls.

## Engineering work to highlight

- Preserved the existing UI while separating authentication, persistence, and presentation code.
- Implemented access-controlled per-user storage and stale-write protection.
- Added error handling that preserves edits and avoids reporting failed writes as saved.
- Included AWS infrastructure as code, scoped permissions, table recovery, operational alarms, Netlify headers, and automated tests.
- Documented browser alarm limitations, privacy boundaries, backup recovery, and deployment verification.

## Honest claim boundaries

Do not describe this as a native mobile app, a real-time socket-based app, an offline-first cloud app, or an alarm service that works after the app closes. Do not claim completed live security or cloud-sync tests until they have passed. This package includes the GitHub README and CI workflow; it has not created or pushed a GitHub repository or published any LinkedIn post.
