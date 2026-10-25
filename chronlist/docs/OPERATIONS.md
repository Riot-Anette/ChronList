# Operations and data handling

## Data model and access

DynamoDB uses `userId` (verified Cognito subject) as the partition key and `taskId` as the sort key. Each row holds a whitelisted task object and a numeric version. The backend never accepts a browser-supplied owner. API Gateway validates JWT signatures and claims; the Lambda verifies expected token type/client/scope again. The IAM role is restricted to Query/GetItem/PutItem/DeleteItem on the one task table. CORS alone is not authorization.

Every create uses `expectedVersion: 0` and an absent-item condition. Updates and deletes require the current version. A stale write returns 409. Changes are committed before the UI reports a save; a failed edit retains the form contents. No automatic retry of a write is performed because a timed-out request may already have succeeded. Sync before retrying.

GET /tasks paginates at 100 records and uses strongly consistent reads. The browser follows pagination. This is not a transactionally frozen snapshot across all pages; foreground sync refreshes it. For very large task sets, add a date-range/index strategy and measure traffic before scaling. This package does not impose an account-wide task quota or provide abuse-resistant per-user billing limits.

Guest storage retains the previous browser key. Signed-in cloud task lists are held in memory and are not cached in localStorage. Auth tokens remain in sessionStorage; there is no refresh token. Closing/reopening a tab may require sign-in again, depending on browser session restoration. A reload reuses a still-valid access token. On expiry the account task view clears and edits are blocked. An unsubmitted editor is closed on session expiry; save your work before the session ends.

## Reminder behavior

Sound preferences and receipt keys are device-local. A delivery receipt contains task ID, local date/time, reminder flag, and a delivery timestamp. It is written when the reminder is shown, not after acknowledgement. Reloading during an alarm will not replay that delivered alarm. The in-memory queue is not a durable notification service. Receipts are capped at 2,000 per owner/browser; very old reminders can replay after eviction. Completed or deleted queued tasks are skipped when proceeding to the next reminder.

Click Test alarm on each page load to unlock audio. Browser permission and OS settings control notifications and background behavior. No service worker, Web Push subscription service, email delivery, or closed-app alarm scheduler is included. Reminders are not suitable for medication, emergencies, or other critical deadlines.

## Backups and recovery

DynamoDB point-in-time recovery is enabled; verify its status and configured retention in AWS. Stack deletion retains the table. Retained tables and backups can continue to incur charges. Review them explicitly when retiring the application.

The Export backup control exports only the currently loaded guest list or current account's tasks. It includes no auth tokens. Restoring adds fresh IDs and never replaces existing tasks, so restoring twice duplicates tasks. A partial restore leaves already-saved records in place and reports progress; review before restarting. Keep backups private and test restoration before relying on them. Browser guest originals are not removed during migration to cloud.

## Monitoring

Monitor the API 5xx CloudWatch alarm for handled failures, Lambda Errors for unhandled failures, and throttles/latency as traffic grows. The template's optional SNS subscription needs email confirmation. Error logs contain request IDs and error categories, not task names, notes, email addresses, or tokens. Function logs expire after 30 days. Never add raw request-body/token logging during debugging. Configure AWS Budgets and review on-demand requests, Cognito usage, backup storage, and logs.

## Support and account deletion

Before inviting public users, publish a real support address on the privacy page. Establish an operator-controlled deletion process:

1. Verify the requester's ownership through an authenticated support process; do not trust a supplied email or user ID alone.
2. Record the confirmed Cognito `sub` securely. Disable the account to stop new sign-ins and revoke its sessions. Existing issued JWT access tokens may remain usable until their expiry; API JWT authorizers do not check Cognito revocation on every request. For immediate deletion enforcement add an application denylist checked by the backend, or wait for access-token expiry before final data removal and verify no further writes occur.
3. Query and delete all rows in the task table partition for that verified subject, following every page. Do not scan/delete other users' partitions. Remove the Cognito account through an authorized administrator.
4. Explain that downloaded backups and guest copies are separate, and database recovery backups may keep records until their recovery window expires. Keep deletion records and retention terms consistent with the operator's published policy.

There is no automatic/self-service account deletion endpoint in this version. Do not claim one in the UI or portfolio.

## Timezones

Task date/time fields are floating local wall-clock values. If a user changes timezone, a 09:00 task remains 09:00 locally. No IANA timezone or absolute UTC due timestamp is stored. Use matching device timezones for consistent cross-device alarms. Add explicit timezone support before offering timezone-sensitive scheduling.

## Domain changes

Update Cognito URLs, config redirect/logout values, the SAM FrontendOrigin parameter, and CSP connection origins together. Keep the original Netlify origin when preserving existing guest data. The CSP permits inline styles because the existing UI updates progress widths; inline JavaScript and third-party scripts are blocked. If Netlify injects an optional badge or analytics script, remove the integration or audit it explicitly rather than broadening the script policy blindly.
