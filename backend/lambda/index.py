import json
import logging
import os
import re

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

REGION = os.environ.get("AWS_REGION", "us-east-1")
KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]
TABLE_NAME = os.environ["DOCUMENTS_TABLE"]
MODEL_ARN = os.environ.get(
    "GENERATION_MODEL_ARN",
    f"arn:aws:bedrock:{REGION}::foundation-model/amazon.nova-lite-v1:0",
)
NUMBER_OF_RESULTS = int(os.environ.get("NUMBER_OF_RESULTS", "4"))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_QUESTION_LENGTH = int(os.environ.get("MAX_QUESTION_LENGTH", "1000"))

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

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


def _has_ready_documents(user_id):
    result = table.query(
        KeyConditionExpression=Key("userId").eq(user_id),
        FilterExpression="#s = :ready",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":ready": "READY"},
        Select="COUNT",
    )
    return result.get("Count", 0) > 0


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

    question = question.strip()
    if len(question) > MAX_QUESTION_LENGTH:
        return _response(
            400,
            {"error": f"Question exceeds maximum length of {MAX_QUESTION_LENGTH} characters."},
        )

    # Strip control characters to reduce prompt-injection / malformed-input surface.
    question = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", question)

    if not _has_ready_documents(user_id):
        return _response(
            200,
            {
                "answer": "You don't have any ready documents yet. Upload a document and wait for it to finish "
                "processing before asking questions.",
                "sources": [],
                "sessionId": "",
            },
        )

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
                            "filter": {"equals": {"key": "userId", "value": user_id}},
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

    logger.info(
        json.dumps(
            {
                "event": "request_completed",
                "request_id": request_id,
                "user_id": user_id,
                "question_length": len(question),
                "answer_length": len(answer_text),
                "source_count": len(sources),
            }
        )
    )

    return _response(
        200,
        {
            "answer": answer_text or "I don't have enough information in your documents to answer that.",
            "sources": sources,
            "sessionId": result.get("sessionId", ""),
        },
    )
