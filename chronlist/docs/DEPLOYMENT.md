# Deploy ChronList v2

The ZIP is a complete source package. Nothing has been deployed to your AWS account or existing Netlify project by generating it. Keep your existing live version and backup until all release checks pass.

## 1. Extract and keep the folder structure

Open the extracted `chronlist` folder in VS Code. Publish only `public/`. The old root-level `app.js`, `auth.js`, and `auth-config.js` have moved into `public/js/`; do not mix them with the new files. Your current browser tasks remain in `chronlist.tasks.v1` on the same Netlify origin. Download a backup of important task data before deployment.

## 2. Confirm Cognito

Region: `eu-west-1` (Ireland).

- Pool: `eu-west-1_AdIsl4W6Q`.
- Public SPA app client: `2j79ldhv77qnmtib08t662149r`, with **no client secret**.
- Domain: `https://eu-west-1adisl4w6q.auth.eu-west-1.amazoncognito.com`.
- Authorization code grant only; `openid`, `email`, `profile` scopes.
- Callback and sign-out URL, including the trailing slash: `https://vocal-pavlova-b436d6.netlify.app/`.
- Email sign-in, email verification, self-registration, and password recovery enabled.
- Confirm managed login branding is assigned to this client and registration/recovery emails arrive.

Do not change the existing Cognito pool or create another unless you intend to migrate accounts.

## 3. Deploy the AWS backend

Use an AWS-authenticated terminal with AWS CLI and AWS SAM CLI installed, such as your own configured development machine or an AWS CloudShell environment with SAM available. Never paste access keys into the project. Check:

```sh
aws sts get-caller-identity
sam --version
```

From the extracted project root:

```sh
sam validate --lint --template-file backend/template.yaml --region eu-west-1
sam build --template-file backend/template.yaml
sam deploy --guided --region eu-west-1
```

Suggested guided values:

| Prompt | Value |
| --- | --- |
| Stack name | `chronlist-production` |
| Region | `eu-west-1` |
| UserPoolId | Keep supplied default |
| AppClientId | Keep supplied default |
| FrontendOrigin | `https://vocal-pavlova-b436d6.netlify.app` (no trailing slash) |
| AlertEmail | Your real operational email, or leave empty initially |
| Confirm changes before deploy | Yes |
| Allow SAM CLI IAM role creation | Yes; review the displayed changes |
| Save arguments to configuration file | Yes, locally |

Every application route requires a JWT authorizer with the `openid` scope. Do not allow unauthenticated application routes. The browser's CORS preflight is handled by HTTP API CORS. The app client uses the access token, not the ID token.

Resources include a DynamoDB on-demand table with encryption and point-in-time recovery, HTTP API, Lambda, a table-scoped execution role, 30-day function logs, and error alarms. An optional SNS email subscription sends an AWS confirmation email when deployed; confirm it to receive alerts. API Gateway performs signature/issuer/audience/expiry checking; Lambda additionally requires the access-token type, expected client, and scope, and derives ownership from the verified `sub`.

The template reserves 10 concurrent Lambda executions. If your account's concurrency quota cannot accommodate this while retaining the required unreserved capacity, request an appropriate quota or remove `ReservedConcurrentExecutions` before deploying; keep API rate limiting enabled.

These services can incur AWS charges. Set an AWS Budget appropriate to your account. On-demand capacity, backups, logs, requests, and Cognito may all have costs; this package does not promise free hosting or set a spending cap.

When deployment finishes, copy the **ApiUrl** output verbatim. It can also be retrieved with:

```sh
aws cloudformation describe-stacks --stack-name chronlist-production --region eu-west-1 --query 'Stacks[0].Outputs'
```

## 4. Connect the frontend

In `public/js/config.js`, change only:

```javascript
apiBaseUrl: "YOUR_EXACT_ApiUrl_OUTPUT"
```

Do not add `/tasks` to the base URL. The app adds route paths itself. The existing Content Security Policy permits API Gateway endpoints in `eu-west-1`. If you later use a custom API domain or another region, update `public/_headers` with that exact allowed API origin.

Until the API URL is configured, guest mode works but signed-in data stays unavailable with a clear message. There is deliberately no fallback to a shared browser task list.

## 5. Publish to the existing Netlify project

Manual deployment: open your existing project's **Deploys** page and drag in the **public folder**, not the whole project folder or backend folder. Its `index.html` must be directly inside the folder you upload. Include `_headers`, `privacy.html`, `favicon.svg`, `css/`, and `js/`.

Git-connected deployment: commit the whole source project to GitHub, connect the existing Netlify project to that repository, leave build command blank, and use `public` as the publish directory (also declared in `netlify.toml`). Review production branch settings before turning on automatic deploys.

Keep the existing URL so Cognito redirects and existing guest storage continue to work. If the URL changes, update Cognito callback/sign-out URLs, both frontend redirect URLs, the SAM FrontendOrigin parameter, and any CSP API/domain allowances consistently.

## 6. Complete live acceptance tests

Use `RELEASE_CHECKLIST.md`. Run tests with two independent accounts and two devices. A successful sign-in alone does not prove database isolation. Add your actual support contact and deletion/retention process to `public/privacy.html` before a public launch.

## Rollback

Republish the last known-good Netlify deployment from the project's deployment history. Keep the backend stack and task table intact while diagnosing. Old browser-only frontend versions do not read the new cloud table; do not interpret an empty guest list as loss of cloud data. DynamoDB is retained if the stack is deleted, and point-in-time recovery can restore into a new table. Plan the restored table's access configuration before switching traffic.

## Validation limits of this package

The shipped automated tests use fake AWS adapters and mocked HTTP requests. Static JavaScript and local desktop guest flows were checked. AWS SAM CLI was unavailable in the authoring environment, so the SAM transform/lint and live AWS deployment were not run here. Cognito login, security headers on Netlify, mobile behavior, two-account isolation, and real cross-device syncing must be verified in your deployed environment.

References:

- https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html
- https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-httpapi-oauth2authorizer.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html
- https://docs.netlify.com/deploy/create-deploys/
