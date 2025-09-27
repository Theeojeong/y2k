from __future__ import annotations

import os
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from y2kapp import app


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def test_healthz(client: TestClient) -> None:
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_list_messages_initial(client: TestClient) -> None:
    res = client.get("/api/messages")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_create_and_delete_message(client: TestClient) -> None:
    payload = {"author": "tester", "body": "hello"}
    created = client.post("/api/messages", json=payload)
    assert created.status_code == 201
    data = created.json()
    assert data["author"] == "tester"
    assert data["body"] == "hello"

    message_id = data["id"]
    deleted = client.delete(f"/api/messages/{message_id}")
    assert deleted.status_code == 204

