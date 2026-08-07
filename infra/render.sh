#!/usr/bin/env bash
# Renders the infra/*.json IAM/S3/CloudFront policy templates in this directory into
# infra/rendered/ by substituting the <PLACEHOLDER> tokens with the real IDs from
# resource-ids.json. Templates stay placeholder-only so they're safe to commit and reuse
# across every attendee's own AWS account; only the rendered output (gitignored) contains
# your account's real identifiers.
#
# Usage: bash infra/render.sh
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$INFRA_DIR")"
RESOURCE_IDS_FILE="$REPO_ROOT/resource-ids.json"
OUT_DIR="$INFRA_DIR/rendered"

if [ ! -f "$RESOURCE_IDS_FILE" ]; then
  echo "Missing $RESOURCE_IDS_FILE. Copy resource-ids.example.json to resource-ids.json and fill in your deployed IDs first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

python3 - "$RESOURCE_IDS_FILE" "$INFRA_DIR" "$OUT_DIR" <<'PY'
import json
import sys
from pathlib import Path

resource_ids_file, infra_dir, out_dir = sys.argv[1:4]
ids = json.load(open(resource_ids_file))

# Maps the <PLACEHOLDER> tokens used in infra/*.json to keys in resource-ids.json.
substitutions = {
    "<ACCOUNT_ID>": ids["accountId"],
    "<COGNITO_USER_POOL_ID>": ids["cognitoUserPoolId"],
    "<COGNITO_CLIENT_ID>": ids["cognitoClientId"],
    "<API_GATEWAY_ID>": ids["apiGatewayId"],
    "<API_AUTHORIZER_ID>": ids["apiGatewayAuthorizerId"],
    "<CLOUDFRONT_DISTRIBUTION_ID>": ids["cloudFrontDistributionId"],
    "<CLOUDFRONT_SUBDOMAIN>": ids["cloudFrontDomain"].split(".")[0],
    "<CLOUDFRONT_OAC_ID>": ids["cloudFrontOACId"],
    "<KNOWLEDGE_BASE_ID>": ids["knowledgeBaseId"],
    "<DATA_SOURCE_ID>": ids["dataSourceId"],
}

for template in Path(infra_dir).glob("*.json"):
    text = template.read_text()
    for placeholder, value in substitutions.items():
        text = text.replace(placeholder, value)
    remaining = [tok for tok in substitutions if tok in text]
    dest = Path(out_dir) / template.name
    dest.write_text(text)
    note = f"  (still contains unresolved placeholders: {remaining})" if remaining else ""
    print(f"rendered {dest.relative_to(Path(infra_dir).parent)}{note}")
PY
