# ChronList

A responsive task planner with user accounts, cloud syncing, and audible reminders.

**Live app:** [chronlist.avantraxsolutions.com](https://chronlist.avantraxsolutions.com/)  
**Repository:** [Riot-Anette/ChronList](https://github.com/Riot-Anette/ChronList)

## Overview

ChronList helps users organize tasks through daily, weekly, and monthly views. Users can work locally in guest mode or sign in to save their tasks in the cloud and access them across devices.

I built this project to develop practical experience with frontend development, authentication, serverless APIs, cloud databases, and deployment.

## Features

- Create, edit, complete, and delete tasks
- Add notes, due dates, times, and priorities
- Search and sort tasks
- Daily, weekly, and monthly planning views
- Completion timestamps and daily progress tracking
- Audible alarms and browser notifications where supported
- A queue for reminders due at the same time
- Email registration, verification, sign-in, and password recovery
- Separate cloud task lists for each account
- Cross-device syncing
- Version checks that reject conflicting task updates
- Guest tasks stored separately in the browser
- Explicit migration of guest tasks into an account
- JSON backup export and restore
- Responsive layout and keyboard accessibility

## Technology

| Component | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Hosting and HTTPS | Netlify |
| Authentication | Amazon Cognito |
| API | Amazon API Gateway HTTP API |
| Backend | AWS Lambda with Python |
| Database | Amazon DynamoDB |
| Infrastructure | AWS SAM and CloudFormation |
| Monitoring | Amazon CloudWatch and SNS |

AWS resources are deployed in **Europe (Ireland), eu-west-1**.

## Architecture

The Netlify frontend uses Cognito for sign-in. After authentication, it sends an access token with requests to API Gateway.

API Gateway validates the token before forwarding requests to Lambda. The backend derives task ownership from the verified user's identity and reads or writes that user's DynamoDB records.

Guest mode uses browser storage and remains separate from signed-in cloud data.

## Authentication and Data Protection

- Authorization code flow with PKCE and state validation
- Access tokens stored in tab-scoped session storage
- No refresh tokens retained by the app
- Account task views cleared when signing out or processing session expiry
- Backend ownership derived from verified token claims
- Server-side task validation
- Conditional writes to reject stale updates
- DynamoDB encryption and point-in-time recovery
- Netlify security headers and Content Security Policy

Cognito client IDs and API URLs are public configuration. AWS credentials, passwords, and authentication tokens must never be committed to this repository.

## Project Structure

```text
ChronList/
├── public/
│   ├── index.html
│   ├── privacy.html
│   ├── favicon.svg
│   ├── _headers
│   ├── css/
│   └── js/
├── backend/
│   ├── handler.py
│   └── template.yaml
├── tests/
├── scripts/
├── docs/
├── .github/
├── .gitignore
├── netlify.toml
├── package.json
├── START_HERE.md
└── README.md
```

Only **public/** is published to Netlify.

## Local Development

1. Clone the repository.
2. Open the project in VS Code.
3. Serve the `public` folder using Live Server or another local web server.
4. Test guest-mode features locally.

Authentication uses the configured production domain. Running your own deployment requires your own Cognito configuration, backend deployment, callback URLs, and allowed frontend origin.

Public configuration is located in:

```text
public/js/config.js
```

## Checks and Tests

With Node.js 22+ and Python available:

```bash
npm run check
npm test
```

The project includes **33 automated tests** covering authentication handling, data boundaries, input validation, account ownership, conflicting updates, and backup validation.

These tests use mocked services and complement live acceptance testing; they are not an independent security audit.

User acceptance tests passed for:

- Sign-in and account separation
- Cloud persistence after refreshing
- Cross-device task syncing and completion
- Simultaneous reminder handling
- Backup export and restore
- Custom-domain sign-in and cloud access

## Deployment

The frontend is hosted on Netlify at:

https://chronlist.avantraxsolutions.com/

The backend is deployed through AWS SAM using the stack name:

```text
chronlist-production-v2
```

See `docs/DEPLOYMENT.md` for setup instructions and `docs/RELEASE_CHECKLIST.md` for deployment acceptance checks.

## Limitations

- Reminders require the app to remain open and the device awake.
- Audio must be enabled after a page reload.
- Browser and operating-system restrictions can delay or prevent notifications.
- Cloud saving requires an internet connection and a valid sign-in session.
- Cloud changes sync every 30 seconds while the app is visible, or through **Sync now**.
- Guest tasks remain specific to their browser and website origin.
- Task times use each device's local timezone.
- Restoring a backup adds copies rather than replacing existing tasks.

ChronList is not intended for critical or emergency alerts.

## Privacy and Support

Read the [privacy and data page](https://chronlist.avantraxsolutions.com/privacy.html) for storage, backup, and account-deletion information.

**Support:** d.ravencroft.a@gmail.com
