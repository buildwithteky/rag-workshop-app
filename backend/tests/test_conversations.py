"""
Exercises the conversations Lambda's HTTP handler end to end against a moto-mocked
DynamoDB — this is the surface that owns chat history and the per-chat document scope,
so ownership enforcement (a user can never touch another user's conversation) is the
thing most worth protecting with a test here.
"""
import json

import conversations
from conftest import api_event


def _create(user_id="alice", document_ids=None, title=None):
    body = {}
    if document_ids is not None:
        body["documentIds"] = document_ids
    if title is not None:
        body["title"] = title
    resp = conversations.handler(api_event("POST", body=body, user_id=user_id), None)
    return json.loads(resp["body"]), resp["statusCode"]


def test_create_defaults_title_and_empty_scope(aws):
    body, status = _create()
    assert status == 201
    assert body["title"] == "New chat"
    assert body["documentIds"] == []


def test_list_only_returns_the_callers_conversations(aws):
    _create(user_id="alice")
    _create(user_id="alice")
    _create(user_id="bob")

    resp = conversations.handler(api_event("GET", user_id="alice"), None)
    body = json.loads(resp["body"])
    assert len(body["conversations"]) == 2


def test_a_user_cannot_read_another_users_conversation_messages(aws):
    created, _ = _create(user_id="alice")
    conversation_id = created["conversationId"]

    resp = conversations.handler(
        api_event("GET", path_params={"conversationId": conversation_id}, raw_path="/messages", user_id="bob"),
        None,
    )
    assert resp["statusCode"] == 404


def test_a_user_cannot_delete_another_users_conversation(aws):
    created, _ = _create(user_id="alice")
    conversation_id = created["conversationId"]

    resp = conversations.handler(
        api_event("DELETE", path_params={"conversationId": conversation_id}, user_id="bob"), None
    )
    assert resp["statusCode"] == 404

    # And it's still there for its actual owner.
    resp = conversations.handler(api_event("GET", user_id="alice"), None)
    assert len(json.loads(resp["body"])["conversations"]) == 1


def test_scoping_to_a_document_you_do_not_own_is_rejected(aws):
    # documents_table is shared across handlers; seed a document owned by someone else.
    conversations.documents_table.put_item(
        Item={"userId": "bob", "documentId": "bobs-doc", "status": "READY"}
    )
    resp = conversations.handler(
        api_event("POST", body={"documentIds": ["bobs-doc"]}, user_id="alice"), None
    )
    assert resp["statusCode"] == 400


def test_scoping_to_your_own_ready_document_succeeds(aws):
    conversations.documents_table.put_item(
        Item={"userId": "alice", "documentId": "alices-doc", "status": "READY"}
    )
    body, status = _create(user_id="alice", document_ids=["alices-doc"])
    assert status == 201
    assert body["documentIds"] == ["alices-doc"]


def test_rename_updates_title(aws):
    created, _ = _create(user_id="alice")
    resp = conversations.handler(
        api_event(
            "PATCH",
            body={"title": "Q3 policy questions"},
            path_params={"conversationId": created["conversationId"]},
            user_id="alice",
        ),
        None,
    )
    assert json.loads(resp["body"])["title"] == "Q3 policy questions"


def test_delete_also_removes_its_messages(aws):
    created, _ = _create(user_id="alice")
    conversation_id = created["conversationId"]
    conversations.messages_table.put_item(
        Item={"conversationId": conversation_id, "messageId": "0001", "role": "user", "content": "hi"}
    )

    conversations.handler(
        api_event("DELETE", path_params={"conversationId": conversation_id}, user_id="alice"), None
    )

    remaining = conversations.messages_table.query(
        KeyConditionExpression=conversations.Key("conversationId").eq(conversation_id)
    )
    assert remaining["Count"] == 0
