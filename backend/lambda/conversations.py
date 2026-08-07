import decimal
import json
import logging
import os
import time
import uuid

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

REGION = os.environ.get("AWS_REGION", "us-east-1")
CONVERSATIONS_TABLE = os.environ["CONVERSATIONS_TABLE"]
MESSAGES_TABLE = os.environ["MESSAGES_TABLE"]
DOCUMENTS_TABLE = os.environ["DOCUMENTS_TABLE"]
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_TITLE_LENGTH = int(os.environ.get("MAX_TITLE_LENGTH", "80"))
MAX_DOCUMENT_SCOPE = int(os.environ.get("MAX_DOCUMENT_SCOPE", "20"))

dynamodb = boto3.resource("dynamodb", region_name=REGION)
conversations_table = dynamodb.Table(CONVERSATIONS_TABLE)
messages_table = dynamodb.Table(MESSAGES_TABLE)
documents_table = dynamodb.Table(DOCUMENTS_TABLE)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PATCH,DELETE",
    "Content-Type": "application/json",
}


def _json_default(obj):
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _response(status_code, body_dict):
    return {"statusCode": status_code, "headers": CORS_HEADERS, "body": json.dumps(body_dict, default=_json_default)}


def _get_user_id(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError:
        return None


def _public_conversation(item):
    return {
        "conversationId": item.get("conversationId"),
        "title": item.get("title"),
        "documentIds": item.get("documentIds", []),
        "messageCount": item.get("messageCount", 0),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def _public_message(item):
    return {
        "messageId": item.get("messageId"),
        "role": item.get("role"),
        "content": item.get("content"),
        "sources": item.get("sources", []),
        "createdAt": item.get("createdAt"),
    }


def _validate_document_scope(user_id, document_ids):
    """
    Confirms every requested documentId actually belongs to this user before it can be
    saved as a conversation's retrieval scope. Without this check a user could pass an
    arbitrary documentId belonging to someone else and — because the Bedrock retrieval
    filter ANDs userId with documentId — the query would simply return zero matches
    rather than leak data, but rejecting invalid IDs up front gives a clear error instead
    of a silently empty chat.
    """
    if not document_ids:
        return None
    if len(document_ids) > MAX_DOCUMENT_SCOPE:
        return f"A conversation can be scoped to at most {MAX_DOCUMENT_SCOPE} documents."
    for document_id in document_ids:
        result = documents_table.get_item(Key={"userId": user_id, "documentId": document_id})
        if "Item" not in result:
            return f"Document '{document_id}' was not found in your library."
    return None


def _get_owned_conversation(user_id, conversation_id):
    result = conversations_table.get_item(Key={"userId": user_id, "conversationId": conversation_id})
    return result.get("Item")


def _list_conversations(user_id):
    result = conversations_table.query(KeyConditionExpression=Key("userId").eq(user_id))
    items = sorted(result.get("Items", []), key=lambda i: i.get("updatedAt", 0), reverse=True)
    return _response(200, {"conversations": [_public_conversation(i) for i in items]})


def _create_conversation(user_id, payload):
    title = payload.get("title")
    if title is not None and not isinstance(title, str):
        return _response(400, {"error": "Field 'title' must be a string."})
    title = (title or "New chat").strip()[:MAX_TITLE_LENGTH] or "New chat"

    document_ids = payload.get("documentIds", [])
    if not isinstance(document_ids, list) or not all(isinstance(d, str) for d in document_ids):
        return _response(400, {"error": "Field 'documentIds' must be a list of document ID strings."})

    scope_error = _validate_document_scope(user_id, document_ids)
    if scope_error:
        return _response(400, {"error": scope_error})

    now = int(time.time())
    item = {
        "userId": user_id,
        "conversationId": str(uuid.uuid4()),
        "title": title,
        "documentIds": document_ids,
        "messageCount": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    conversations_table.put_item(Item=item)
    return _response(201, _public_conversation(item))


def _update_conversation(user_id, conversation_id, payload):
    existing = _get_owned_conversation(user_id, conversation_id)
    if not existing:
        return _response(404, {"error": "Conversation not found."})

    updates = {}
    if "title" in payload:
        title = payload["title"]
        if not isinstance(title, str) or not title.strip():
            return _response(400, {"error": "Field 'title' must be a non-empty string."})
        updates["title"] = title.strip()[:MAX_TITLE_LENGTH]

    if "documentIds" in payload:
        document_ids = payload["documentIds"]
        if not isinstance(document_ids, list) or not all(isinstance(d, str) for d in document_ids):
            return _response(400, {"error": "Field 'documentIds' must be a list of document ID strings."})
        scope_error = _validate_document_scope(user_id, document_ids)
        if scope_error:
            return _response(400, {"error": scope_error})
        updates["documentIds"] = document_ids

    if not updates:
        return _response(400, {"error": "Nothing to update. Provide 'title' and/or 'documentIds'."})

    updates["updatedAt"] = int(time.time())
    expr_names = {f"#{k}": k for k in updates}
    expr_values = {f":{k}": v for k, v in updates.items()}
    conversations_table.update_item(
        Key={"userId": user_id, "conversationId": conversation_id},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    merged = {**existing, **updates}
    return _response(200, _public_conversation(merged))


def _delete_conversation(user_id, conversation_id, request_id):
    existing = _get_owned_conversation(user_id, conversation_id)
    if not existing:
        return _response(404, {"error": "Conversation not found."})

    # Messages are looked up by conversationId (their partition key) rather than userId,
    # so ownership was already confirmed above via the conversations-table lookup before
    # we touch a single message row.
    last_key = None
    while True:
        query_kwargs = {"KeyConditionExpression": Key("conversationId").eq(conversation_id)}
        if last_key:
            query_kwargs["ExclusiveStartKey"] = last_key
        page = messages_table.query(**query_kwargs)
        with messages_table.batch_writer() as batch:
            for item in page.get("Items", []):
                batch.delete_item(Key={"conversationId": conversation_id, "messageId": item["messageId"]})
        last_key = page.get("LastEvaluatedKey")
        if not last_key:
            break

    conversations_table.delete_item(Key={"userId": user_id, "conversationId": conversation_id})
    logger.info(
        json.dumps(
            {"event": "conversation_deleted", "request_id": request_id, "user_id": user_id, "conversation_id": conversation_id}
        )
    )
    return _response(200, {"message": "Conversation deleted."})


def _list_messages(user_id, conversation_id):
    if not _get_owned_conversation(user_id, conversation_id):
        return _response(404, {"error": "Conversation not found."})
    result = messages_table.query(KeyConditionExpression=Key("conversationId").eq(conversation_id))
    items = sorted(result.get("Items", []), key=lambda i: i.get("messageId", ""))
    return _response(200, {"messages": [_public_message(i) for i in items]})


def handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")
    http_method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    if http_method == "OPTIONS":
        return _response(200, {"message": "ok"})

    user_id = _get_user_id(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized."})

    path_params = event.get("pathParameters") or {}
    conversation_id = path_params.get("conversationId")
    is_messages_route = event.get("rawPath", "").endswith("/messages")

    try:
        payload = {}
        if http_method in ("POST", "PATCH"):
            payload = json.loads(event.get("body") or "{}")

        if http_method == "GET" and conversation_id and is_messages_route:
            return _list_messages(user_id, conversation_id)
        if http_method == "GET" and not conversation_id:
            return _list_conversations(user_id)
        if http_method == "POST" and not conversation_id:
            return _create_conversation(user_id, payload)
        if http_method == "PATCH" and conversation_id:
            return _update_conversation(user_id, conversation_id, payload)
        if http_method == "DELETE" and conversation_id:
            return _delete_conversation(user_id, conversation_id, request_id)
    except json.JSONDecodeError:
        return _response(400, {"error": "Request body must be valid JSON."})
    except ClientError as exc:
        logger.error(json.dumps({"event": "dynamodb_error", "request_id": request_id, "error": str(exc)}))
        return _response(500, {"error": "A database error occurred. Please try again."})
    except Exception as exc:  # noqa: BLE001
        logger.error(json.dumps({"event": "unexpected_error", "request_id": request_id, "error": str(exc)}))
        return _response(500, {"error": "An unexpected error occurred. Please try again."})

    return _response(404, {"error": "Not found."})
