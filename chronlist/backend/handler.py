"""ChronList API. Only API Gateway's verified JWT claims establish ownership."""
import base64
import json
import os
import re
from datetime import date, datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
CLIENT_ID = os.environ["CLIENT_ID"]
ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def reply(code, body=None):
    return {"statusCode": code, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
            "body": "" if body is None else json.dumps(body, default=lambda x: int(x) if isinstance(x, Decimal) else str(x))}


def valid_timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Invalid completion timestamp.")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include a timezone.")
    return value


def clean_task(raw, task_id):
    if not isinstance(raw, dict):
        raise ValueError("A task object is required.")
    title, notes = raw.get("title"), raw.get("notes", "")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
        raise ValueError("Task name must be 1–120 characters.")
    if not isinstance(notes, str) or len(notes) > 4000:
        raise ValueError("Notes must be at most 4000 characters.")
    due, time = raw.get("date", ""), raw.get("time", "")
    if not isinstance(due, str) or not isinstance(time, str):
        raise ValueError("Invalid date or time.")
    if due:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            raise ValueError("Invalid date.")
        date.fromisoformat(due)
    if time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time):
        raise ValueError("Invalid time.")
    if time and not due:
        raise ValueError("Choose a date when setting a time.")
    priority = raw.get("priority", "normal")
    if priority not in ("normal", "high", "low"):
        raise ValueError("Invalid priority.")
    completed, reminder = raw.get("completed", False), raw.get("reminder", False)
    if type(completed) is not bool or type(reminder) is not bool:
        raise ValueError("Completed and reminder must be boolean values.")
    if reminder and (not due or not time):
        raise ValueError("Reminders require a date and time.")
    completed_at = raw.get("completedAt")
    if completed_at is not None:
        valid_timestamp(completed_at)
    if not completed:
        completed_at = None
    # Ownership, versions, and updatedAt from a browser are never trusted.
    return {"id": task_id, "title": title.strip(), "notes": notes.strip(), "date": due, "time": time,
            "priority": priority, "completed": completed, "reminder": reminder, "completedAt": completed_at}


def public(item):
    return {**item["data"], "id": item["taskId"], "version": int(item["version"]), "createdAt": item["createdAt"], "updatedAt": item["updatedAt"]}


def handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")
    try:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        owner = claims.get("sub")
        if not owner or claims.get("token_use") != "access" or claims.get("client_id") != CLIENT_ID or "openid" not in claims.get("scope", "").split():
            return reply(401, {"error": "Unauthorized"})
        method = event.get("requestContext", {}).get("http", {}).get("method")
        route = event.get("routeKey", "")
        if method == "GET" and route == "GET /tasks":
            cursor = (event.get("queryStringParameters") or {}).get("cursor")
            kwargs = {"KeyConditionExpression": Key("userId").eq(owner), "ConsistentRead": True, "Limit": 100}
            if cursor:
                if not isinstance(cursor, str) or len(cursor) > 2048:
                    raise ValueError("Invalid pagination cursor.")
                try:
                    key = json.loads(base64.urlsafe_b64decode(cursor.encode()))
                except Exception as error:
                    raise ValueError("Invalid pagination cursor.") from error
                if not isinstance(key, dict) or key.get("userId") != owner or not isinstance(key.get("taskId"), str) or not ID.fullmatch(key["taskId"]):
                    raise ValueError("Invalid pagination cursor.")
                kwargs["ExclusiveStartKey"] = {"userId": owner, "taskId": key["taskId"]}
            result = TABLE.query(**kwargs)
            next_cursor = base64.urlsafe_b64encode(json.dumps(result["LastEvaluatedKey"]).encode()).decode() if result.get("LastEvaluatedKey") else None
            return reply(200, {"tasks": [public(item) for item in result.get("Items", [])], "nextCursor": next_cursor})
        if route not in ("PUT /tasks/{id}", "DELETE /tasks/{id}"):
            return reply(404, {"error": "Not found"})
        task_id = (event.get("pathParameters") or {}).get("id", "")
        if not isinstance(task_id, str) or not ID.fullmatch(task_id):
            raise ValueError("Invalid task ID.")
        raw_body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body).decode()
        if len(raw_body.encode()) > 24000:
            return reply(413, {"error": "Task is too large."})
        try:
            body = json.loads(raw_body)
        except (ValueError, TypeError) as error:
            raise ValueError("Invalid JSON request.") from error
        if not isinstance(body, dict):
            raise ValueError("Request body must be an object.")
        version = body.get("expectedVersion")
        if type(version) is not int or version < 0 or version > 2147483647:
            raise ValueError("A valid expectedVersion is required.")
        key = {"userId": owner, "taskId": task_id}
        if method == "DELETE":
            if version == 0:
                raise ValueError("Delete requires an existing task version.")
            TABLE.delete_item(Key=key, ConditionExpression="#v = :old", ExpressionAttributeNames={"#v": "version"}, ExpressionAttributeValues={":old": version})
            return reply(204)
        if method != "PUT":
            return reply(405, {"error": "Method not allowed"})
        data = clean_task(body.get("task"), task_id)
        now = datetime.now(timezone.utc).isoformat()
        created_at = now
        if version:
            existing = TABLE.get_item(Key=key, ConsistentRead=True).get("Item")
            if not existing or int(existing["version"]) != version:
                return reply(409, {"error": "Task changed. Sync and try again."})
            created_at = existing["createdAt"]
        item = {**key, "data": data, "version": version + 1, "createdAt": created_at, "updatedAt": now}
        args = {"Item": item, "ConditionExpression": "attribute_not_exists(taskId)" if version == 0 else "#v = :old"}
        if version:
            args.update(ExpressionAttributeNames={"#v": "version"}, ExpressionAttributeValues={":old": version})
        TABLE.put_item(**args)
        return reply(200, {"task": public(item)})
    except (ValueError, TypeError, UnicodeError):
        return reply(400, {"error": "Invalid task or request. Check the field lengths, dates, and task version."})
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return reply(409, {"error": "Task changed. Sync and try again."})
        # Never log task contents, tokens, or email addresses.
        print(json.dumps({"requestId": request_id, "error": error.response.get("Error", {}).get("Code", "AWS_ERROR")}))
        return reply(503, {"error": "Storage is temporarily unavailable. Try again."})
    except Exception:
        print(json.dumps({"requestId": request_id, "error": "INTERNAL_ERROR"}))
        return reply(500, {"error": "Could not process the request. Try again."})
