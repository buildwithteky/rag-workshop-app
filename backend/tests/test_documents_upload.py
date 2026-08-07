import json

import documents_upload
from conftest import api_event


def _upload(body, user_id="alice"):
    resp = documents_upload.handler(api_event("POST", body=body, user_id=user_id), None)
    return json.loads(resp["body"]), resp["statusCode"]


def test_rejects_disallowed_content_type(aws):
    body, status = _upload({"fileName": "malware.exe", "contentType": "application/x-msdownload", "fileSize": 100})
    assert status == 400
    assert "Unsupported file type" in body["error"]


def test_rejects_oversized_file(aws):
    body, status = _upload({"fileName": "big.pdf", "contentType": "application/pdf", "fileSize": 999_999_999})
    assert status == 400
    assert "exceeds maximum size" in body["error"]


def test_accepts_a_valid_pdf_and_scopes_the_s3_key_to_the_caller(aws):
    body, status = _upload({"fileName": "policy.pdf", "contentType": "application/pdf", "fileSize": 1024}, user_id="alice")
    assert status == 200
    assert "documentId" in body
    assert "uploadUrl" in body
    # The presigned URL must point into this caller's own prefix — never a path the
    # client could have supplied directly.
    assert f"users/alice/documents/{body['documentId']}/" in body["uploadUrl"]


def test_sanitizes_unsafe_filenames():
    assert documents_upload._sanitize_filename("../../etc/passwd") == "passwd"
    assert documents_upload._sanitize_filename("my report (final).pdf") == "my_report__final_.pdf"
