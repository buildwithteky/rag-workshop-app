#!/usr/bin/env bash
# One-time setup: registers GitHub Actions as an OIDC identity provider in this AWS
# account, then creates an IAM role GitHub Actions can assume via short-lived, per-run
# federated tokens — no long-lived AWS access keys are ever generated or stored in
# GitHub. Run this once per AWS account before the deploy.yml workflow can authenticate.
#
# Usage: GITHUB_ORG=your-org GITHUB_REPO=rag-workshop-app bash infra/setup-github-oidc.sh
set -euo pipefail

: "${GITHUB_ORG:?Set GITHUB_ORG=<your GitHub username or org>}"
: "${GITHUB_REPO:?Set GITHUB_REPO=<the repo name, e.g. rag-workshop-app>}"

INFRA_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$INFRA_DIR")"
RESOURCE_IDS_FILE="$REPO_ROOT/resource-ids.json"
ROLE_NAME="rag-workshop-github-actions-deploy"

if [ ! -f "$RESOURCE_IDS_FILE" ]; then
  echo "Missing $RESOURCE_IDS_FILE. Copy resource-ids.example.json to resource-ids.json and fill in your deployed IDs first." >&2
  exit 1
fi
ACCOUNT_ID=$(python3 -c "import json; print(json.load(open('$RESOURCE_IDS_FILE'))['accountId'])")

# GitHub's OIDC token-signing certificate thumbprint. AWS no longer verifies this value
# against the actual certificate (STS validates the token signature directly against
# GitHub's published JWKS instead) but the API still requires a well-formed thumbprint
# list to create the provider — this is GitHub's long-published, stable root CA thumbprint.
THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"

echo "== Registering the GitHub Actions OIDC provider (skips if it already exists) =="
if ! aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" \
  >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "$THUMBPRINT"
else
  echo "OIDC provider already registered."
fi

echo "== Rendering the trust policy for repo ${GITHUB_ORG}/${GITHUB_REPO} =="
TRUST_POLICY=$(python3 -c "
import json
doc = json.load(open('$INFRA_DIR/github-oidc-trust-policy.json'))
text = json.dumps(doc)
text = text.replace('<ACCOUNT_ID>', '$ACCOUNT_ID')
text = text.replace('<GITHUB_ORG>', '$GITHUB_ORG')
text = text.replace('<GITHUB_REPO>', '$GITHUB_REPO')
print(text)
")
echo "$TRUST_POLICY" > /tmp/rag-workshop-github-trust-policy.json

echo "== Creating (or updating) the IAM role =="
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" \
    --policy-document file:///tmp/rag-workshop-github-trust-policy.json
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document file:///tmp/rag-workshop-github-trust-policy.json \
    --description "Assumed by GitHub Actions via OIDC to deploy rag-workshop-app. No long-lived credentials."
fi

echo "== Rendering and attaching the deploy permissions policy =="
bash "$INFRA_DIR/render.sh" >/dev/null
aws iam put-role-policy --role-name "$ROLE_NAME" \
  --policy-name "rag-workshop-github-actions-deploy" \
  --policy-document "file://$INFRA_DIR/rendered/github-actions-deploy-permissions-policy.json"

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo
echo "Done. Now set these in your GitHub repo (Settings -> Secrets and variables -> Actions -> Variables):"
echo "  AWS_DEPLOY_ROLE_ARN = ${ROLE_ARN}"
echo "  AWS_REGION          = $(python3 -c "import json; print(json.load(open('$RESOURCE_IDS_FILE'))['region'])")"
echo
echo "No AWS access key or secret needs to be stored in GitHub at all."
