#!/usr/bin/env python3
"""Bootstrap Dex2oat-Lock collections in a Directus instance.

The script is intentionally dependency-free so it can run on the managed Ubuntu
host with only Python 3 available.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


COLLECTIONS = [
    {
        "collection": "dex2oat_supporter_plans",
        "icon": "workspace_premium",
        "note": "Supporter plan definitions used by Dex2oat-Lock.",
        "display_template": "{{name}}",
        "fields": [
            {"field": "name", "type": "string", "interface": "input", "required": True, "width": "half", "length": 80},
            {"field": "slug", "type": "string", "interface": "input", "required": True, "width": "half", "length": 80},
            {"field": "description", "type": "text", "interface": "input-multiline", "width": "full"},
            {"field": "active", "type": "boolean", "interface": "boolean", "width": "half", "default": True},
            {"field": "sort", "type": "integer", "interface": "input", "width": "half", "default": 0},
            {"field": "created_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "updated_at", "type": "timestamp", "interface": "datetime", "width": "half"},
        ],
    },
    {
        "collection": "dex2oat_supporters",
        "icon": "favorite",
        "note": "Verified supporters. Store credential hashes only, not raw supporter codes.",
        "display_template": "{{display_name}}",
        "fields": [
            {"field": "display_name", "type": "string", "interface": "input", "required": True, "width": "half", "length": 80},
            {"field": "credential_hash", "type": "string", "interface": "input", "required": True, "width": "half", "length": 160},
            {"field": "tier", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "badge", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "status", "type": "string", "interface": "select-dropdown", "width": "half", "length": 24},
            {"field": "expires_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "max_devices", "type": "integer", "interface": "input", "width": "half", "default": 3},
            {"field": "usage_count", "type": "integer", "interface": "input", "width": "half", "default": 0},
            {"field": "last_verified_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "source", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "notes", "type": "text", "interface": "input-multiline", "width": "full"},
            {"field": "created_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "updated_at", "type": "timestamp", "interface": "datetime", "width": "half"},
        ],
    },
    {
        "collection": "dex2oat_supporter_verifications",
        "icon": "verified_user",
        "note": "Server-side supporter verification attempts and outcomes.",
        "display_template": "{{install_hash}} {{result}}",
        "fields": [
            {"field": "supporter_id", "type": "integer", "interface": "input", "width": "half"},
            {"field": "install_hash", "type": "string", "interface": "input", "width": "half", "length": 96},
            {"field": "module_version", "type": "string", "interface": "input", "width": "half", "length": 32},
            {"field": "version_code", "type": "integer", "interface": "input", "width": "half"},
            {"field": "result", "type": "string", "interface": "select-dropdown", "width": "half", "length": 24},
            {"field": "reason", "type": "string", "interface": "input", "width": "half", "length": 120},
            {"field": "remote_ip_hash", "type": "string", "interface": "input", "width": "half", "length": 96},
            {"field": "user_agent", "type": "string", "interface": "input", "width": "half", "length": 240},
            {"field": "verified_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "payload", "type": "json", "interface": "input-code", "width": "full"},
        ],
    },
    {
        "collection": "dex2oat_feedback_submissions",
        "icon": "feedback",
        "note": "Feedback uploaded by the WebUI feedback dialog.",
        "display_template": "{{title}}",
        "fields": [
            {"field": "title", "type": "string", "interface": "input", "required": True, "width": "full", "length": 160},
            {"field": "category", "type": "string", "interface": "select-dropdown", "width": "half", "length": 40},
            {"field": "severity", "type": "string", "interface": "select-dropdown", "width": "half", "length": 40},
            {"field": "status", "type": "string", "interface": "select-dropdown", "width": "half", "length": 40},
            {"field": "module_version", "type": "string", "interface": "input", "width": "half", "length": 32},
            {"field": "version_code", "type": "integer", "interface": "input", "width": "half"},
            {"field": "install_hash", "type": "string", "interface": "input", "width": "half", "length": 96},
            {"field": "device_model", "type": "string", "interface": "input", "width": "half", "length": 120},
            {"field": "android_version", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "manager", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "steps", "type": "text", "interface": "input-multiline", "width": "full"},
            {"field": "expected", "type": "text", "interface": "input-multiline", "width": "full"},
            {"field": "actual", "type": "text", "interface": "input-multiline", "width": "full"},
            {"field": "diagnostics_included", "type": "boolean", "interface": "boolean", "width": "half", "default": False},
            {"field": "config_included", "type": "boolean", "interface": "boolean", "width": "half", "default": False},
            {"field": "received_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "payload", "type": "json", "interface": "input-code", "width": "full"},
        ],
    },
    {
        "collection": "dex2oat_telemetry_events",
        "icon": "monitoring",
        "note": "Optional privacy-minimal module communication heartbeat events.",
        "display_template": "{{install_hash}} {{module_version}}",
        "fields": [
            {"field": "install_hash", "type": "string", "interface": "input", "required": True, "width": "half", "length": 96},
            {"field": "module_version", "type": "string", "interface": "input", "width": "half", "length": 32},
            {"field": "version_code", "type": "integer", "interface": "input", "width": "half"},
            {"field": "device_model", "type": "string", "interface": "input", "width": "half", "length": 120},
            {"field": "manufacturer", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "brand", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "android_version", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "sdk", "type": "integer", "interface": "input", "width": "half"},
            {"field": "manager", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "webview_version", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "locale", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "timezone", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "rule_mode", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "rules_version", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "received_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "payload", "type": "json", "interface": "input-code", "width": "full"},
        ],
    },
    {
        "collection": "dex2oat_rule_evidence",
        "icon": "rule",
        "note": "User-confirmed, allowlisted rule evidence uploads.",
        "display_template": "{{install_hash}} {{rules_version}}",
        "fields": [
            {"field": "install_hash", "type": "string", "interface": "input", "required": True, "width": "half", "length": 96},
            {"field": "module_version", "type": "string", "interface": "input", "width": "half", "length": 32},
            {"field": "version_code", "type": "integer", "interface": "input", "width": "half"},
            {"field": "rules_version", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "schema_version", "type": "integer", "interface": "input", "width": "half"},
            {"field": "device_model", "type": "string", "interface": "input", "width": "half", "length": 120},
            {"field": "android_version", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "sdk", "type": "integer", "interface": "input", "width": "half"},
            {"field": "manager", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "rule_mode", "type": "string", "interface": "input", "width": "half", "length": 40},
            {"field": "matched_total", "type": "integer", "interface": "input", "width": "half"},
            {"field": "prop_count", "type": "integer", "interface": "input", "width": "half"},
            {"field": "captured_total", "type": "integer", "interface": "input", "width": "half"},
            {"field": "accepted_props", "type": "integer", "interface": "input", "width": "half"},
            {"field": "status", "type": "string", "interface": "select-dropdown", "width": "half", "length": 40},
            {"field": "received_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "enabled_props", "type": "json", "interface": "input-code", "width": "full"},
            {"field": "captured_props", "type": "json", "interface": "input-code", "width": "full"},
            {"field": "payload", "type": "json", "interface": "input-code", "width": "full"},
        ],
    },
    {
        "collection": "dex2oat_cloud_releases",
        "icon": "deployed_code",
        "note": "Release mirror records synced from Dex2oat cloud deploys.",
        "display_template": "{{version}}",
        "fields": [
            {"field": "version", "type": "string", "interface": "input", "required": True, "width": "half", "length": 32},
            {"field": "version_code", "type": "integer", "interface": "input", "width": "half"},
            {"field": "zip_url", "type": "string", "interface": "input", "width": "full", "length": 512},
            {"field": "sha256", "type": "string", "interface": "input", "width": "full", "length": 80},
            {"field": "size_bytes", "type": "bigInteger", "interface": "input", "width": "half"},
            {"field": "released_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "manifest", "type": "json", "interface": "input-code", "width": "full"},
        ],
    },
    {
        "collection": "dex2oat_operator_notes",
        "icon": "sticky_note_2",
        "note": "Private operator notes for follow-up, audits, and release operations.",
        "display_template": "{{title}}",
        "fields": [
            {"field": "title", "type": "string", "interface": "input", "required": True, "width": "full", "length": 160},
            {"field": "topic", "type": "string", "interface": "input", "width": "half", "length": 80},
            {"field": "status", "type": "string", "interface": "select-dropdown", "width": "half", "length": 40},
            {"field": "body", "type": "text", "interface": "input-multiline", "width": "full"},
            {"field": "created_at", "type": "timestamp", "interface": "datetime", "width": "half"},
            {"field": "updated_at", "type": "timestamp", "interface": "datetime", "width": "half"},
        ],
    },
]


class DirectusError(RuntimeError):
    pass


def retry_after_seconds(data: dict | str, fallback: int = 5) -> int:
    if not isinstance(data, dict):
        return fallback
    errors = data.get("errors")
    if not isinstance(errors, list) or not errors:
        return fallback
    message = str(errors[0].get("message", "")) if isinstance(errors[0], dict) else ""
    marker = "retry after "
    if marker not in message:
        return fallback
    tail = message.split(marker, 1)[1].split("s", 1)[0]
    try:
        return max(1, min(int(tail), 65))
    except ValueError:
        return fallback


def public_json_request(base_url: str, method: str, path: str, payload: dict | None = None) -> tuple[int, dict | str]:
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", "replace")
            if response.headers.get_content_type() == "application/json":
                return response.status, json.loads(body or "{}")
            return response.status, body
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            parsed: dict | str = json.loads(body or "{}")
        except json.JSONDecodeError:
            parsed = body
        return error.code, parsed


def json_request(base_url: str, token: str, method: str, path: str, payload: dict | None = None) -> tuple[int, dict | str]:
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", "replace")
            if response.headers.get_content_type() == "application/json":
                return response.status, json.loads(body or "{}")
            return response.status, body
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            parsed: dict | str = json.loads(body or "{}")
        except json.JSONDecodeError:
            parsed = body
        return error.code, parsed


def directus_request(base_url: str, token: str, method: str, path: str, payload: dict | None = None) -> tuple[int, dict | str]:
    for attempt in range(4):
        status, data = json_request(base_url, token, method, path, payload)
        if status != 429:
            return status, data
        if attempt == 3:
            return status, data
        time.sleep(retry_after_seconds(data) + 1)
    return status, data


def ping(base_url: str) -> bool:
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", "server/ping")
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            return response.status < 400 and response.read().decode("utf-8", "replace").strip() == "pong"
    except Exception:
        return False


def login(base_url: str, email: str, password: str) -> str:
    if not email or not password:
        raise DirectusError("DIRECTUS_ADMIN_EMAIL and DIRECTUS_ADMIN_PASSWORD are required")
    status, data = public_json_request(base_url, "POST", "/auth/login", {"email": email, "password": password})
    if status not in (200, 201) or not isinstance(data, dict):
        raise DirectusError(f"Directus login failed: HTTP {status} {data}")
    token = ((data.get("data") or {}).get("access_token")) if isinstance(data.get("data"), dict) else None
    if not token:
        raise DirectusError("Directus login did not return an access token")
    return str(token)


def wait_for_directus(base_url: str, timeout: int) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if ping(base_url):
            return
        time.sleep(2)
    raise DirectusError(f"Directus did not answer /server/ping within {timeout}s: {base_url}")


def create_collection(base_url: str, token: str, spec: dict) -> str:
    name = spec["collection"]
    status, _data = directus_request(base_url, token, "GET", f"/collections/{name}")
    if status == 200:
        return "exists"
    if status not in (403, 404):
        raise DirectusError(f"collection lookup failed for {name}: HTTP {status}")

    payload = {
        "collection": name,
        "meta": {
            "icon": spec.get("icon", "table_view"),
            "note": spec.get("note", ""),
            "display_template": spec.get("display_template", "{{id}}"),
            "hidden": False,
            "singleton": False,
        },
        "schema": {"name": name},
    }
    status, data = directus_request(base_url, token, "POST", "/collections", payload)
    if status not in (200, 201):
        raise DirectusError(f"collection create failed for {name}: HTTP {status} {data}")
    return "created"


def field_payload(collection: str, spec: dict, sort: int) -> dict:
    field_type = spec["type"]
    schema: dict[str, object] = {
        "name": spec["field"],
        "table": collection,
        "is_nullable": not bool(spec.get("required")),
    }
    if "length" in spec:
        schema["max_length"] = int(spec["length"])
    if "default" in spec:
        schema["default_value"] = spec["default"]

    return {
        "field": spec["field"],
        "type": field_type,
        "schema": schema,
        "meta": {
            "interface": spec.get("interface", "input"),
            "required": bool(spec.get("required")),
            "width": spec.get("width", "full"),
            "sort": sort,
            "hidden": bool(spec.get("hidden", False)),
            "readonly": bool(spec.get("readonly", False)),
            "note": spec.get("note", ""),
        },
    }


def create_fields(base_url: str, token: str, spec: dict) -> dict:
    collection = spec["collection"]
    status, data = directus_request(base_url, token, "GET", f"/fields/{collection}")
    if status != 200 or not isinstance(data, dict):
        raise DirectusError(f"field lookup failed for {collection}: HTTP {status} {data}")
    existing = {item.get("field") for item in data.get("data", []) if isinstance(item, dict)}
    created = []
    skipped = []
    for index, field in enumerate(spec.get("fields", []), start=1):
        if field["field"] in existing:
            skipped.append(field["field"])
            continue
        payload = field_payload(collection, field, index)
        status, result = directus_request(base_url, token, "POST", f"/fields/{collection}", payload)
        if status not in (200, 201):
            raise DirectusError(f"field create failed for {collection}.{field['field']}: HTTP {status} {result}")
        created.append(field["field"])
    return {"created": created, "skipped": skipped}


def bootstrap(base_url: str, token: str, timeout: int) -> dict:
    wait_for_directus(base_url, timeout)
    result = {"collections": []}
    for spec in COLLECTIONS:
        state = create_collection(base_url, token, spec)
        fields = create_fields(base_url, token, spec)
        result["collections"].append({
            "collection": spec["collection"],
            "state": state,
            "fieldsCreated": len(fields["created"]),
            "fieldsSkipped": len(fields["skipped"]),
        })
    return result


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap Directus collections for Dex2oat-Lock.")
    parser.add_argument("--url", default=os.environ.get("DIRECTUS_URL") or "http://127.0.0.1:18083")
    parser.add_argument("--email", default=os.environ.get("DIRECTUS_ADMIN_EMAIL") or "")
    parser.add_argument("--password", default=os.environ.get("DIRECTUS_ADMIN_PASSWORD") or "")
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    wait_for_directus(args.url, args.timeout)
    token = login(args.url, args.email, args.password)
    result = bootstrap(args.url, token, args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
