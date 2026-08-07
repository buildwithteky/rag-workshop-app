# Troubleshooting

## Auth

**`401 Unauthorized` on every API call, even right after signing in.**
- Confirm `NEXT_PUBLIC_COGNITO_USER_POOL_ID` / `NEXT_PUBLIC_COGNITO_CLIENT_ID` in
  `frontend/.env.local` match the pool/client in `resource-ids.json` — a stale or
  mismatched pool ID produces tokens the API Gateway authorizer rejects.
- Check the API Gateway JWT authorizer's configured issuer/audience match this user
  pool exactly (`aws apigatewayv2 get-authorizer ...`).
- ID tokens expire after 60 minutes; `getFreshToken()` in `AuthContext.tsx` should
  auto-refresh via the refresh token. If sign-in is very old (>30 days), the refresh
  token itself has expired — sign out and back in.

**Stuck on the verify-email screen / code never arrives.**
- Check spam. Cognito's default email sending has a low daily quota outside of SES
  production access — for a workshop with more than a handful of signups, request SES
  production access or configure Cognito to use SES directly.

## Documents

**"No ready documents yet" even though you uploaded one.**
- Check `GET /documents/{id}/status` — if it's stuck on `PROCESSING`, the Bedrock
  ingestion job may still be running (can take a couple of minutes) or may have failed
  silently; check CloudWatch Logs for `ingest-sync` for `ingestion_job_poll_timeout` or
  `document_sync_complete` with `status=FAILED`.
- If `status=FAILED`, read `errorMessage` on the document — usually either the file
  failed Bedrock's parser (corrupt PDF, scanned-image-only PDF with no extractable text)
  or the ingestion job hit `ThrottlingException` under concurrent load.
- If you're in a **scoped conversation**, "no ready documents" can mean none of the
  *selected* documents are ready yet, even if others are — check the document scope
  picker; clear the selection to search all documents.

**Upload succeeds but the file never appears in S3.**
- The presigned URL expires in 5 minutes (`PRESIGN_EXPIRY_SECONDS`) — if the browser
  tab was idle before the PUT actually fired, request a new upload URL.
- Check the browser network tab for the `PUT` request's response — a `403` usually means
  the `Content-Type` sent didn't match what was signed; a `400` usually means the bucket
  CORS policy (`infra/docs-bucket-cors.json`) doesn't allow the calling origin.

## Chat & document scoping

**Answers ignore a document you know is ready.**
- If the active conversation has a document scope set (see the 📎 picker in the chat
  header), retrieval is restricted to exactly those documents. Clear the scope to search
  everything.
- Confirm the document's `*.metadata.json` sidecar actually exists in S3 next to the
  source file — `ingest-sync`'s `_write_metadata_sidecar` writes it before starting the
  ingestion job; if that step failed, the document was indexed without filterable
  `documentId`/`userId` metadata and will never match any filter, including the
  unscoped `userId`-only one.

**Chat history doesn't survive a page refresh.**
- Confirm you're on a version at or after the `v1-chat-history-backend` checkpoint —
  message persistence was added there. Check CloudWatch Logs for the `ask` Lambda for
  `message_persist_failed` — a DynamoDB `ClientError` there (usually a missing IAM
  permission on `rag-workshop-messages`/`rag-workshop-conversations`) means the answer
  was generated but never saved.

**A conversation I deleted still shows up.**
- The frontend removes it from the sidebar optimistically; if the `DELETE
  /conversations/{id}` call actually failed (check the network tab / CloudWatch Logs for
  `conversations`), it reappears on the next list refresh. Retry the delete.

## CORS

**Browser console shows a CORS error, but `curl` to the same endpoint works fine.**
- `ALLOWED_ORIGIN` on the relevant Lambda doesn't match the origin your browser sent
  (check the `Origin` request header vs. the Lambda's env var — `*` matches everything,
  but a locked-down deployment sets an explicit origin, which must match exactly
  including scheme and no trailing slash).
- Every Lambda must handle its own `OPTIONS` preflight (they all do,
  `if http_method == "OPTIONS": return _response(200, ...)`) — if you add a new route,
  don't forget this branch.

## Infra scripts

**`infra/render.sh` or `infra/cleanup.sh` says "Missing resource-ids.json".**
- `cp resource-ids.example.json resource-ids.json` and fill in the IDs you've created so
  far — both scripts read from it and refuse to run with fabricated defaults, on purpose,
  so they never silently target the wrong account's resources.

**`aws dynamodb create-table` (via `infra/create-tables.sh`) fails with
`ResourceInUseException`.**
- The table already exists — re-running is safe to skip; the script doesn't attempt to
  be idempotent about pre-existing tables on purpose (a create-table failure is a signal
  worth seeing, not swallowing).

## GitHub Actions / CI/CD

**Workflow fails at the `aws-actions/configure-aws-credentials` step with
`Not authorized to perform sts:AssumeRoleWithWebIdentity`.**
- The IAM role's trust policy condition on `token.actions.githubusercontent.com:sub`
  doesn't match this repo/branch. Confirm the `sub` claim format
  (`repo:<org>/<repo>:ref:refs/heads/<branch>` for branch pushes,
  `repo:<org>/<repo>:environment:<name>` for environment-gated jobs) matches exactly —
  a typo'd repo name or branch is the most common cause.
- Confirm the workflow requests `permissions: id-token: write` — without it, no OIDC
  token is minted for the step to present at all.

**Deploy step succeeds but the health check step fails.**
- Give CloudFront invalidations time to propagate before health-checking through the
  CloudFront domain; health-check the API Gateway endpoint directly first to isolate
  "backend didn't deploy" from "CDN is still serving the old build".

## Still stuck?

Check CloudWatch Logs first — every Lambda in this app logs structured JSON with an
`event` field (`request_received`, `bedrock_client_error`, `message_persist_failed`,
etc.) and the Lambda's `request_id`, so you can grep a single request's full story
across log groups. If the failure looks like a genuine bug rather than a
configuration/permissions issue, open an issue with the relevant log lines (redact your
account ID first).
