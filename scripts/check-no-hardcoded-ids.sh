#!/usr/bin/env bash
# Quality/security gate run in CI: fails the build if a real-looking AWS account ID or
# access key ever gets hardcoded into infra/*.json (which are meant to stay
# placeholder-only templates, see infra/render.sh) or anywhere else in the repo. This is
# exactly the class of mistake this repo shipped with once already — resource-ids.json
# leaking real account/Cognito/API IDs into infra/*.json before it was caught and
# templated. Automating the check prevents a repeat.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

echo "== Checking for hardcoded 12-digit AWS account IDs in infra/ templates =="
if grep -rEn '"[0-9]{12}"' infra/*.json 2>/dev/null; then
  echo "Found a literal AWS account ID in an infra/*.json template — use <ACCOUNT_ID> instead." >&2
  FAIL=1
fi

echo "== Checking for AWS access key ID patterns anywhere in tracked source =="
if git grep -In -E 'AKIA[0-9A-Z]{16}' -- . ':!*.md' 2>/dev/null; then
  echo "Found what looks like an AWS access key ID in tracked source." >&2
  FAIL=1
fi

echo "== Checking resource-ids.json is not accidentally tracked =="
if git ls-files --error-unmatch resource-ids.json >/dev/null 2>&1; then
  echo "resource-ids.json is tracked by git — it should stay gitignored (see resource-ids.example.json)." >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "No hardcoded AWS identifiers found."
fi
exit $FAIL
