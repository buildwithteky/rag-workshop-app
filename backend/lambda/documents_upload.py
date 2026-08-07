import json
import logging
import os
import re
import time
import uuid

import boto3
from botocore.config import Config

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

REGION = os.environ.get("AWS_REGION", "us-east-1")
DOCS_BUCKET = os.environ["DOCS_BUCKET"]
TABLE_NAME = os.environ["DOCUMENTS_TABLE"]
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_FILE_SIZE_BYTES = int(os.environ.get("MAX_FILE_SIZE_BYTES", str(10 * 1024 * 1024)))
PRESIGN_EXPIRY_SECONDS = int(os.environ.get("PRESIGN_EXPIRY_SECONDS", "300"))

ALLOWED_CONTENT_TYPES = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
}

s3 = boto3.client("s3", region_name=REGION, config=Config(signature_version="s3v4"))
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json",
}


def _response(status_code, body_dict):
    return {"statusCode": status_code, "headers": CORS_HEADERS, "body": json.dumps(body_dict)}


def _get_user_id(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError:
        return None


def _sanitize_filename(name):
    name = os.path.basename(name)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name[:150] if name else "document"


def handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")

    http_method = event.get("requestContext", {}).get("http", {}).get("method", "POST")
    if http_method == "OPTIONS":
        return _response(200, {"message": "ok"})

    user_id = _get_user_id(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized."})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "Request body must be valid JSON."})

    file_name = payload.get("fileName")
    content_type = payload.get("contentType")
    file_size = payload.get("fileSize")

    if not isinstance(file_name, str) or not file_name.strip():
        return _response(400, {"error": "Field 'fileName' is required."})
    if content_type not in ALLOWED_CONTENT_TYPES:
        return _response(
            400,
            {"error": f"Unsupported file type '{content_type}'. Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}."},
        )
    if not isinstance(file_size, (int, float)) or file_size <= 0:
        return _response(400, {"error": "Field 'fileSize' must be a positive number."})
    if file_size > MAX_FILE_SIZE_BYTES:
        return _response(
            400,
            {"error": f"File exceeds maximum size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB."},
        )

    document_id = str(uuid.uuid4())
    safe_name = _sanitize_filename(file_name)
    s3_key = f"users/{user_id}/documents/{document_id}/{safe_name}"
    now = int(time.time())

    try:
        table.put_item(
            Item={
                "userId": user_id,
                "documentId": document_id,
                "fileName": safe_name,
                "fileSize": int(file_size),
                "contentType": content_type,
                "status": "UPLOADING",
                "createdAt": now,
                "updatedAt": now,
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(json.dumps({"event": "dynamodb_put_failed", "request_id": request_id, "error": str(exc)}))
        return _response(500, {"error": "Failed to register document. Please try again."})

    try:
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": DOCS_BUCKET, "Key": s3_key, "ContentType": content_type},
            ExpiresIn=PRESIGN_EXPIRY_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(json.dumps({"event": "presign_failed", "request_id": request_id, "error": str(exc)}))
        return _response(500, {"error": "Failed to prepare upload. Please try again."})

    logger.info(
        json.dumps(
            {
                "event": "upload_url_issued",
                "request_id": request_id,
                "user_id": user_id,
                "document_id": document_id,
            }
        )
    )

    return _response(
        200,
        {
            "documentId": document_id,
            "uploadUrl": upload_url,
            "expiresInSeconds": PRESIGN_EXPIRY_SECONDS,
        },
    )
