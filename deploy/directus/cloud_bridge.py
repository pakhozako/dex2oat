#!/usr/bin/env python3
"""Directus bridge helpers for the Dex2oat cloud API.

This file is intentionally a small helper, not a public service. The 18082 cloud
API may import or shell out to it on the server to write accepted module data
into Directus. Directus credentials must stay server-side.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_URL = "http://127.0.0.1:18083"
MAX_TEXT = 512


def text(value, limit: int = MAX_TEXT) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def number(value, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def sha256_text(value: str) -> str:
    return hashlib.sha256(text(value, 2048).encode("utf-8")).hexdigest()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_env(path: str = ".env") -> dict[str, str]:
    data: dict[str, str] = {}
    if not os.path.exists(path):
        return data
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key] = value
    return data


def request_json(base_url: str, method: str, path: str, payload: dict | None = None, token: str = "") -> tuple[int, dict | str]:
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text_body = response.read().decode("utf-8", "replace")
            if response.headers.get_content_type() == "application/json":
                return response.status, json.loads(text_body or "{}")
            return response.status, text_body
    except urllib.error.HTTPError as error:
        text_body = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(text_body or "{}")
        except json.JSONDecodeError:
            return error.code, text_body


def login(base_url: str, email: str, password: str) -> str:
    status, data = request_json(base_url, "POST", "/auth/login", {"email": email, "password": password})
    if status not in (200, 201) or not isinstance(data, dict):
        raise RuntimeError(f"directus login failed: HTTP {status} {data}")
    token = ((data.get("data") or {}).get("access_token")) if isinstance(data.get("data"), dict) else None
    if not token:
        raise RuntimeError("directus login did not return access_token")
    return str(token)


def directus_context() -> tuple[str, str]:
    env = load_env(os.environ.get("DEX2OAT_PANEL_ENV") or ".env")
    base_url = os.environ.get("DIRECTUS_URL") or f"http://127.0.0.1:{env.get('DEX2OAT_PANEL_PORT', '18083')}"
    email = os.environ.get("DIRECTUS_ADMIN_EMAIL") or env.get("DIRECTUS_ADMIN_EMAIL", "")
    password = os.environ.get("DIRECTUS_ADMIN_PASSWORD") or env.get("DIRECTUS_ADMIN_PASSWORD", "")
    if not email or not password:
        raise RuntimeError("Directus admin credentials are missing")
    return base_url or DEFAULT_URL, login(base_url or DEFAULT_URL, email, password)


def create_item(collection: str, item: dict) -> dict:
    base_url, token = directus_context()
    status, data = request_json(base_url, "POST", f"/items/{collection}", item, token)
    if status not in (200, 201) or not isinstance(data, dict):
        raise RuntimeError(f"directus create failed for {collection}: HTTP {status} {data}")
    return data


def telemetry_item(payload: dict) -> dict:
    return {
        "install_hash": text(payload.get("installHash"), 96),
        "module_version": text(payload.get("moduleVersion"), 32),
        "version_code": number(payload.get("versionCode")),
        "device_model": text(payload.get("deviceModel"), 120),
        "manufacturer": text(payload.get("manufacturer"), 80),
        "brand": text(payload.get("brand"), 80),
        "android_version": text(payload.get("androidVersion"), 40),
        "sdk": number(payload.get("sdk")),
        "manager": text(payload.get("manager"), 80),
        "webview_version": text(payload.get("webviewVersion"), 80),
        "locale": text(payload.get("locale"), 40),
        "timezone": text(payload.get("timezone"), 40),
        "rule_mode": text(payload.get("ruleMode"), 40),
        "rules_version": text(payload.get("rulesVersion"), 40),
        "received_at": now_iso(),
        "payload": payload,
    }


def feedback_item(payload: dict) -> dict:
    return {
        "title": text(payload.get("title"), 160),
        "category": text(payload.get("category"), 40),
        "severity": text(payload.get("severity"), 40),
        "status": "new",
        "module_version": text(payload.get("moduleVersion"), 32),
        "version_code": number(payload.get("versionCode")),
        "install_hash": text(payload.get("installHash"), 96),
        "device_model": text(payload.get("deviceModel"), 120),
        "android_version": text(payload.get("androidVersion"), 40),
        "manager": text(payload.get("manager"), 80),
        "steps": text(payload.get("steps"), 4000),
        "expected": text(payload.get("expected"), 2000),
        "actual": text(payload.get("actual"), 2000),
        "diagnostics_included": bool(payload.get("includeDiagnostics")),
        "config_included": bool(payload.get("includeConfig")),
        "received_at": now_iso(),
        "payload": payload,
    }


def evidence_item(payload: dict) -> dict:
    captured = payload.get("capturedProps") if isinstance(payload.get("capturedProps"), dict) else {}
    enabled = payload.get("enabledProps") if isinstance(payload.get("enabledProps"), list) else []
    return {
        "install_hash": text(payload.get("installHash"), 96),
        "module_version": text(payload.get("moduleVersion"), 32),
        "version_code": number(payload.get("versionCode")),
        "rules_version": text(payload.get("rulesVersion"), 40),
        "schema_version": number(payload.get("schemaVersion")),
        "device_model": text(payload.get("deviceModel"), 120),
        "android_version": text(payload.get("androidVersion"), 40),
        "sdk": number(payload.get("sdk")),
        "manager": text(payload.get("manager"), 80),
        "rule_mode": text(payload.get("ruleMode"), 40),
        "matched_total": number(payload.get("matchedTotal")),
        "prop_count": number(payload.get("propCount")),
        "captured_total": number(payload.get("capturedTotal") or len(captured)),
        "accepted_props": len(captured),
        "status": "accepted",
        "received_at": now_iso(),
        "enabled_props": enabled,
        "captured_props": captured,
        "payload": payload,
    }


def verification_item(payload: dict, result: str, reason: str = "", supporter_id: int = 0, remote_ip: str = "", user_agent: str = "") -> dict:
    return {
        "supporter_id": supporter_id or None,
        "install_hash": text(payload.get("installHash"), 96),
        "module_version": text(payload.get("moduleVersion"), 32),
        "version_code": number(payload.get("versionCode")),
        "result": text(result, 24),
        "reason": text(reason, 120),
        "remote_ip_hash": sha256_text(remote_ip) if remote_ip else "",
        "user_agent": text(user_agent, 240),
        "verified_at": now_iso(),
        "payload": payload,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SystemExit("usage: cloud_bridge.py <telemetry|feedback|evidence> <payload-json>")
    kind = argv[0]
    payload = json.loads(argv[1])
    if kind == "telemetry":
        result = create_item("dex2oat_telemetry_events", telemetry_item(payload))
    elif kind == "feedback":
        result = create_item("dex2oat_feedback_submissions", feedback_item(payload))
    elif kind == "evidence":
        result = create_item("dex2oat_rule_evidence", evidence_item(payload))
    else:
        raise SystemExit(f"unsupported bridge kind: {kind}")
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
