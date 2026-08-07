"""
Covers the two things that actually enforce multi-tenant isolation and document scoping
in the /chat handler: the retrieval filter builder, and the ready-document gate. These
are the highest-value functions in the whole app to regression-test — a bug here is a
data-leak bug, not just a wrong-answer bug.
"""
import index


def test_filter_is_userid_only_when_no_document_scope():
    filt = index._build_retrieval_filter("user-123", [])
    assert filt == {"equals": {"key": "userId", "value": "user-123"}}


def test_filter_ands_userid_with_document_scope():
    filt = index._build_retrieval_filter("user-123", ["doc-a", "doc-b"])
    assert filt == {
        "andAll": [
            {"equals": {"key": "userId", "value": "user-123"}},
            {"in": {"key": "documentId", "value": ["doc-a", "doc-b"]}},
        ]
    }


def test_filter_never_lets_a_second_users_id_in():
    # Regardless of what documentIds a caller passes, the userId half of the filter is
    # always the authenticated caller's own ID — there is no code path that accepts a
    # different userId anywhere in this function's signature.
    filt = index._build_retrieval_filter("alice-sub", ["doc-owned-by-someone-else"])
    assert filt["andAll"][0] == {"equals": {"key": "userId", "value": "alice-sub"}}


def test_has_ready_documents_false_when_none_exist(aws):
    assert index._has_ready_documents("user-123") is False


def test_has_ready_documents_true_after_a_ready_document(aws):
    index.table.put_item(
        Item={"userId": "user-123", "documentId": "doc-1", "status": "READY", "createdAt": 1}
    )
    assert index._has_ready_documents("user-123") is True


def test_has_ready_documents_respects_scope(aws):
    index.table.put_item(
        Item={"userId": "user-123", "documentId": "doc-1", "status": "READY", "createdAt": 1}
    )
    index.table.put_item(
        Item={"userId": "user-123", "documentId": "doc-2", "status": "READY", "createdAt": 1}
    )
    # doc-1 is ready, but it isn't in this conversation's scope — only doc-3 (not ready,
    # doesn't even exist) is, so the gate must report False even though the user does
    # have ready documents overall.
    assert index._has_ready_documents("user-123", ["doc-3"]) is False
    assert index._has_ready_documents("user-123", ["doc-1"]) is True
