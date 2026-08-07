#!/usr/bin/env bash
# Creates the DynamoDB tables backing chat history and per-chat document scoping.
# Run from the repo root: bash infra/create-tables.sh
#
# rag-workshop-conversations: one item per chat. PK=userId, SK=conversationId.
#   documentIds on this item IS the per-chat document scope — it's what the ask Lambda
#   reads server-side to build the Bedrock retrieval filter, so a user can never widen a
#   chat's scope just by editing the request body.
# rag-workshop-messages: one item per chat turn. PK=conversationId, SK=messageId
#   (a zero-padded-timestamp string so a Query naturally comes back in chronological
#   order with no extra sort logic needed).
# Both use PAY_PER_REQUEST billing, matching rag-workshop-documents: workshop traffic is
# bursty and low-volume, so on-demand avoids provisioning (and paying for) idle capacity.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="rag-workshop"

echo "== Creating ${PREFIX}-conversations =="
aws dynamodb create-table \
  --table-name "${PREFIX}-conversations" \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=conversationId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=conversationId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --sse-specification Enabled=true \
  --region "$REGION"

echo "== Creating ${PREFIX}-messages =="
aws dynamodb create-table \
  --table-name "${PREFIX}-messages" \
  --attribute-definitions AttributeName=conversationId,AttributeType=S AttributeName=messageId,AttributeType=S \
  --key-schema AttributeName=conversationId,KeyType=HASH AttributeName=messageId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --sse-specification Enabled=true \
  --region "$REGION"

echo "Waiting for both tables to become ACTIVE..."
aws dynamodb wait table-exists --table-name "${PREFIX}-conversations" --region "$REGION"
aws dynamodb wait table-exists --table-name "${PREFIX}-messages" --region "$REGION"
echo "Done."
