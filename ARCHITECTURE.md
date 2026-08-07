# Architecture

## Request flow

```
Browser (Next.js static export on CloudFront + S3)
   │  Cognito auth (SRP, sign up/in/out, session persistence via localStorage)
   │  Authorization: Bearer <Cognito ID token> on every API call
   ▼
Amazon API Gateway (HTTP API) — Cognito JWT Authorizer on every route
   │
   ├─ POST /documents/upload      → documents-upload Lambda  → DynamoDB + presigned S3 PUT URL
   ├─ GET  /documents             → documents-manage Lambda  → DynamoDB Query (by userId)
   ├─ GET  /documents/{id}/status → documents-manage Lambda  → DynamoDB GetItem
   ├─ DELETE /documents/{id}      → documents-manage Lambda  → S3 delete + DynamoDB delete
   │
   ├─ GET    /conversations                 → conversations Lambda → DynamoDB Query (userId)
   ├─ POST   /conversations                 → conversations Lambda → DynamoDB PutItem
   ├─ PATCH  /conversations/{id}            → conversations Lambda → DynamoDB UpdateItem
   ├─ DELETE /conversations/{id}            → conversations Lambda → DynamoDB batch delete
   ├─ GET    /conversations/{id}/messages   → conversations Lambda → DynamoDB Query (conversationId)
   │
   └─ POST /chat → ask Lambda → Bedrock RetrieveAndGenerate
                                    (filter: userId equals AND, if scoped, documentId in [...])
                                         │
        S3 ObjectCreated/ObjectRemoved event                    ▼
        (users/{userId}/documents/{documentId}/*)      Amazon Bedrock Knowledge Base
                 │                                        ├─ Embeddings: Titan Text Embed v2
                 ▼                                        ├─ Vector store: Amazon S3 Vectors
        ingest-sync Lambda                                └─ Generation: Amazon Nova Lite
        writes per-document metadata sidecar (userId,
        documentId as filterable attrs), starts/polls
        Bedrock ingestion job, updates DynamoDB status

CloudWatch Logs — structured JSON logs from every Lambda
```

No LangChain/LlamaIndex, no Docker/Kubernetes/EC2, no custom password storage, no
custom vector database to operate — Cognito handles identity, Bedrock Knowledge Bases
handles chunking/embedding/retrieval/grounded generation, DynamoDB holds only
document/conversation/message metadata and ownership.

## Authentication flow

1. **Sign up** (`/sign-up`) — Cognito User Pool, email as username, password policy (min
   8 chars, upper+lower+number). Cognito sends a verification email automatically.
2. **Verify** (`/verify`) — user enters the emailed code; `confirmRegistration` against
   Cognito. Resend supported.
3. **Sign in** (`/sign-in`) — SRP authentication via `amazon-cognito-identity-js`
   (password never leaves the browser in plaintext over the wire in a replayable form).
   Cognito issues ID/access/refresh tokens.
4. **Session persistence** — tokens persist in `localStorage` under the Cognito SDK's own
   keys; `AuthContext` restores the session on page load, so a refresh keeps the user
   signed in until the refresh token expires (30 days) or they sign out.
5. **Protected routes** — `/dashboard` and `/dashboard/documents` are wrapped in a
   `ProtectedRoute` client component that redirects to `/sign-in` if no valid session is
   found.
6. **Authenticated API access** — every API call fetches a fresh ID token and sends
   `Authorization: Bearer <idToken>`. API Gateway's **Cognito JWT Authorizer** validates
   the token's signature, issuer, and audience *before* any Lambda runs —
   unauthenticated or tampered/expired tokens get a `401` directly from API Gateway; the
   Lambda code never executes.
7. **Sign out** — clears the local Cognito session.

No custom password storage or hashing exists anywhere in this codebase — Cognito owns
all credential material.

## Tenant isolation & document scoping

Rather than provisioning a separate Knowledge Base / vector index per user (expensive
and slow to provision dynamically), this app uses **one shared Bedrock Knowledge Base
with metadata-filtered retrieval**, layered with a second, per-*conversation* filter for
document scoping:

- Every uploaded document gets a companion `*.metadata.json` sidecar in S3 (written
  server-side by the sync Lambda, never by the client) containing `userId` and
  `documentId` as **filterable** metadata attributes.
- The `userId` used in every filter, and every S3 key / DynamoDB partition key, is the
  **Cognito `sub` claim taken from the verified JWT**
  (`event.requestContext.authorizer.jwt.claims.sub`) — never a client-supplied value, so
  a user cannot forge another user's identity.
- Every `RetrieveAndGenerate` call includes
  `retrievalConfiguration.vectorSearchConfiguration.filter =
  {"equals": {"key": "userId", "value": "<authenticated sub>"}}` — this alone guarantees
  cross-tenant isolation regardless of document scoping.
- **Document scoping** adds a second, ANDed condition when a conversation has a non-empty
  `documentIds` list:
  ```json
  {
    "andAll": [
      {"equals": {"key": "userId", "value": "<authenticated sub>"}},
      {"in": {"key": "documentId", "value": ["<doc-1>", "<doc-2>"]}}
    ]
  }
  ```
  The `documentIds` list is **read server-side from the conversation record**
  (`conversations.py` validates every ID belongs to the caller before it can be saved as
  a scope), never accepted directly on the `/chat` request body — so a tampered request
  can't widen a conversation's scope beyond what its owner selected in the UI. This makes
  document scoping a *retrieval-time* guarantee: even a successful prompt-injection
  attempt inside a document can't make the model see documents outside the chat's scope,
  because the vector search itself never returns them.
- S3 objects are stored under `users/{userId}/documents/{documentId}/{fileName}`; every
  S3/DynamoDB operation in every Lambda re-derives the key from the authenticated
  `userId`, never trusts a client-supplied path.
- Document/conversation management endpoints look up by compound key
  `(userId, documentId)` / `(userId, conversationId)` — requesting another user's ID
  returns a generic `404`, not a `403`, so existence of another user's resource is never
  disclosed.
- Citations returned by chat only ever include the filename of documents that passed the
  retrieval filter; the raw S3 URI / bucket path is stripped from the API response.

## Chat history data model

Two DynamoDB tables, both on-demand billing (`infra/create-tables.sh`):

**`rag-workshop-conversations`** — one item per chat.
| Attribute | Type | Notes |
|---|---|---|
| `userId` (PK) | S | Cognito `sub` |
| `conversationId` (SK) | S | UUID |
| `title` | S | User-set, or auto-derived from the first question |
| `documentIds` | List\<S\> | The per-chat document scope; empty = search all documents |
| `messageCount` | N | Incremented by 2 per turn (user + assistant) |
| `createdAt` / `updatedAt` | N | Epoch seconds; `updatedAt` drives sidebar ordering |

**`rag-workshop-messages`** — one item per chat turn.
| Attribute | Type | Notes |
|---|---|---|
| `conversationId` (PK) | S | |
| `messageId` (SK) | S | Zero-padded-ms-timestamp + random suffix — sorts chronologically as a plain `Query`, no GSI needed |
| `userId` | S | Redundant ownership marker, defense in depth |
| `role` | S | `user` \| `assistant` |
| `content` | S | |
| `sources` | List\<M\> | `[{title, excerpt}]`, empty for user messages |
| `createdAt` | N | Epoch seconds |

Both turns of every exchange are persisted by the `ask` Lambda **after** the model
responds (so a persistence hiccup never blocks the user from seeing their answer — it's
logged and swallowed, not raised). A conversation's `title` is auto-derived from its
first question the first time it's used, and stays "New chat" (unsaved as a draft, not
even written to DynamoDB) until that first message — this keeps the sidebar free of
empty chats a user opened but never used.

## Document lifecycle & KB synchronization

Bedrock Knowledge Base ingestion is **not instantaneous** and processes the entire data
source per job (not a single object), so the sync design accounts for that explicitly.

| Status | Meaning |
|---|---|
| `UPLOADING` | DynamoDB item created, presigned URL issued; file not yet confirmed in S3. |
| `PROCESSING` | S3 `ObjectCreated` event fired the sync Lambda; metadata sidecar written, Bedrock ingestion job started/running. |
| `READY` | Ingestion job completed and `GetKnowledgeBaseDocuments` confirms this document's status is `INDEXED`. |
| `FAILED` | Ingestion job failed, timed out, or the document-level status came back non-`INDEXED`; `errorMessage` explains why. |
| `DELETING` | Delete request received; S3 objects are being removed. |

**Upload → index flow:**
1. Frontend calls `POST /documents/upload`; Lambda validates type/size, generates a
   server-side `documentId`, writes a DynamoDB item with `status=UPLOADING`, and returns
   a short-lived (5 min) presigned S3 PUT URL — the file itself never passes through
   Lambda.
2. Frontend `PUT`s the file directly to S3.
3. S3 `ObjectCreated` invokes `ingest-sync`, which writes the metadata sidecar, sets
   `status=PROCESSING`, starts/polls the Bedrock ingestion job (retrying on
   `ConflictException`, since a data source runs one ingestion job at a time), then
   writes the final per-document status back to DynamoDB.
4. The frontend polls document status every 4s while anything is `UPLOADING`/`PROCESSING`.
5. Chat only becomes available once at least one *in-scope* document has `status=READY` —
   enforced server-side in the `ask` Lambda, not just in the UI.

**Delete flow:** `DELETE /documents/{id}` marks `DELETING`, deletes the source object and
its metadata sidecar from S3, then deletes the DynamoDB item. The S3 `ObjectRemoved`
event independently triggers `ingest-sync`, which re-runs ingestion; Bedrock's data
source has `dataDeletionPolicy=DELETE`, so a document missing from S3 at sync time is
automatically removed from the vector index.

## API reference

All routes require `Authorization: Bearer <Cognito ID token>` except `OPTIONS`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/documents/upload` | `{fileName, contentType, fileSize}` → `{documentId, uploadUrl, expiresInSeconds}` |
| `GET` | `/documents` | List the caller's documents |
| `GET` | `/documents/{documentId}/status` | Single document's current status |
| `DELETE` | `/documents/{documentId}` | Delete a document (source + index) |
| `GET` | `/conversations` | List the caller's conversations, most-recently-active first |
| `POST` | `/conversations` | `{title?, documentIds?}` → new conversation |
| `PATCH` | `/conversations/{id}` | `{title?, documentIds?}` → rename and/or change document scope |
| `DELETE` | `/conversations/{id}` | Delete a conversation and all of its messages |
| `GET` | `/conversations/{id}/messages` | The conversation's persisted transcript |
| `POST` | `/chat` | `{question, conversationId}` → `{answer, sources, sessionId, conversationId}`, retrieval scoped by ownership and (if set) the conversation's `documentIds` |

## Infrastructure-as-templates

`infra/*.json` are IAM/CloudFront/KB policy **templates** with `<PLACEHOLDER>` tokens
instead of hardcoded account/resource IDs, so they're safe to commit and reuse across any
AWS account. `infra/render.sh` substitutes them from `resource-ids.json` (gitignored)
into `infra/rendered/` (also gitignored) right before you `aws ... --policy-document
file://infra/rendered/...`. `infra/cleanup.sh` reads the same `resource-ids.json` rather
than hardcoding IDs, for the same reason.

## Known limitations

- **No in-place rename or replace-with-reindex for documents.** Uploading a new file and
  deleting the old one is the supported path for "updating" a document.
- **Ingestion is data-source-wide, not per-object** — a burst of many simultaneous
  uploads across many users will serialize through the same ingestion queue. Fine at
  workshop scale; would need batching/backpressure at real production scale.
- **`CORS Access-Control-Allow-Origin` is `*`** for workshop simplicity; tighten
  `ALLOWED_ORIGIN` on each Lambda to your CloudFront domain for a stricter deployment.
- **No server-side virus/malware scanning** of uploaded files — out of scope for a
  workshop app; production deployments would typically add S3 Object Lambda or a
  dedicated scanning service.
- **Conversation deletion is not atomic across the two tables** — the conversation row
  and its message rows are deleted in separate operations. A crash mid-delete could in
  theory leave orphaned messages under a conversationId nothing points to any more; they
  are unreachable (no conversation to list them under) but not reclaimed. Acceptable for
  a workshop app; a production system might add a periodic reaper or use DynamoDB TTL.
