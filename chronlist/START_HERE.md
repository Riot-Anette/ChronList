# Start here

Your design is preserved. The project now separates the browser frontend from the AWS backend and test/documentation files.

1. Keep a copy of the existing project and important task data.
2. Open `docs/DEPLOYMENT.md` and deploy `backend/template.yaml` in your AWS account using AWS SAM.
3. Copy the exact stack **ApiUrl** output into `public/js/config.js`.
4. Review the privacy/support launch note in `public/privacy.html` and add your real contact details and policy.
5. Upload **public/** to the existing Netlify project's Deploys page. Do not upload the entire project as the website folder.
6. Complete `docs/RELEASE_CHECKLIST.md` with two accounts and two devices before announcing cloud syncing.

Guest mode works without the backend. Signed-in mode intentionally blocks task access until the API is configured, so account data cannot silently become shared guest data. No cloud resources or live websites were changed when this package was generated.

The AWS template was structurally parsed and the handler tested with fake AWS adapters. A real SAM validation/deployment and end-to-end Cognito/API tests remain necessary. This is a production candidate, not a certification of a running service.
