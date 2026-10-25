"""Dependency-free handler tests. AWS adapters are faked; no AWS account is contacted."""
import base64
import copy
import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path

class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}

class FakeKey:
    def __init__(self, name): self.name = name
    def eq(self, value): return (self.name, value)

class FakeTable:
    def __init__(self): self.items = {}; self.calls = []
    def query(self, **kw):
        self.calls.append(kw)
        owner = kw["KeyConditionExpression"][1]
        return {"Items": [copy.deepcopy(v) for (u, _), v in self.items.items() if u == owner]}
    def get_item(self, **kw):
        key = (kw["Key"]["userId"], kw["Key"]["taskId"])
        return {"Item": copy.deepcopy(self.items[key])} if key in self.items else {}
    def put_item(self, **kw):
        item = kw["Item"]; key = (item["userId"], item["taskId"]); previous = self.items.get(key)
        if kw["ConditionExpression"].startswith("attribute_not_exists"):
            if previous: raise ClientError("ConditionalCheckFailedException")
        elif not previous or previous["version"] != kw["ExpressionAttributeValues"][":old"]:
            raise ClientError("ConditionalCheckFailedException")
        self.items[key] = copy.deepcopy(item)
    def delete_item(self, **kw):
        key = (kw["Key"]["userId"], kw["Key"]["taskId"])
        if key not in self.items or self.items[key]["version"] != kw["ExpressionAttributeValues"][":old"]:
            raise ClientError("ConditionalCheckFailedException")
        del self.items[key]

os.environ.update(TABLE_NAME="test", CLIENT_ID="client")
fake = FakeTable()
sys.modules["boto3"] = types.SimpleNamespace(resource=lambda service: types.SimpleNamespace(Table=lambda name: fake))
sys.modules["boto3.dynamodb"] = types.ModuleType("boto3.dynamodb")
sys.modules["boto3.dynamodb.conditions"] = types.SimpleNamespace(Key=FakeKey)
sys.modules["botocore"] = types.ModuleType("botocore")
sys.modules["botocore.exceptions"] = types.SimpleNamespace(ClientError=ClientError)
spec = importlib.util.spec_from_file_location("handler", Path(__file__).resolve().parents[1] / "backend/handler.py")
api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)

def event(method="GET", owner="alice", body=None, task_id="task-1"):
    route = "GET /tasks" if method == "GET" else method + " /tasks/{id}"
    return {"routeKey": route, "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": {"sub": owner, "token_use": "access", "client_id": "client", "scope": "openid email"}}}}, "pathParameters": {"id": task_id}, "body": json.dumps(body) if body is not None else None}

def task(**kw):
    return {"title": "Plan my day", "date": "2026-11-01", "time": "09:00", "priority": "normal", "reminder": True, "completed": False, **kw}

class ApiTests(unittest.TestCase):
    def setUp(self): fake.items.clear(); fake.calls.clear()
    def call(self, e): return api.handler(e, types.SimpleNamespace(aws_request_id="test"))
    def put(self, owner="alice", version=0, **kw): return self.call(event("PUT", owner, {"task": task(**kw), "expectedVersion": version}))
    def test_missing_verified_claims_rejected(self):
        self.assertEqual(self.call({"requestContext": {}})["statusCode"], 401)
    def test_id_token_rejected(self):
        e = event(); e["requestContext"]["authorizer"]["jwt"]["claims"]["token_use"] = "id"
        self.assertEqual(self.call(e)["statusCode"], 401)
    def test_other_client_rejected(self):
        e = event(); e["requestContext"]["authorizer"]["jwt"]["claims"]["client_id"] = "other"
        self.assertEqual(self.call(e)["statusCode"], 401)
    def test_scope_required(self):
        e = event(); e["requestContext"]["authorizer"]["jwt"]["claims"]["scope"] = "email"
        self.assertEqual(self.call(e)["statusCode"], 401)
    def test_owner_cannot_be_spoofed_by_payload(self):
        self.assertEqual(self.put(userId="bob", id="other")["statusCode"], 200)
        self.assertIn(("alice", "task-1"), fake.items)
        self.assertNotIn("userId", fake.items[("alice", "task-1")]["data"])
    def test_query_is_scoped(self):
        self.put("alice"); self.put("bob", title="Private Bob")
        result = json.loads(self.call(event(owner="alice"))["body"])
        self.assertEqual([t["title"] for t in result["tasks"]], ["Plan my day"])
    def test_user_cannot_edit_another_users_record(self):
        self.put("bob", title="Bob original")
        self.assertEqual(self.put("alice", version=1, title="Attack")["statusCode"], 409)
        self.assertEqual(fake.items[("bob", "task-1")]["data"]["title"], "Bob original")
    def test_user_cannot_delete_another_users_record(self):
        self.put("bob")
        self.assertEqual(self.call(event("DELETE", "alice", {"expectedVersion": 1}))["statusCode"], 409)
        self.assertIn(("bob", "task-1"), fake.items)
    def test_stale_write_conflicts(self):
        self.put(); self.assertEqual(self.put(version=1, title="New")["statusCode"], 200)
        self.assertEqual(self.put(version=1, title="Stale")["statusCode"], 409)
        self.assertEqual(fake.items[("alice", "task-1")]["data"]["title"], "New")
    def test_create_does_not_overwrite(self):
        self.put(); self.assertEqual(self.put(title="Overwrite")["statusCode"], 409)
    def test_stale_delete_conflicts(self):
        self.put(); self.put(version=1)
        self.assertEqual(self.call(event("DELETE", body={"expectedVersion": 1}))["statusCode"], 409)
    def test_deleted_record_cannot_be_updated_by_stale_client(self):
        self.put(); self.assertEqual(self.call(event("DELETE", body={"expectedVersion": 1}))["statusCode"], 204)
        self.assertEqual(self.put(version=1)["statusCode"], 409)
    def test_invalid_fields(self):
        for values in ({"title":" "}, {"notes":"x"*4001}, {"date":"2026-02-30"}, {"time":"25:01"}, {"priority":"urgent"}, {"reminder":"true"}, {"date":"", "time":"09:00"}, {"completedAt":"bad"}):
            with self.subTest(values=str(values)[:60]): self.assertEqual(self.put(**values)["statusCode"], 400)
    def test_invalid_versions(self):
        for value in (True, -1, "1", None, 2**40):
            self.assertEqual(self.call(event("PUT", body={"task":task(), "expectedVersion":value}))["statusCode"], 400)
    def test_cross_account_cursor_rejected(self):
        e = event(); e["queryStringParameters"] = {"cursor":base64.urlsafe_b64encode(json.dumps({"userId":"bob","taskId":"task-1"}).encode()).decode()}
        self.assertEqual(self.call(e)["statusCode"], 400)
    def test_response_hides_database_owner_key(self):
        result = json.loads(self.put()["body"])["task"]
        self.assertEqual(result["version"], 1); self.assertNotIn("userId", result)
    def test_malformed_body_is_400(self):
        e = event("PUT"); e["body"] = "{"; self.assertEqual(self.call(e)["statusCode"], 400)
    def test_oversized_body_is_413(self):
        e = event("PUT"); e["body"] = "x"*24001; self.assertEqual(self.call(e)["statusCode"], 413)

if __name__ == "__main__": unittest.main()
