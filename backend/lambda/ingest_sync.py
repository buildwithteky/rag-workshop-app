import json
import logging
import os
import time
import urllib.parse

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

REGION = os.environ.get("AWS_REGION", "us-east-1")
DOCS_BUCKET = os.environ["DOCS_BUCKET"]
TABLE_NAME = os.environ["DOCUMENTS_TABLE"]
KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]
DATA_SOURCE_ID = os.environ["DATA_SOURCE_ID"]

POLL_INTERVAL_SECONDS = 5
MAX_POLL_ATTEMPTS = 50  # ~4 minutes of polling for the ingestion job itself
MAX_START_RETRIES = 8  # handles ConflictException when a job is already running

s3 = boto3.client("s3", region_name=REGION)
bedrock_agent = boto3.client("bedrock-agent", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)


def _parse_key(key):
    # Expected: users/{userId}/documents/{documentId}/{fileName}
    parts = key.split("/")
    if len(parts) < 5 or parts[0] != "users" or parts[2] != "documents":
        return None, None, None
    user_id, document_id, file_name = parts[1], parts[3], parts[4]
    return user_id, document_id, file_name


def _write_metadata_sidecar(key, user_id, document_id):
    body = {
        "metadataAttributes": {
            "userId": {"value": {"type": "STRING", "stringValue": user_id}, "includeForEmbedding": False},
            "documentId": {"value": {"type": "STRING", "stringValue": document_id}, "includeForEmbedding": False},
        }
    }
    s3.put_object(
        Bucket=DOCS_BUCKET,
        Key=f"{key}.metadata.json",
        Body=json.dumps(body).encode("utf-8"),
        ContentType="application/json",
    )


def _update_status(user_id, document_id, status, error_message=None):
    expr = "SET #s = :s, updatedAt = :u"
    values = {":s": status, ":u": int(time.time())}
    names = {"#s": "status"}
    if error_message:
        expr += ", errorMessage = :e"
        values[":e"] = error_message
    try:
        table.update_item(
            Key={"userId": user_id, "documentId": document_id},
            UpdateExpression=expr,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(documentId)",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        logger.info(json.dumps({"event": "status_update_skipped_missing_item", "document_id": document_id}))


def _start_ingestion_job_with_retry(request_id):
    for attempt in range(MAX_START_RETRIES):
        try:
            resp = bedrock_agent.start_ingestion_job(
                knowledgeBaseId=KNOWLEDGE_BASE_ID, dataSourceId=DATA_SOURCE_ID
            )
            return resp["ingestionJob"]["ingestionJobId"]
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code == "ConflictException":
                logger.info(
                    json.dumps(
                        {"event": "ingestion_job_conflict_retry", "request_id": request_id, "attempt": attempt}
                    )
                )
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            raise
    raise RuntimeError("Could not start ingestion job after retries; another job kept the data source busy.")


def _wait_for_job(job_id, request_id):
    for _ in range(MAX_POLL_ATTEMPTS):
        resp = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=KNOWLEDGE_BASE_ID, dataSourceId=DATA_SOURCE_ID, ingestionJobId=job_id
        )
        status = resp["ingestionJob"]["status"]
        if status in ("COMPLETE", "FAILED"):
            return status
        time.sleep(POLL_INTERVAL_SECONDS)
    logger.warning(json.dumps({"event": "ingestion_job_poll_timeout", "request_id": request_id, "job_id": job_id}))
    return "TIMEOUT"


def _document_indexed_status(key):
    try:
        resp = bedrock_agent.get_knowledge_base_documents(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=DATA_SOURCE_ID,
            documentIdentifiers=[{"dataSourceType": "S3", "s3": {"uri": f"s3://{DOCS_BUCKET}/{key}"}}],
        )
        docs = resp.get("documentDetails", [])
        if not docs:
            return "FAILED", "Document was not found in the knowledge base after sync."
        status = docs[0].get("status")
        if status == "INDEXED":
            return "READY", None
        reason = docs[0].get("statusReason", f"Indexing status: {status}")
        return "FAILED", reason
    except ClientError as exc:
        logger.error(json.dumps({"event": "get_kb_documents_failed", "error": str(exc)}))
        return "FAILED", "Could not verify indexing status."


def handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")

    for record in event.get("Records", []):
        event_name = record.get("eventName", "")
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        if key.endswith(".metadata.json"):
            continue  # avoid recursive triggers from the sidecar files we write ourselves

        user_id, document_id, _file_name = _parse_key(key)
        if not user_id or not document_id:
            logger.info(json.dumps({"event": "ignored_unrecognized_key", "key": key}))
            continue

        is_create = event_name.startswith("ObjectCreated")
        is_remove = event_name.startswith("ObjectRemoved")

        if is_create:
            item = table.get_item(Key={"userId": user_id, "documentId": document_id}).get("Item")
            if not item or item.get("status") == "DELETING":
                logger.info(json.dumps({"event": "skip_missing_or_deleting", "document_id": document_id}))
                continue

            try:
                _write_metadata_sidecar(key, user_id, document_id)
            except ClientError as exc:
                logger.error(json.dumps({"event": "sidecar_write_failed", "error": str(exc)}))
                _update_status(user_id, document_id, "FAILED", "Failed to prepare document for indexing.")
                continue

            _update_status(user_id, document_id, "PROCESSING")

        try:
            job_id = _start_ingestion_job_with_retry(request_id)
        except Exception as exc:  # noqa: BLE001
            logger.error(json.dumps({"event": "start_ingestion_failed", "error": str(exc)}))
            if is_create:
                _update_status(user_id, document_id, "FAILED", "Could not start knowledge base sync.")
            continue

        job_status = _wait_for_job(job_id, request_id)

        if is_create:
            if job_status != "COMPLETE":
                _update_status(user_id, document_id, "FAILED", f"Knowledge base sync did not complete ({job_status}).")
                continue
            doc_status, error_message = _document_indexed_status(key)
            _update_status(user_id, document_id, doc_status, error_message)
            logger.info(
                json.dumps(
                    {
                        "event": "document_sync_complete",
                        "request_id": request_id,
                        "document_id": document_id,
                        "status": doc_status,
                    }
                )
            )
        elif is_remove:
            logger.info(
                json.dumps(
                    {"event": "delete_sync_complete", "request_id": request_id, "document_id": document_id, "job_status": job_status}
                )
            )

    return {"statusCode": 200}
