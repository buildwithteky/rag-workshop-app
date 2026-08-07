import json
import logging
import os
import re
import time
import uuid

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

REGION = os.environ.get("AWS_REGION", "us-east-1")
KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]
TABLE_NAME = os.environ["DOCUMENTS_TABLE"]
CONVERSATIONS_TABLE_NAME = os.environ["CONVERSATIONS_TABLE"]
MESSAGES_TABLE_NAME = os.environ["MESSAGES_TABLE"]
MODEL_ARN = os.environ.get(
    "GENERATION_MODEL_ARN",
    f"arn:aws:bedrock:{REGION}::foundation-model/amazon.nova-lite-v1:0",
)
NUMBER_OF_RESULTS = int(os.environ.get("NUMBER_OF_RESULTS", "4"))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_QUESTION_LENGTH = int(os.environ.get("MAX_QUESTION_LENGTH", "1000"))
MAX_TITLE_LENGTH = int(os.environ.get("MAX_TITLE_LENGTH", "80"))

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
conversations_table = dynamodb.Table(CONVERSATIONS_TABLE_NAME)
messages_table = dynamodb.Table(MESSAGES_TABLE_NAME)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json",
}


def _response(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body_dict),
    }


def _get_user_id(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError:
        return None


def _extract_filename(uri):
    if not uri:
        return "Unknown source"
    return uri.rsplit("/", 1)[-1]


def _parse_citations(raw_citations):
    sources = []
    seen = set()
    for citation in raw_citations or []:
        for ref in citation.get("retrievedReferences", []):
            location = ref.get("location", {})
            s3_loc = location.get("s3Location", {})
            uri = s3_loc.get("uri", "")
            filename = _extract_filename(uri)
            excerpt = ref.get("content", {}).get("text", "")
            key = (filename, excerpt[:80])
            if key in seen:
                continue
            seen.add(key)
            # Deliberately omit the raw S3 URI / internal bucket path from the response.
            sources.append(
                {
                    "title": filename,
                    "excerpt": (excerpt[:300] + "...") if len(excerpt) > 300 else excerpt,
                }
            )
    return sources


def _has_ready_documents(user_id, document_ids=None):
    result = table.query(
        KeyConditionExpression=Key("userId").eq(user_id),
        FilterExpression="#s = :ready",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":ready": "READY"},
    )
    items = result.get("Items", [])
    if document_ids:
        scoped = {d["documentId"] for d in items if d["documentId"] in set(document_ids)}
        return len(scoped) > 0
    return len(items) > 0


def _build_retrieval_filter(user_id, document_ids):
    """
    Every retrieval is filtered on userId so one tenant's vectors can never surface in
    another tenant's answers. When a conversation is scoped to specific documents we AND
    in a second condition that keeps results to just that set — this is what makes
    per-chat document scoping a *retrieval-time* guarantee rather than a UI-only filter:
    even a prompt-injected question can't make the model see documents outside the scope,
    because the vector search itself never returns them.
    """
    ownership = {"equals": {"key": "userId", "value": user_id}}
    if not document_ids:
        return ownership
    return {"andAll": [ownership, {"in": {"key": "documentId", "value": document_ids}}]}


def _make_message_id():
    # Zero-padded millisecond timestamp + random suffix sorts chronologically as a
    # DynamoDB sort key while staying unique under concurrent writes.
    return f"{int(time.time() * 1000):016d}#{uuid.uuid4().hex[:8]}"


def _get_owned_conversation(user_id, conversation_id):
    result = conversations_table.get_item(Key={"userId": user_id, "conversationId": conversation_id})
    return result.get("Item")


def _save_message(conversation_id, user_id, role, content, sources=None):
    messages_table.put_item(
        Item={
            "conversationId": conversation_id,
            "messageId": _make_message_id(),
            "userId": user_id,
            "role": role,
            "content": content,
            "sources": sources or [],
            "createdAt": int(time.time()),
        }
    )


def _bump_conversation(user_id, conversation_id, conversation, question):
    """
    Advances updatedAt (so the sidebar's most-recently-active ordering stays correct),
    increments the message count, and — the first time only — derives a human-readable
    title from the opening question instead of leaving every chat named "New chat".
    """
    updates = {"updatedAt": int(time.time()), "messageCount": conversation.get("messageCount", 0) + 2}
    expr_names = {"#updatedAt": "updatedAt", "#messageCount": "messageCount"}
    expr_values = {":updatedAt": updates["updatedAt"], ":messageCount": updates["messageCount"]}
    set_clause = "#updatedAt = :updatedAt, #messageCount = :messageCount"

    if conversation.get("messageCount", 0) == 0 and conversation.get("title") in (None, "", "New chat"):
        expr_names["#title"] = "title"
        expr_values[":title"] = question[:MAX_TITLE_LENGTH]
        set_clause += ", #title = :title"

    conversations_table.update_item(
        Key={"userId": user_id, "conversationId": conversation_id},
        UpdateExpression="SET " + set_clause,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")
    logger.info(json.dumps({"event": "request_received", "request_id": request_id}))

    http_method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "POST"
    )
    if http_method == "OPTIONS":
        return _response(200, {"message": "ok"})

    user_id = _get_user_id(event)
    if not user_id:
        return _response(401, {"error": "Unauthorized."})

    try:
        raw_body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            import base64

            raw_body = base64.b64decode(raw_body).decode("utf-8")
        payload = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning(json.dumps({"event": "invalid_json", "error": str(exc)}))
        return _response(400, {"error": "Request body must be valid JSON."})

    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        return _response(400, {"error": "Field 'question' is required and must be a non-empty string."})

    conversation_id = payload.get("conversationId")
    if not isinstance(conversation_id, str) or not conversation_id.strip():
        return _response(400, {"error": "Field 'conversationId' is required. Create a conversation first via POST /conversations."})

    # The client never gets to say which documents a question may draw on — that scope is
    # read from the conversation record the user already saved it into via PATCH
    # /conversations/{id}. This is what stops a tampered request body from widening a
    # chat's retrieval scope beyond what its owner actually selected in the UI.
    conversation = _get_owned_conversation(user_id, conversation_id)
    if not conversation:
        return _response(404, {"error": "Conversation not found."})
    document_ids = conversation.get("documentIds") or []

    question = question.strip()
    if len(question) > MAX_QUESTION_LENGTH:
        return _response(
            400,
            {"error": f"Question exceeds maximum length of {MAX_QUESTION_LENGTH} characters."},
        )

    # Strip control characters to reduce prompt-injection / malformed-input surface.
    question = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", question)

    if not _has_ready_documents(user_id, document_ids):
        message = (
            "None of the documents selected for this chat are ready yet. Upload a document or "
            "adjust this chat's document scope."
            if document_ids
            else "You don't have any ready documents yet. Upload a document and wait for it to finish "
            "processing before asking questions."
        )
        return _response(200, {"answer": message, "sources": [], "sessionId": "", "conversationId": conversation_id})

    try:
        result = bedrock_agent_runtime.retrieve_and_generate(
            input={"text": question},
            retrieveAndGenerateConfiguration={
                "type": "KNOWLEDGE_BASE",
                "knowledgeBaseConfiguration": {
                    "knowledgeBaseId": KNOWLEDGE_BASE_ID,
                    "modelArn": MODEL_ARN,
                    "retrievalConfiguration": {
                        "vectorSearchConfiguration": {
                            "numberOfResults": NUMBER_OF_RESULTS,
                            "filter": _build_retrieval_filter(user_id, document_ids),
                        }
                    },
                },
            },
        )
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "Unknown")
        logger.error(
            json.dumps(
                {
                    "event": "bedrock_client_error",
                    "request_id": request_id,
                    "error_code": error_code,
                    "message": str(exc),
                }
            )
        )
        if error_code == "ThrottlingException":
            return _response(429, {"error": "The service is busy. Please try again in a moment."})
        if error_code in ("AccessDeniedException", "ValidationException"):
            return _response(502, {"error": "The assistant is temporarily unavailable. Please try again later."})
        return _response(502, {"error": "Failed to generate an answer. Please try again."})
    except Exception as exc:  # noqa: BLE001
        logger.error(
            json.dumps({"event": "unexpected_error", "request_id": request_id, "message": str(exc)})
        )
        return _response(500, {"error": "An unexpected error occurred. Please try again."})

    answer_text = result.get("output", {}).get("text", "").strip()
    # Nova occasionally echoes an internal tool-call trace before the real answer;
    # if present, keep only the text after the last "Response:" marker.
    if "Response:" in answer_text:
        answer_text = answer_text.rsplit("Response:", 1)[-1].strip()
    sources = _parse_citations(result.get("citations"))
    final_answer = answer_text or "I don't have enough information in your documents to answer that."

    # Persist both turns so the conversation survives a page refresh or a later visit —
    # this is what makes chat history real rather than component-local state. A failure
    # here must not take down an answer the model already generated, so it's logged and
    # swallowed rather than raised: the user still gets their answer even if history is
    # briefly unavailable.
    try:
        _save_message(conversation_id, user_id, "user", question)
        _save_message(conversation_id, user_id, "assistant", final_answer, sources)
        _bump_conversation(user_id, conversation_id, conversation, question)
    except ClientError as exc:
        logger.error(json.dumps({"event": "message_persist_failed", "request_id": request_id, "error": str(exc)}))

    logger.info(
        json.dumps(
            {
                "event": "request_completed",
                "request_id": request_id,
                "user_id": user_id,
                "conversation_id": conversation_id,
                "question_length": len(question),
                "answer_length": len(answer_text),
                "source_count": len(sources),
            }
        )
    )

    return _response(
        200,
        {
            "answer": final_answer,
            "sources": sources,
            "sessionId": result.get("sessionId", ""),
            "conversationId": conversation_id,
        },
    )
