#!/usr/bin/env bash
# Tears down every AWS resource created for the rag-workshop multi-user RAG app.
# Run from the repo root: bash infra/cleanup.sh
# Requires AWS credentials with permissions equivalent to those used to provision the stack,
# and a resource-ids.json (see resource-ids.example.json) populated with the IDs this
# workshop's setup steps produced — cleanup.sh never hardcodes account-specific values so
# it's safe to commit and reuse across every attendee's own AWS account.
set -uo pipefail

RESOURCE_IDS_FILE="$(dirname "$0")/../resource-ids.json"
if [ ! -f "$RESOURCE_IDS_FILE" ]; then
  echo "Missing $RESOURCE_IDS_FILE. Copy resource-ids.example.json to resource-ids.json and fill in your deployed IDs first." >&2
  exit 1
fi
json() { python3 -c "import json,sys; print(json.load(open('$RESOURCE_IDS_FILE')).get('$1', ''))"; }

REGION="$(json region)"
ACCOUNT_ID="$(json accountId)"
PREFIX="$(json prefix)"

echo "== Disabling and deleting CloudFront distribution =="
DIST_ID="$(json cloudFrontDistributionId)"
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text 2>/dev/null)
if [ -n "$ETAG" ]; then
  aws cloudfront get-distribution-config --id "$DIST_ID" --query 'DistributionConfig' > /tmp/cf-config.json
  python3 - <<'EOF'
import json
with open('/tmp/cf-config.json') as f:
    cfg = json.load(f)
cfg['Enabled'] = False
with open('/tmp/cf-config-disabled.json', 'w') as f:
    json.dump(cfg, f)
EOF
  aws cloudfront update-distribution --id "$DIST_ID" --distribution-config file:///tmp/cf-config-disabled.json --if-match "$ETAG" > /dev/null
  echo "Waiting for CloudFront to finish disabling (this can take several minutes)..."
  aws cloudfront wait distribution-deployed --id "$DIST_ID"
  ETAG2=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)
  aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG2"
else
  echo "CloudFront distribution $DIST_ID not found, skipping."
fi
aws cloudfront delete-origin-access-control --id "$(json cloudFrontOACId)" 2>/dev/null || true
aws cloudfront delete-function --name "${PREFIX}-url-rewrite" --if-match "$(aws cloudfront describe-function --name ${PREFIX}-url-rewrite --query ETag --output text 2>/dev/null)" 2>/dev/null || true

echo "== Removing S3 bucket notifications and emptying/deleting S3 buckets =="
aws s3api put-bucket-notification-configuration --bucket "${PREFIX}-docs-${ACCOUNT_ID}" --notification-configuration '{}' 2>/dev/null || true
aws s3 rm "s3://${PREFIX}-frontend-${ACCOUNT_ID}" --recursive 2>/dev/null || true
aws s3api delete-bucket --bucket "${PREFIX}-frontend-${ACCOUNT_ID}" --region "$REGION" 2>/dev/null || true

aws s3 rm "s3://${PREFIX}-docs-${ACCOUNT_ID}" --recursive 2>/dev/null || true
aws s3api list-object-versions --bucket "${PREFIX}-docs-${ACCOUNT_ID}" --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null | \
  aws s3api delete-objects --bucket "${PREFIX}-docs-${ACCOUNT_ID}" --delete file:///dev/stdin 2>/dev/null || true
aws s3api delete-bucket --bucket "${PREFIX}-docs-${ACCOUNT_ID}" --region "$REGION" 2>/dev/null || true

echo "== Deleting API Gateway =="
aws apigatewayv2 delete-api --api-id "$(json apiGatewayId)" 2>/dev/null || true

echo "== Deleting Lambda functions =="
aws lambda delete-function --function-name "${PREFIX}-ask" --region "$REGION" 2>/dev/null || true
aws lambda delete-function --function-name "${PREFIX}-documents-upload" --region "$REGION" 2>/dev/null || true
aws lambda delete-function --function-name "${PREFIX}-documents-manage" --region "$REGION" 2>/dev/null || true
aws lambda delete-function --function-name "${PREFIX}-ingest-sync" --region "$REGION" 2>/dev/null || true
aws lambda delete-function --function-name "${PREFIX}-conversations" --region "$REGION" 2>/dev/null || true

echo "== Deleting Cognito User Pool (this deletes all registered users) =="
aws cognito-idp delete-user-pool --user-pool-id "$(json cognitoUserPoolId)" --region "$REGION" 2>/dev/null || true

echo "== Deleting DynamoDB tables =="
aws dynamodb delete-table --table-name "${PREFIX}-documents" --region "$REGION" 2>/dev/null || true
aws dynamodb delete-table --table-name "${PREFIX}-conversations" --region "$REGION" 2>/dev/null || true
aws dynamodb delete-table --table-name "${PREFIX}-messages" --region "$REGION" 2>/dev/null || true

echo "== Deleting Bedrock Knowledge Base and data source =="
aws bedrock-agent delete-knowledge-base --knowledge-base-id "$(json knowledgeBaseId)" --region "$REGION" 2>/dev/null || true

echo "== Deleting S3 Vectors index and bucket =="
aws s3vectors delete-index --vector-bucket-name "${PREFIX}-vectors-${ACCOUNT_ID}" --index-name "${PREFIX}-index" --region "$REGION" 2>/dev/null || true
aws s3vectors delete-vector-bucket --vector-bucket-name "${PREFIX}-vectors-${ACCOUNT_ID}" --region "$REGION" 2>/dev/null || true

echo "== Deleting IAM roles =="
for role in kb-role lambda-role docs-lambda-role sync-lambda-role conversations-lambda-role; do
  ROLE_NAME="${PREFIX}-${role}"
  for policy in $(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text 2>/dev/null); do
    aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$policy" 2>/dev/null || true
  done
  for arn in $(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
    aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$arn" 2>/dev/null || true
  done
  aws iam delete-role --role-name "$ROLE_NAME" 2>/dev/null || true
done

echo "== Deleting CloudWatch log groups =="
for fn in ask documents-upload documents-manage ingest-sync conversations; do
  aws logs delete-log-group --log-group-name "/aws/lambda/${PREFIX}-${fn}" --region "$REGION" 2>/dev/null || true
done

echo "Cleanup complete. Verify in the AWS Console that no rag-workshop-* resources remain."
