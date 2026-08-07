import decimal
import json
import logging
import os
import time

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


def _json_default(obj):
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

REGION = os.environ.get("AWS_REGION", "us-east-1")
DOCS_BUCKET = os.environ["DOCS_BUCKET"]
TABLE_NAME = os.environ["DOCUMENTS_TABLE"]
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

s3 = boto3.client("s3", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,DELETE",
    "Content-Type": "application/json",
}


def _response(status_code, body_dict):
    return {"statusCode": status_code, "headers": CORS_HEADERS, "body": json.dumps(body_dict, default=_json_default)}


def _get_user_id(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError:
        return None


def _public_item(item):
    return {
        "documentId": item.get("documentId"),
        "fileName": item.get("fileName"),
        "fileSize": item.get("fileSize"),
        "contentType": item.get("contentType"),
        "status": item.get("status"),
        "errorMessage": item.get("errorMessage"),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def _list_documents(user_id):
    result = table.query(KeyConditionExpression=Key("userId").eq(user_id))
    items = sorted(result.get("Items", []), key=lambda i: i.get("createdAt", 0), reverse=True)
    return _response(200, {"documents": [_public_item(i) for i in items]})


def _get_status(user_id, document_id):
    result = table.get_item(Key={"userId": user_id, "documentId": document_id})
    item = result.get("Item")
    if not item:
        return _response(404, {"error": "Document not found."})
    return _response(200, _public_item(item))


def _delete_document(user_id, document_id, request_id):
    result = table.get_item(Key={"userId": user_id, "documentId": document_id})
    item = result.get("Item")
    if not item:
        return _response(404, {"error": "Document not found."})

    file_name = item.get("fileName", "")
    s3_key = f"users/{user_id}/documents/{document_id}/{file_name}"

    try:
        table.update_item(
            Key={"userId": user_id, "documentId": document_id},
            UpdateExpression="SET #s = :s, updatedAt = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "DELETING", ":u": int(time.time())},
        )
    except ClientError as exc:
        logger.error(json.dumps({"event": "delete_mark_failed", "request_id": request_id, "error": str(exc)}))

    try:
        s3.delete_object(Bucket=DOCS_BUCKET, Key=s3_key)
        s3.delete_object(Bucket=DOCS_BUCKET, Key=f"{s3_key}.metadata.json")
    except ClientError as exc:
        logger.error(json.dumps({"event": "s3_delete_failed", "request_id": request_id, "error": str(exc)}))
        table.update_item(
            Key={"userId": user_id, "documentId": document_id},
            UpdateExpression="SET #s = :s, errorMessage = :e, updatedAt = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": "FAILED",
                ":e": "Failed to delete source file. Please retry.",
                ":u": int(time.time()),
            },
        )
        return _response(502, {"error": "Failed to delete document. Please try again."})

    table.delete_item(Key={"userId": user_id, "documentId": document_id})

    logger.info(
        json.dumps(
            {"event": "document_deleted", "request_id": request_id, "user_id": user_id, "document_id": document_id}
        )
    )
    return _response(200, {"message": "Document deleted. Knowledge base sync will remove it from search shortly."})


def handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")
    http_method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    if http_method == "OPTIONS":
        return _response(200, {"message": "ok"})

    user_id = _get_user_id(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized."})

    path_params = event.get("pathParameters") or {}
    document_id = path_params.get("documentId")
    is_status_route = event.get("rawPath", "").endswith("/status")

    try:
        if http_method == "GET" and document_id and is_status_route:
            return _get_status(user_id, document_id)
        if http_method == "GET" and not document_id:
            return _list_documents(user_id)
        if http_method == "DELETE" and document_id:
            return _delete_document(user_id, document_id, request_id)
    except Exception as exc:  # noqa: BLE001
        logger.error(json.dumps({"event": "unexpected_error", "request_id": request_id, "error": str(exc)}))
        return _response(500, {"error": "An unexpected error occurred. Please try again."})

    return _response(404, {"error": "Not found."})
