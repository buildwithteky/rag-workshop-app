# rag-workshop-app

A production-shaped, multi-tenant RAG (Retrieval-Augmented Generation) chat app built
entirely on AWS managed services, and the code-along project for the **Building
Production-Ready RAG Applications on AWS** workshop (AWS User Group Bhopal).

Users sign up, sign in, upload their own PDF/TXT documents to a private workspace, and
chat with answers grounded strictly in their own documents — with source citations,
**persistent chat history**, and **per-chat document scoping** (pick which of your
documents a given conversation is allowed to draw on).

No LangChain/LlamaIndex, no Docker/Kubernetes/EC2, no custom password storage, no
custom vector database to operate — Cognito handles identity, a Bedrock Knowledge Base
handles chunking/embedding/retrieval/grounded generation, DynamoDB holds document and
conversation metadata.

## Features

- Email/password auth via Amazon Cognito (sign up, verify, sign in, session persistence)
- Per-user document upload (PDF/TXT) via presigned S3 URLs, with live status polling
- Retrieval-augmented chat grounded in your own documents, with citations
- **Persistent chat history** — desktop collapsible left sidebar, mobile bottom-sheet
  drawer; new chat, rename, delete, select
- **Per-chat document scoping** — restrict a single conversation's retrieval to a chosen
  subset of your documents, enforced at the vector-retrieval filter, not just in the UI
- Multi-tenant isolation: every retrieval is filtered by the authenticated user's
  identity, never a client-supplied value
- Fully serverless AWS deployment (Lambda, API Gateway, S3, CloudFront, DynamoDB, Bedrock)

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full request-flow diagrams, data model,
and security model. Quick summary:

```
Browser (Next.js static export on CloudFront + S3)
   │ Cognito ID token on every API call
   ▼
API Gateway (HTTP API, Cognito JWT Authorizer on every route)
   ├─ /documents...     → documents-upload / documents-manage Lambdas → S3 + DynamoDB
   ├─ /conversations...  → conversations Lambda → DynamoDB (chat history + doc scope)
   └─ /chat              → ask Lambda → Bedrock RetrieveAndGenerate
                              (filtered by userId AND, if scoped, documentId)
                                   │
S3 ObjectCreated/Removed event    ▼
   → ingest-sync Lambda    Amazon Bedrock Knowledge Base
     (metadata sidecar,      ├─ Embeddings: Titan Text Embed v2
      ingestion job,         ├─ Vector store: Amazon S3 Vectors
      status sync)           └─ Generation: Amazon Nova Lite
```

## Repository structure

```
rag-workshop-app/
├── backend/lambda/
│   ├── index.py               # POST /chat — retrieval + generation, message persistence
│   ├── conversations.py       # /conversations... — chat history CRUD + document scoping
│   ├── documents_upload.py    # POST /documents/upload — presigned URL issuance
│   ├── documents_manage.py    # GET/DELETE /documents...
│   └── ingest_sync.py         # S3-event-triggered Bedrock ingestion + status sync
├── frontend/                   # Next.js (static export) + TypeScript + Tailwind
│   ├── src/app/                 sign-in, sign-up, verify, dashboard, dashboard/documents
│   ├── src/components/          ChatShell, ConversationSidebar, ConversationHistorySheet,
│   │                             DocumentScopePicker, ChatInterface, DocumentList, ...
│   └── src/lib/                 AuthContext.tsx (Cognito), api.ts, types.ts
├── infra/                       IAM policy templates, DynamoDB table creation, KB config,
│                                 CloudFront config, render.sh, cleanup.sh
├── docs/                        ARCHITECTURE.md, TROUBLESHOOTING.md, original workshop brief
├── resource-ids.example.json    Template for resource-ids.json (gitignored, your real IDs)
└── .github/workflows/           CI/CD pipeline (build, test, deploy via GitHub OIDC)
```

## Prerequisites

- Node.js 20.9+, npm
- Python 3.12+ (for local Lambda syntax checks; no local Python runtime is required to deploy)
- AWS CLI v2, configured with credentials that can create the resources below
- An AWS account with Bedrock model access enabled for `amazon.titan-embed-text-v2:0`
  and `amazon.nova-lite-v1:0` in your target region
- `jq` (used by a couple of infra scripts)

**Never commit AWS credentials to git.** Every script in this repo either uses your
locally configured AWS CLI credentials or an IAM role — there is no code path that reads
an access key from a file or environment variable meant to be committed.

## Setup (from an empty AWS account)

This mirrors the workshop's own build order — see the [workshop checkpoints](#workshop-checkpoints)
below if you'd rather start from a further-along state than the beginning.

1. **Clone and configure your resource IDs.**
   ```bash
   git clone <your-fork-or-this-repo-url> rag-workshop-app
   cd rag-workshop-app
   cp resource-ids.example.json resource-ids.json   # fill in as you create each resource
   ```
2. **Provision AWS resources** — Cognito User Pool, S3 buckets, DynamoDB tables
   (`bash infra/create-tables.sh`), the Bedrock Knowledge Base (`infra/kb-create.json`,
   rendered via `bash infra/render.sh`), IAM roles/policies (`infra/*.json`, also
   rendered), Lambda functions, API Gateway routes + JWT authorizer, CloudFront
   distribution. Full step-by-step commands are in the workshop slide deck
   (`../deck-src/slides.html`) — each step ends with the exact `resource-ids.json` key
   to fill in.
3. **Deploy the backend.**
   ```bash
   cd backend/lambda
   for fn in index conversations documents_upload documents_manage ingest_sync; do
     zip -q "../$fn.zip" "$fn.py"
   done
   # aws lambda update-function-code --function-name ... --zip-file fileb://../<fn>.zip
   ```
4. **Run the frontend locally.**
   ```bash
   cd frontend
   cp .env.example .env.local   # fill in NEXT_PUBLIC_API_URL, Cognito pool/client IDs
   npm install
   npm run dev                  # http://localhost:3000
   ```
5. **Deploy the frontend.**
   ```bash
   cd frontend
   npm run build
   aws s3 sync out/ "s3://$(jq -r .s3FrontendBucket ../resource-ids.json)/" --delete
   aws cloudfront create-invalidation \
     --distribution-id "$(jq -r .cloudFrontDistributionId ../resource-ids.json)" --paths "/*"
   ```

For the automated path, see [.github/workflows/deploy.yml](./.github/workflows/deploy.yml) —
pushing to `main` builds, tests, and deploys automatically via GitHub OIDC (no long-lived
AWS keys stored in GitHub).

## CI/CD

Every push and PR runs [`.github/workflows/ci.yml`](./.github/workflows/ci.yml): frontend
lint + typecheck + build, backend compile-check + `pytest` (moto-mocked AWS, no real
account needed), and a security/quality pass (a guard script that fails the build if a
real AWS account ID or access key ever gets hardcoded back into `infra/*.json`, plus
`npm audit` / `pip-audit`).

Pushing to `main` additionally runs [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml),
which requires that same CI gate to pass on the exact commit before touching AWS, then:
**build → deploy Lambdas + frontend → health-check the live API and CloudFront →
roll back to the last known-good commit automatically if the health check fails.**

AWS authentication uses **GitHub's OIDC provider and a federated IAM role — no
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secret is ever stored in GitHub.** One-time
setup:

```bash
GITHUB_ORG=your-org GITHUB_REPO=rag-workshop-app bash infra/setup-github-oidc.sh
```

This registers `token.actions.githubusercontent.com` as an OIDC provider, creates an IAM
role whose trust policy only allows `sts:AssumeRoleWithWebIdentity` for this exact
`repo:<org>/<repo>:ref:refs/heads/main` subject claim (see
`infra/github-oidc-trust-policy.json`), and attaches a least-privilege deploy policy
(`infra/github-actions-deploy-permissions-policy.json` — only `UpdateFunctionCode` on
this app's 5 functions, S3 on the frontend bucket, CloudFront invalidation, and the one
SSM parameter used as a rollback marker).

Then set these in **Settings → Secrets and variables → Actions → Variables** on the repo
(none of these are secrets — they're identifiers, safe as plain Variables):

| Variable | Example |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | printed by `setup-github-oidc.sh` |
| `AWS_REGION` | `us-east-1` |
| `API_URL` | `https://<api-id>.execute-api.us-east-1.amazonaws.com` |
| `NEXT_PUBLIC_API_URL` | same as `API_URL` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | from `resource-ids.json` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | from `resource-ids.json` |
| `FRONTEND_BUCKET` | `rag-workshop-frontend-<account-id>` |
| `CLOUDFRONT_DISTRIBUTION_ID` | from `resource-ids.json` |
| `CLOUDFRONT_DOMAIN` | `<distribution>.cloudfront.net` |

## Environment / configuration reference

- Frontend: [`frontend/.env.example`](./frontend/.env.example)
- Backend (per-Lambda env vars): [`backend/.env.example`](./backend/.env.example)
- AWS resource IDs: [`resource-ids.example.json`](./resource-ids.example.json) →
  copy to `resource-ids.json` (gitignored) and fill in as you provision each resource

None of these are secrets — they're identifiers, not credentials. No AWS access keys are
ever embedded in code or committed to this repo; every Lambda uses its own IAM execution
role, and the frontend never touches AWS credentials at all.

## Workshop checkpoints

If you fall behind (or want to jump ahead and see a later stage working), every major
milestone is a git tag you can check out directly:

| Tag | What it is |
|---|---|
| `v0-baseline` | Auth, upload, single-shot RAG chat — no history, no scoping |
| `v1-chat-history-backend` | + DynamoDB tables and Lambda APIs for chat history & document scoping |
| `v1-chat-history` | + frontend: sidebar/mobile drawer, document scope picker (full feature, end to end) |

```bash
git checkout v1-chat-history   # jump straight to a known-good, fully working stage
```

More tags are added as later workshop sections (CI/CD, further hardening) land — run
`git tag` to see the current full list.

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common failure modes (auth 401s,
"no ready documents" despite an uploaded file, empty answers under document scoping,
CORS errors, ingestion job conflicts, GitHub Actions OIDC trust errors) and how to
diagnose each one.

## Cleanup

```bash
bash infra/cleanup.sh
```

Tears down every `rag-workshop-*` resource in the account referenced by your
`resource-ids.json`: CloudFront distribution/OAC/Function, both S3 buckets, API Gateway,
all Lambda functions, the Cognito User Pool (**deletes all registered users**), all
DynamoDB tables, the Bedrock Knowledge Base and data source, the S3 Vectors index and
bucket, all IAM roles, and the CloudWatch log groups. Review before running.

## Cost considerations

Everything here is pay-per-use with no idle charge: Cognito is free for the first 10,000
monthly active users; DynamoDB on-demand and the CloudFront Function are a few cents a
month at workshop scale; S3 Vectors/Bedrock KB and Lambda/API Gateway are billed per use
and comfortably inside the free tier at workshop volume. Realistic estimate for
workshop/demo use: **under $1–3/month**, dominated by Bedrock model invocation tokens if
usage grows. See `docs/` for the deeper cost/scaling discussion from the workshop.

## License

MIT — see [LICENSE](./LICENSE). This is workshop/reference code: review it before
running it against production data.
