"""
Shared fixtures for the Lambda test suite.

Every Lambda module reads its table/knowledge-base names from environment variables at
import time, so those variables must exist *before* the module is imported. We set them
here, then stand up the DynamoDB tables the tests need with moto (an in-memory AWS
mock) — this keeps the suite fast, free, and safe to run in CI with no real AWS account.
"""
import os
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

# backend/lambda/*.py are deployed as flat Lambda handlers, not an installed package —
# add the directory to sys.path so tests can `import index`, `import conversations`, etc.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lambda"))

os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("KNOWLEDGE_BASE_ID", "test-kb-id")
os.environ.setdefault("DOCUMENTS_TABLE", "test-documents")
os.environ.setdefault("CONVERSATIONS_TABLE", "test-conversations")
os.environ.setdefault("MESSAGES_TABLE", "test-messages")
os.environ.setdefault("DOCS_BUCKET", "test-docs-bucket")
os.environ.setdefault("DATA_SOURCE_ID", "test-data-source")
# Fake, fixed credentials set at import time (before any Lambda module — and therefore
# before any boto3 client — is constructed), so botocore's credential resolver always has
# *something* to find. Real requests never leave the process: moto intercepts them.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")


@pytest.fixture
def aws():
    """Starts a moto-mocked AWS environment and creates the tables/bucket this app needs."""
    with mock_aws():
        region = os.environ["AWS_REGION"]
        dynamodb = boto3.resource("dynamodb", region_name=region)
        dynamodb.create_table(
            TableName=os.environ["DOCUMENTS_TABLE"],
            AttributeDefinitions=[
                {"AttributeName": "userId", "AttributeType": "S"},
                {"AttributeName": "documentId", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "userId", "KeyType": "HASH"},
                {"AttributeName": "documentId", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName=os.environ["CONVERSATIONS_TABLE"],
            AttributeDefinitions=[
                {"AttributeName": "userId", "AttributeType": "S"},
                {"AttributeName": "conversationId", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "userId", "KeyType": "HASH"},
                {"AttributeName": "conversationId", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName=os.environ["MESSAGES_TABLE"],
            AttributeDefinitions=[
                {"AttributeName": "conversationId", "AttributeType": "S"},
                {"AttributeName": "messageId", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "conversationId", "KeyType": "HASH"},
                {"AttributeName": "messageId", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        s3 = boto3.client("s3", region_name=region)
        s3.create_bucket(Bucket=os.environ["DOCS_BUCKET"])
        yield


def api_event(method, body=None, path_params=None, raw_path="", user_id="test-user-sub"):
    """Builds a minimal API Gateway HTTP API v2 event, matching what every handler here expects."""
    return {
        "requestContext": {
            "http": {"method": method},
            "authorizer": {"jwt": {"claims": {"sub": user_id}}},
        },
        "pathParameters": path_params or {},
        "rawPath": raw_path,
        "body": __import__("json").dumps(body) if body is not None else None,
    }
