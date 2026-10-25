# Validation record — 25 October 2026

## Passed

- `npm run check`: all frontend JavaScript syntax, local HTML asset paths, and duplicate-ID checks.
- `npm test`: 15 Node tests for auth/data and 18 Python API-handler tests (33 total).
- SAM YAML structural parse: authenticated routes, scoped authorizer, retained table, and three CRUD routes present.
- Local desktop browser: guest create, edit, persist across reload, complete, timestamp/progress update, weekly/monthly navigation, and test-alarm control.

## Not established by those checks

The tests use fake AWS adapters and mocked HTTP responses. They do not validate JWT signatures themselves; signature checking is API Gateway's deployed responsibility. The authoring environment lacked SAM CLI, so the template has not passed a SAM transform/lint run here. No authenticated AWS deployment was available, and no changes were made to the existing Netlify deployment or Cognito settings.

Cognito callback on the production origin, actual AWS account isolation, database permissions, cross-device polling, network failure behavior in production, Netlify-applied headers, backup downloads/restores through the browser, scheduled alarm queue behavior, and narrow-screen/mobile behavior need live acceptance tests listed in RELEASE_CHECKLIST.md. The original app's earlier user-confirmed alarm/mobile checks do not certify this restructured release.
