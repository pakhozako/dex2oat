#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
import argparse
import functools
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque

MAX_TELEMETRY_BODY = 16384
MAX_EVENT_BODY = 32768
MAX_SUPPORTER_BODY = 8192
MAX_FEEDBACK_BODY = 32768
MAX_EVIDENCE_BODY = 262144
MAX_RULE_PROPS = 500
MAX_JSONL_LINES_FOR_SUMMARY = 8000
DIRECTUS_TIMEOUT_SECONDS = 8
RATE_WINDOW_SECONDS = 60
RATE_LIMITS = {
    "GET": 180,
    "/api/telemetry": 30,
    "/api/feature-usage": 20,
    "/api/crash-report": 10,
    "/api/rule-evidence": 8,
    "/api/feedback": 8,
    "/api/supporter/verify": 12,
    "POST": 20,
}

ALLOWED_KEYS = {
    "installHash", "moduleVersion", "versionCode", "deviceModel", "manufacturer", "brand",
    "androidVersion", "sdk", "manager", "webviewVersion", "locale",
    "timezone", "ruleMode", "rulesVersion", "installSource", "kernelVersion"
}
TEXT_LIMITS = {
    "installHash": 96, "moduleVersion": 32, "deviceModel": 80, "manufacturer": 48, "brand": 48,
    "androidVersion": 32, "manager": 48, "webviewVersion": 80, "locale": 32,
    "timezone": 32, "ruleMode": 32, "rulesVersion": 32, "installSource": 48, "kernelVersion": 96
}
HASH_RE = re.compile(r"^[A-Za-z0-9._:-]{6,96}$")
SUPPORTER_CODE_RE = re.compile(r"[^A-Za-z0-9]+")
SENSITIVE_RE = re.compile(r"(android_id|imei|meid|serial|phone|account|email|token|password|passwd|credential|auth|cookie|secret)", re.I)
RULE_PROP_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
ALLOWED_RULE_PREFIXES = (
    "dalvik.",
    "dalvik.vm.",
    "pm.dexopt.",
    "persist.device_config.runtime",
    "persist.device_config.runtime_native",
    "persist.device_config.runtime_native_boot",
    "persist.dalvik.",
    "persist.miui.",
    "persist.oplus.",
    "persist.sys.app_dexfile_preload.",
    "persist.sys.art_startup_class_preload.",
    "persist.sys.dexpreload.",
    "persist.sys.feature.compile.",
    "persist.sys.oplus.",
    "persist.sys.precache.",
    "ro.build.version.",
    "ro.odm.",
    "ro.product.",
    "ro.system.",
    "ro.vendor.",
    "runtime.",
    "sys.gcsupression.",
    "sys.heap.",
    "sys.furtherHeapEnlarge.",
    "sys.oplus.",
    "system_perf_init.",
    "vendor.oplus.dalvik.",
    "oplus.",
)


def clean_text(value, limit):
    value = str(value or "").strip()
    value = "".join(ch for ch in value if ch.isprintable())
    return value[:limit]


def normalize_payload(data):
    out = {}
    for key in ALLOWED_KEYS:
        if key not in data:
            continue
        if key in ("versionCode", "sdk"):
            try:
                out[key] = int(data[key])
            except Exception:
                continue
        else:
            value = clean_text(data[key], TEXT_LIMITS.get(key, 64))
            if key == "installHash" and value and not HASH_RE.match(value):
                continue
            out[key] = value
    if not out.get("moduleVersion"):
        out["moduleVersion"] = "unknown"
    if not out.get("deviceModel"):
        out["deviceModel"] = "unknown"
    if not out.get("manager"):
        out["manager"] = "unknown"
    return out


def is_rule_prop_allowed(key):
    key = clean_text(key, 128)
    if not key or SENSITIVE_RE.search(key) or not RULE_PROP_RE.match(key):
        return False
    return any(key.startswith(prefix) for prefix in ALLOWED_RULE_PREFIXES)


def clean_rule_value(value):
    value = clean_text(value, 192)
    if not value or SENSITIVE_RE.search(value):
        return ""
    return value


def normalize_rule_props(value):
    if not isinstance(value, dict):
        return {}
    props = {}
    for raw_key, raw_value in value.items():
        key = clean_text(raw_key, 128)
        if not is_rule_prop_allowed(key):
            continue
        safe_value = clean_rule_value(raw_value)
        if not safe_value and safe_value != "0":
            continue
        props[key] = safe_value
        if len(props) >= MAX_RULE_PROPS:
            break
    return props


def normalize_prop_list(value):
    if not isinstance(value, list):
        return []
    result = []
    seen = set()
    for item in value:
        prop = clean_text(item, 128)
        if prop in seen or not is_rule_prop_allowed(prop):
            continue
        seen.add(prop)
        result.append(prop)
        if len(result) >= MAX_RULE_PROPS:
            break
    return result


def utc_now():
    return int(time.time())


def utc_iso(ts=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts or utc_now()))

def sha256_hex(value):
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def canonical_supporter_credential(value):
    return SUPPORTER_CODE_RE.sub("", clean_text(value, 128)).upper()[:64]


def supporter_credential_digest(value):
    credential = canonical_supporter_credential(value)
    return sha256_hex(credential) if credential else ""


def load_env_file(path):
    data = {}
    try:
        for raw in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key] = value
    except OSError:
        pass
    return data


def directus_request_json(base_url, method, path, payload=None, token=""):
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=DIRECTUS_TIMEOUT_SECONDS) as response:
        text = response.read().decode("utf-8", "replace")
        if response.headers.get_content_type() == "application/json":
            return response.status, json.loads(text or "{}")
        return response.status, text


def normalize_supporter_hash(value):
    text = clean_text(value, 96).lower()
    if text.startswith("sha256:"):
        text = text.split(":", 1)[1]
    return text if re.fullmatch(r"[a-f0-9]{64}", text or "") else ""


def supporter_credential_hashes(entry):
    hashes = []
    for key in ("credentialHash", "credentialSha256"):
        value = normalize_supporter_hash(entry.get(key))
        if value:
            hashes.append(value)
    for value in entry.get("credentialHashes") or []:
        normalized = normalize_supporter_hash(value)
        if normalized:
            hashes.append(normalized)
    credential = clean_text(entry.get("credential"), 128)
    if credential:
        digest = supporter_credential_digest(credential)
        if digest:
            hashes.append(digest)
    return set(hashes)


def supporter_install_allowed(entry, install_hash):
    allowed = []
    for key in ("installHash", "boundInstallHash"):
        value = clean_text(entry.get(key), 96)
        if value:
            allowed.append(value)
    for value in entry.get("installHashes") or []:
        safe = clean_text(value, 96)
        if safe:
            allowed.append(safe)
    return not allowed or clean_text(install_hash, 96) in set(allowed)


def public_supporter_entry(entry):
    expires_at = int(entry.get("expiresAt") or 0)
    return {
        "name": clean_text(entry.get("name") or entry.get("displayName"), 32),
        "tier": clean_text(entry.get("tier") or "???", 18),
        "badge": clean_text(entry.get("badge") or "??", 18),
        "note": clean_text(entry.get("note"), 48),
        "order": int(entry.get("order") or 0),
        "active": entry.get("active") is not False,
        "expiresAt": expires_at,
    }


def supporter_skin_ids(entry):
    ids = []

    def add(value):
        skin_id = clean_text(value, 64)
        if skin_id in ("memorial-amber", "founder-qingmu") and skin_id not in ids:
            ids.append(skin_id)

    add(entry.get("skinId"))
    for value in entry.get("skinIds") or []:
        add(value)
    return ids


def anonymize(payload, client_ip):
    day = time.strftime("%Y-%m-%d", time.gmtime())
    salt = os.environ.get("DEX2OAT_TELEMETRY_SALT", "dex2oat-lock-daily-salt") + day
    basis = payload.get("installHash") or "|".join([
        client_ip or "0.0.0.0",
        payload.get("deviceModel", "unknown"),
        str(payload.get("sdk", "")),
        payload.get("manager", "unknown"),
        payload.get("moduleVersion", "unknown"),
    ])
    return hmac.new(salt.encode(), basis.encode(), hashlib.sha256).hexdigest()[:24]


class DirectusBridge:
    def __init__(self, panel_dir):
        self.panel_dir = Path(panel_dir) if panel_dir else None
        self.lock = threading.Lock()
        self.token = ""
        self.token_until = 0
        self.enabled = False
        self.base_url = ""
        self.email = ""
        self.password = ""
        if self.panel_dir:
            self.configure()

    def configure(self):
        env = load_env_file(self.panel_dir / ".env")
        port = env.get("DEX2OAT_PANEL_PORT") or "18083"
        self.base_url = os.environ.get("DEX2OAT_DIRECTUS_URL") or f"http://127.0.0.1:{port}"
        self.email = os.environ.get("DIRECTUS_ADMIN_EMAIL") or env.get("DIRECTUS_ADMIN_EMAIL", "")
        self.password = os.environ.get("DIRECTUS_ADMIN_PASSWORD") or env.get("DIRECTUS_ADMIN_PASSWORD", "")
        self.enabled = bool(self.email and self.password)

    def login(self):
        now = time.time()
        with self.lock:
            if self.token and self.token_until > now + 30:
                return self.token
            status, data = directus_request_json(
                self.base_url,
                "POST",
                "/auth/login",
                {"email": self.email, "password": self.password},
            )
            if status not in (200, 201) or not isinstance(data, dict):
                raise RuntimeError(f"directus login failed: HTTP {status}")
            token = ((data.get("data") or {}).get("access_token")) if isinstance(data.get("data"), dict) else ""
            if not token:
                raise RuntimeError("directus login returned no token")
            self.token = str(token)
            self.token_until = now + 10 * 60
            return self.token

    def create_item(self, collection, item):
        if not self.enabled:
            return False
        token = self.login()
        status, _data = directus_request_json(self.base_url, "POST", f"/items/{collection}", item, token)
        if status not in (200, 201):
            raise RuntimeError(f"directus create failed for {collection}: HTTP {status}")
        return True

    def mirror_async(self, collection, item):
        if not self.enabled:
            return

        def runner():
            try:
                self.create_item(collection, item)
            except Exception as exc:
                print(f"directus mirror failed for {collection}: {str(exc)[:160]}", flush=True)

        threading.Thread(target=runner, daemon=True).start()


def directus_telemetry_item(payload):
    return {
        "install_hash": clean_text(payload.get("installHash"), 96),
        "module_version": clean_text(payload.get("moduleVersion"), 32),
        "version_code": int(payload.get("versionCode") or 0),
        "device_model": clean_text(payload.get("deviceModel"), 120),
        "manufacturer": clean_text(payload.get("manufacturer"), 80),
        "brand": clean_text(payload.get("brand"), 80),
        "android_version": clean_text(payload.get("androidVersion"), 40),
        "sdk": int(payload.get("sdk") or 0),
        "manager": clean_text(payload.get("manager"), 80),
        "webview_version": clean_text(payload.get("webviewVersion"), 80),
        "locale": clean_text(payload.get("locale"), 40),
        "timezone": clean_text(payload.get("timezone"), 40),
        "rule_mode": clean_text(payload.get("ruleMode"), 40),
        "rules_version": clean_text(payload.get("rulesVersion"), 40),
        "received_at": utc_iso(),
        "payload": payload,
    }


def directus_evidence_item(row):
    return {
        "install_hash": clean_text(row.get("installHash"), 96),
        "module_version": clean_text(row.get("moduleVersion"), 32),
        "version_code": int(row.get("versionCode") or 0),
        "rules_version": clean_text(row.get("rulesVersion"), 40),
        "schema_version": int(row.get("schemaVersion") or 0),
        "device_model": clean_text(row.get("deviceModel"), 120),
        "android_version": clean_text(row.get("androidVersion"), 40),
        "sdk": int(row.get("sdk") or 0),
        "manager": clean_text(row.get("manager"), 80),
        "rule_mode": clean_text(row.get("ruleMode"), 40),
        "matched_total": int(row.get("matchedTotal") or 0),
        "prop_count": int(row.get("propCount") or 0),
        "captured_total": int(row.get("capturedTotal") or 0),
        "accepted_props": len(row.get("capturedProps") or {}),
        "status": "accepted",
        "received_at": row.get("at") or utc_iso(),
        "enabled_props": row.get("enabledProps") or [],
        "captured_props": row.get("capturedProps") or {},
        "payload": row,
    }


def directus_feedback_item(row):
    return {
        "title": clean_text(row.get("title"), 160),
        "category": clean_text(row.get("category"), 40),
        "severity": clean_text(row.get("severity"), 40),
        "status": "new",
        "module_version": clean_text(row.get("moduleVersion"), 32),
        "version_code": int(row.get("versionCode") or 0),
        "install_hash": clean_text(row.get("installHash"), 96),
        "device_model": clean_text(row.get("deviceModel"), 120),
        "android_version": clean_text(row.get("androidVersion"), 40),
        "manager": clean_text(row.get("manager"), 80),
        "steps": clean_text(row.get("steps"), 4000),
        "expected": clean_text(row.get("expected"), 2000),
        "actual": clean_text(row.get("actual"), 2000),
        "diagnostics_included": bool(row.get("diagnosticsIncluded")),
        "config_included": bool(row.get("configIncluded")),
        "received_at": row.get("at") or utc_iso(),
        "payload": row,
    }


def directus_verification_item(data, result, reason="", supporter_id=0, client_ip="", user_agent=""):
    payload = normalize_payload(data)
    for key in ("credentialHash", "codeId"):
        value = clean_text(data.get(key), 96)
        if value:
            payload[key] = value
    if "reused" in data:
        payload["reused"] = bool(data.get("reused"))
    return {
        "supporter_id": supporter_id or None,
        "install_hash": clean_text(data.get("installHash") or payload.get("installHash"), 96),
        "module_version": clean_text(payload.get("moduleVersion"), 32),
        "version_code": int(payload.get("versionCode") or 0),
        "result": clean_text(result, 24),
        "reason": clean_text(reason, 120),
        "remote_ip_hash": sha256_hex(client_ip) if client_ip else "",
        "user_agent": clean_text(user_agent, 240),
        "verified_at": utc_iso(),
        "payload": payload,
    }


def supporter_verification_row(data, result, reason="", supporter_id=0, client_ip="", user_agent=""):
    payload = normalize_payload(data)
    return {
        "ts": utc_now(),
        "at": utc_iso(),
        "supporterId": supporter_id or 0,
        "result": clean_text(result, 24),
        "reason": clean_text(reason, 120),
        "credentialHash": normalize_supporter_hash(data.get("credentialHash")),
        "codeId": clean_text(data.get("codeId"), 64),
        "installHash": clean_text(data.get("installHash") or payload.get("installHash"), 96),
        "moduleVersion": clean_text(payload.get("moduleVersion"), 32),
        "versionCode": int(payload.get("versionCode") or 0),
        "deviceModel": clean_text(payload.get("deviceModel"), 120),
        "androidVersion": clean_text(payload.get("androidVersion"), 40),
        "manager": clean_text(payload.get("manager"), 80),
        "remoteIpHash": sha256_hex(client_ip) if client_ip else "",
        "userAgent": clean_text(user_agent, 240),
        "reused": bool(data.get("reused")),
    }


class TelemetryStore:
    def __init__(self, db_path, bridge=None):
        self.db_path = db_path
        self.bridge = bridge
        self.init_db()

    def connect(self):
        return sqlite3.connect(self.db_path, timeout=10)

    def init_db(self):
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts INTEGER NOT NULL,
                    day TEXT NOT NULL,
                    anon TEXT NOT NULL,
                    installHash TEXT,
                    moduleVersion TEXT,
                    versionCode INTEGER,
                    deviceModel TEXT,
                    manufacturer TEXT,
                    brand TEXT,
                    androidVersion TEXT,
                    sdk INTEGER,
                    manager TEXT,
                    webviewVersion TEXT,
                    locale TEXT,
                    timezone TEXT,
                    ruleMode TEXT,
                    rulesVersion TEXT,
                    installSource TEXT,
                    kernelVersion TEXT
                )
            """)
            self.ensure_column(db, "events", "installHash", "TEXT")
            self.ensure_column(db, "events", "kernelVersion", "TEXT")
            db.execute("CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_events_model ON events(deviceModel)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_events_install_hash ON events(installHash)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)")

    def ensure_column(self, db, table, column, kind):
        columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")

    def add(self, payload, client_ip):
        now = utc_now()
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        anon = anonymize(payload, client_ip)
        with self.connect() as db:
            db.execute(
                """INSERT INTO events(ts, day, anon, installHash, moduleVersion, versionCode, deviceModel, manufacturer, brand,
                androidVersion, sdk, manager, webviewVersion, locale, timezone, ruleMode, rulesVersion, installSource, kernelVersion)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (now, day, anon, payload.get("installHash"), payload.get("moduleVersion"), payload.get("versionCode"), payload.get("deviceModel"),
                 payload.get("manufacturer"), payload.get("brand"), payload.get("androidVersion"), payload.get("sdk"),
                 payload.get("manager"), payload.get("webviewVersion"), payload.get("locale"), payload.get("timezone"),
                 payload.get("ruleMode"), payload.get("rulesVersion"), payload.get("installSource"), payload.get("kernelVersion"))
            )
        if self.bridge:
            self.bridge.mirror_async("dex2oat_telemetry_events", directus_telemetry_item(payload))
        return {"ok": True, "day": day, "directusQueued": bool(self.bridge and self.bridge.enabled)}

    def top(self, db, column, limit=12, since_ts=None):
        allowed = {"deviceModel", "manufacturer", "brand", "manager", "moduleVersion", "androidVersion", "sdk", "rulesVersion", "webviewVersion", "ruleMode", "kernelVersion"}
        if column not in allowed:
            return []
        where = "WHERE ts >= ?" if since_ts else ""
        params = [since_ts, limit] if since_ts else [limit]
        rows = db.execute(
            f"SELECT COALESCE(NULLIF({column}, ''), 'unknown') AS k, COUNT(*) AS c FROM events {where} GROUP BY k ORDER BY c DESC, k LIMIT ?",
            params
        ).fetchall()
        return [{"name": str(key), "count": count} for key, count in rows]

    def scalar(self, db, sql, params=()):
        return db.execute(sql, params).fetchone()[0]

    def summary(self):
        now = utc_now()
        since_7d = now - 7 * 86400
        since_30d = now - 30 * 86400
        with self.connect() as db:
            total = self.scalar(db, "SELECT COUNT(*) FROM events")
            unique_daily = self.scalar(db, "SELECT COUNT(DISTINCT anon) FROM events")
            unique_install = self.scalar(db, "SELECT COUNT(DISTINCT installHash) FROM events WHERE installHash IS NOT NULL AND installHash != ''")
            active_7d = self.scalar(db, "SELECT COUNT(DISTINCT COALESCE(NULLIF(installHash, ''), anon)) FROM events WHERE ts >= ?", (since_7d,))
            active_30d = self.scalar(db, "SELECT COUNT(DISTINCT COALESCE(NULLIF(installHash, ''), anon)) FROM events WHERE ts >= ?", (since_30d,))
            last_ts = self.scalar(db, "SELECT MAX(ts) FROM events")
            days = db.execute("SELECT day, COUNT(*), COUNT(DISTINCT anon), COUNT(DISTINCT COALESCE(NULLIF(installHash, ''), anon)) FROM events GROUP BY day ORDER BY day DESC LIMIT 30").fetchall()
            return {
                "ok": True,
                "updatedAt": utc_iso(),
                "totalEvents": total,
                "approxUniqueDailyUsers": unique_daily,
                "approxInstallations": unique_install or unique_daily,
                "active7d": active_7d,
                "active30d": active_30d,
                "lastEventAt": utc_iso(last_ts) if last_ts else None,
                "topModels": self.top(db, "deviceModel"),
                "topBrands": self.top(db, "brand"),
                "topManufacturers": self.top(db, "manufacturer"),
                "topManagers": self.top(db, "manager"),
                "topModuleVersions": self.top(db, "moduleVersion"),
                "topAndroidVersions": self.top(db, "androidVersion"),
                "topSdk": self.top(db, "sdk"),
                "topKernels": self.top(db, "kernelVersion", 8),
                "topRulesVersions": self.top(db, "rulesVersion"),
                "topWebViewVersions": self.top(db, "webviewVersion", 8),
                "topRuleModes": self.top(db, "ruleMode", 8),
                "daily": [{"day": d, "events": c, "approxUniqueDaily": u, "approxActiveInstalls": a} for d, c, u, a in days],
                "privacy": "optional anonymous aggregate telemetry; no personal identifiers, logs, app lists, or config contents are accepted"
            }


class JsonlStore:
    def __init__(self, data_dir, bridge=None):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.bridge = bridge

    def path(self, name):
        return self.data_dir / name

    def append(self, name, payload):
        with self.lock:
            self.append_unlocked(name, payload)

    def append_unlocked(self, name, payload):
        path = self.path(name)
        row = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with path.open("a", encoding="utf-8") as handle:
            handle.write(row + "\n")

    def iter_rows(self, name, limit=MAX_JSONL_LINES_FOR_SUMMARY):
        path = self.path(name)
        if not path.exists():
            return []
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()[-limit:]
        rows = []
        for line in lines:
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
        return rows

    def supporter_redemptions_unlocked(self):
        rows = {}
        for row in self.iter_rows("supporter-redemptions.jsonl"):
            if not isinstance(row, dict):
                continue
            credential_hash = normalize_supporter_hash(row.get("credentialHash"))
            install_hash = clean_text(row.get("installHash"), 96)
            if credential_hash and install_hash:
                rows[credential_hash] = row
        return rows

    def default_supporters(self):
        return {
            "ok": True,
            "version": "v3.9",
            "updatedAt": utc_iso(),
            "items": [
                {
                    "name": "pakhozako",
                    "tier": "??",
                    "badge": "??",
                    "note": "Dex2oat Lock",
                    "order": 1000,
                    "active": True,
                    "expiresAt": 0,
                    "credentialSha256": "",
                    "installHashes": []
                }
            ]
        }

    def load_supporters(self):
        path = self.path("supporters.json")
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        public_path = self.data_dir.parent / "public" / "api" / "supporters.json"
        if public_path.exists():
            try:
                data = json.loads(public_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        return self.default_supporters()

    def public_supporters(self):
        data = self.load_supporters()
        now = utc_now()
        items = []
        for entry in data.get("items") or []:
            if not isinstance(entry, dict):
                continue
            if entry.get("hidden") is True or entry.get("public") is False:
                continue
            public = public_supporter_entry(entry)
            if not public["name"] or public["active"] is False:
                continue
            if public["expiresAt"] and public["expiresAt"] < now:
                continue
            items.append(public)
        items.sort(key=lambda item: (-item.get("order", 0), item.get("name", "")))
        return {
            "ok": True,
            "version": clean_text(data.get("version") or "v3.9", 24),
            "updatedAt": clean_text(data.get("updatedAt") or utc_iso(), 32),
            "items": items,
        }

    def verify_supporter(self, data, client_ip="", user_agent=""):
        if not isinstance(data, dict):
            data = {}
        credential = canonical_supporter_credential(data.get("credential"))
        credential_hash = supporter_credential_digest(credential)
        install_hash = clean_text(data.get("installHash"), 96)
        display_name = clean_text(data.get("displayName"), 32)
        directus_item = None
        response = None
        status = 500

        def finish(result, reason="", supporter_id=0, code_id="", reused=False):
            audit = dict(data)
            if credential_hash:
                audit["credentialHash"] = credential_hash
            if code_id:
                audit["codeId"] = code_id
            if reused:
                audit["reused"] = True
            row = supporter_verification_row(audit, result, reason, supporter_id, client_ip, user_agent)
            directus = directus_verification_item(audit, result, reason, supporter_id, client_ip, user_agent) if self.bridge else None
            return row, directus

        with self.lock:
            if len(credential) < 8 or not credential_hash:
                row, directus_item = finish("rejected", "credential_required")
                self.append_unlocked("supporter-verifications.jsonl", row)
                response = {"ok": False, "error": "credential_required", "message": "请填写支持者口令", "directusQueued": bool(self.bridge and self.bridge.enabled)}
                status = 400
            elif not install_hash:
                row, directus_item = finish("rejected", "install_hash_required")
                self.append_unlocked("supporter-verifications.jsonl", row)
                response = {"ok": False, "error": "install_hash_required", "message": "设备标识缺失，无法绑定兑换码", "directusQueued": bool(self.bridge and self.bridge.enabled)}
                status = 400
            else:
                now = utc_now()
                supporters = self.load_supporters().get("items") or []
                redemptions = self.supporter_redemptions_unlocked()
                matched = None
                matched_index = 0
                matched_public = None
                matched_code_id = ""
                for index, entry in enumerate(supporters, start=1):
                    if not isinstance(entry, dict) or entry.get("active") is False:
                        continue
                    expires_at = int(entry.get("expiresAt") or 0)
                    if expires_at and expires_at < now:
                        continue
                    if credential_hash not in supporter_credential_hashes(entry):
                        continue
                    matched = entry
                    matched_index = index
                    matched_public = public_supporter_entry(entry)
                    matched_code_id = clean_text(entry.get("codeId") or entry.get("id") or f"supporter-{index}", 64)
                    break

                if not matched:
                    row, directus_item = finish("rejected", "invalid_credential")
                    self.append_unlocked("supporter-verifications.jsonl", row)
                    response = {"ok": False, "error": "invalid_credential", "message": "支持者口令无效或尚未在服务器登记", "directusQueued": bool(self.bridge and self.bridge.enabled)}
                    status = 403
                elif not supporter_install_allowed(matched, install_hash):
                    row, directus_item = finish("rejected", "device_not_allowed", matched_index, matched_code_id)
                    self.append_unlocked("supporter-verifications.jsonl", row)
                    response = {"ok": False, "error": "device_not_allowed", "message": "该支持者口令不允许在当前设备启用", "directusQueued": bool(self.bridge and self.bridge.enabled)}
                    status = 403
                else:
                    redeemed = redemptions.get(credential_hash)
                    redeemed_install = clean_text(redeemed.get("installHash") if isinstance(redeemed, dict) else "", 96)
                    if redeemed_install and redeemed_install != install_hash:
                        row, directus_item = finish("rejected", "code_used", matched_index, matched_code_id)
                        self.append_unlocked("supporter-verifications.jsonl", row)
                        response = {"ok": False, "error": "code_used", "message": "该兑换码已绑定其他设备", "directusQueued": bool(self.bridge and self.bridge.enabled)}
                        status = 403
                    else:
                        reused = redeemed_install == install_hash
                        if not reused:
                            self.append_unlocked("supporter-redemptions.jsonl", {
                                "ts": now,
                                "at": utc_iso(now),
                                "credentialHash": credential_hash,
                                "codeId": matched_code_id,
                                "supporterId": matched_index,
                                "installHash": install_hash,
                                "moduleVersion": clean_text(data.get("moduleVersion"), 32),
                                "versionCode": int(data.get("versionCode") or 0),
                                "deviceModel": clean_text(data.get("deviceModel"), 120),
                                "androidVersion": clean_text(data.get("androidVersion"), 40),
                                "manager": clean_text(data.get("manager"), 80),
                                "remoteIpHash": sha256_hex(client_ip) if client_ip else "",
                                "userAgent": clean_text(user_agent, 240),
                            })
                        row, directus_item = finish("accepted", "reused" if reused else "", matched_index, matched_code_id, reused)
                        self.append_unlocked("supporter-verifications.jsonl", row)
                        public = matched_public or public_supporter_entry(matched)
                        name = public["name"] or display_name or "支持者"
                        skin_ids = supporter_skin_ids(matched)
                        response = {
                            "ok": True,
                            "name": name,
                            "tier": public["tier"],
                            "badge": public["badge"] or "纪念版",
                            "note": public["note"],
                            "codeId": matched_code_id,
                            "skinId": skin_ids[0] if len(skin_ids) == 1 else "",
                            "skinIds": skin_ids,
                            "expiresAt": public["expiresAt"],
                            "verifiedAt": int(time.time() * 1000),
                            "reused": reused,
                            "server": "dex2oat-cloud",
                            "directusQueued": bool(self.bridge and self.bridge.enabled),
                        }
                        status = 200

        if directus_item and self.bridge:
            self.bridge.mirror_async("dex2oat_supporter_verifications", directus_item)
        return response, status

    def add_feature_usage(self, data, client_ip):
        payload = normalize_payload(data)
        name = clean_text(data.get("feature"), 64)
        action = clean_text(data.get("action"), 64)
        if not name or SENSITIVE_RE.search(name) or SENSITIVE_RE.search(action):
            raise ValueError("invalid feature event")
        row = {
            "ts": utc_now(),
            "at": utc_iso(),
            "anon": anonymize(payload, client_ip),
            "feature": name,
            "action": action or "use",
            "moduleVersion": payload.get("moduleVersion", "unknown"),
            "versionCode": payload.get("versionCode"),
            "androidVersion": payload.get("androidVersion", ""),
            "sdk": payload.get("sdk"),
            "brand": payload.get("brand", ""),
            "deviceModel": payload.get("deviceModel", ""),
            "manager": payload.get("manager", "")
        }
        self.append("feature-usage.jsonl", row)
        return {"ok": True}

    def add_crash_report(self, data, client_ip):
        payload = normalize_payload(data)
        message = clean_text(data.get("message"), 240)
        stack = clean_text(data.get("stack"), 1200)
        context = clean_text(data.get("context"), 80)
        if not message or SENSITIVE_RE.search(message):
            raise ValueError("invalid crash report")
        row = {
            "ts": utc_now(),
            "at": utc_iso(),
            "anon": anonymize(payload, client_ip),
            "context": context,
            "message": message,
            "stack": "" if SENSITIVE_RE.search(stack) else stack,
            "moduleVersion": payload.get("moduleVersion", "unknown"),
            "versionCode": payload.get("versionCode"),
            "androidVersion": payload.get("androidVersion", ""),
            "sdk": payload.get("sdk"),
            "brand": payload.get("brand", ""),
            "deviceModel": payload.get("deviceModel", ""),
            "manager": payload.get("manager", "")
        }
        self.append("crash-reports.jsonl", row)
        return {"ok": True}

    def add_feedback(self, data, client_ip):
        payload = normalize_payload(data)
        title = clean_text(data.get("title"), 160)
        steps = clean_text(data.get("steps"), 4000)
        expected = clean_text(data.get("expected"), 2000)
        actual = clean_text(data.get("actual"), 2000)
        if not title or SENSITIVE_RE.search(title):
            raise ValueError("invalid feedback")
        row = {
            "ts": utc_now(),
            "at": utc_iso(),
            "anon": anonymize(payload, client_ip),
            "title": title,
            "category": clean_text(data.get("category"), 40),
            "severity": clean_text(data.get("severity"), 40),
            "moduleVersion": payload.get("moduleVersion", "unknown"),
            "versionCode": payload.get("versionCode"),
            "installHash": payload.get("installHash", ""),
            "androidVersion": payload.get("androidVersion", ""),
            "sdk": payload.get("sdk"),
            "brand": payload.get("brand", ""),
            "manufacturer": payload.get("manufacturer", ""),
            "deviceModel": payload.get("deviceModel", ""),
            "manager": payload.get("manager", ""),
            "steps": steps,
            "expected": expected,
            "actual": actual,
            "diagnosticsIncluded": bool(data.get("includeDiagnostics")),
            "configIncluded": bool(data.get("includeConfig")),
        }
        self.append("feedback-submissions.jsonl", row)
        if self.bridge:
            self.bridge.mirror_async("dex2oat_feedback_submissions", directus_feedback_item(row))
        return {"ok": True, "directusQueued": bool(self.bridge and self.bridge.enabled)}

    def add_rule_evidence(self, data, client_ip):
        payload = normalize_payload(data)
        props = normalize_rule_props(data.get("capturedProps"))
        if not props:
            raise ValueError("no accepted rule props")
        enabled_props = normalize_prop_list(data.get("enabledProps"))
        row = {
            "ts": utc_now(),
            "at": utc_iso(),
            "anon": anonymize(payload, client_ip),
            "installHash": payload.get("installHash", ""),
            "moduleVersion": payload.get("moduleVersion", "unknown"),
            "versionCode": payload.get("versionCode"),
            "rulesVersion": payload.get("rulesVersion", ""),
            "schemaVersion": int(data.get("schemaVersion") or 0),
            "androidVersion": payload.get("androidVersion", ""),
            "sdk": payload.get("sdk"),
            "brand": payload.get("brand", ""),
            "manufacturer": payload.get("manufacturer", ""),
            "deviceModel": payload.get("deviceModel", ""),
            "manager": payload.get("manager", ""),
            "kernelVersion": payload.get("kernelVersion", ""),
            "ruleMode": payload.get("ruleMode", ""),
            "matchedTotal": int(data.get("matchedTotal") or 0),
            "propCount": int(data.get("propCount") or 0),
            "configStatus": clean_text(data.get("configStatus"), 32),
            "matchStatus": clean_text(data.get("matchStatus"), 32),
            "source": clean_text(data.get("source"), 48) or "webui",
            "enabledProps": enabled_props,
            "capturedProps": props,
            "capturedTotal": len(props)
        }
        self.append("rule-evidence.jsonl", row)
        if self.bridge:
            self.bridge.mirror_async("dex2oat_rule_evidence", directus_evidence_item(row))
        return {"ok": True, "acceptedProps": len(props), "directusQueued": bool(self.bridge and self.bridge.enabled)}

    def top_from_rows(self, rows, key, limit=12):
        counts = {}
        for row in rows:
            value = row.get(key)
            if value is None or value == "":
                value = "unknown"
            value = str(value)
            counts[value] = counts.get(value, 0) + 1
        return [{"name": key, "count": count} for key, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]

    def evidence_summary(self):
        rows = self.iter_rows("rule-evidence.jsonl")
        prop_counts = {}
        latest_ts = 0
        total_props = 0
        for row in rows:
            latest_ts = max(latest_ts, int(row.get("ts") or 0))
            props = row.get("capturedProps") if isinstance(row.get("capturedProps"), dict) else {}
            total_props += len(props)
            for prop in props:
                prop_counts[prop] = prop_counts.get(prop, 0) + 1
        top_props = [{"name": key, "count": count} for key, count in sorted(prop_counts.items(), key=lambda item: (-item[1], item[0]))[:24]]
        return {
            "ok": True,
            "updatedAt": utc_iso(),
            "reports": len(rows),
            "totalAcceptedProps": total_props,
            "lastReportAt": utc_iso(latest_ts) if latest_ts else None,
            "topProps": top_props,
            "topModels": self.top_from_rows(rows, "deviceModel"),
            "topBrands": self.top_from_rows(rows, "brand"),
            "topAndroidVersions": self.top_from_rows(rows, "androidVersion"),
            "topSdk": self.top_from_rows(rows, "sdk"),
            "topManagers": self.top_from_rows(rows, "manager"),
            "topKernels": self.top_from_rows(rows, "kernelVersion", 8),
            "topRulesVersions": self.top_from_rows(rows, "rulesVersion", 8),
            "privacy": "manual opt-in rule evidence; allowlisted ART/dexopt/ROM properties only; sensitive keys and values are dropped"
        }


class RateLimiter:
    def __init__(self):
        self.lock = threading.Lock()
        self.hits = defaultdict(deque)

    def allow(self, key, limit):
        now = time.monotonic()
        cutoff = now - RATE_WINDOW_SECONDS
        with self.lock:
            queue = self.hits[key]
            while queue and queue[0] < cutoff:
                queue.popleft()
            if len(queue) >= limit:
                return False
            queue.append(now)
            return True


class Handler(SimpleHTTPRequestHandler):
    server_version = "Dex2oatCloud/1.3"
    store = None
    jsonl = None
    bridge = None
    limiter = RateLimiter()
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".zip": "application/zip",
    }

    def list_directory(self, path):
        self.send_error(403, "Directory listing disabled")
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        path = urlparse(getattr(self, "path", "")).path
        if path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "public, max-age=60")
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json(self, max_body):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > max_body:
            raise ValueError("invalid_size")
        content_type = self.headers.get("Content-Type", "")
        if "application/json" not in content_type.lower():
            raise ValueError("invalid_content_type")
        raw = self.rfile.read(length)
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("payload must be object")
        return data

    def client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return clean_text(forwarded.split(",")[0], 64)
        return self.client_address[0]

    def check_rate_limit(self, bucket, limit):
        key = f"{self.client_ip()}:{bucket}"
        if self.limiter.allow(key, limit):
            return True
        self.send_json({"ok": False, "error": "rate_limited"}, 429)
        return False

    def do_OPTIONS(self):
        if not self.check_rate_limit("OPTIONS", 120):
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if not self.check_rate_limit("GET", RATE_LIMITS["GET"]):
            return
        path = urlparse(self.path).path
        if path == "/api/usage-summary.json":
            return self.send_json(self.store.summary())
        if path == "/api/evidence-summary.json":
            return self.send_json(self.jsonl.evidence_summary())
        if path == "/api/supporters.json":
            return self.send_json(self.jsonl.public_supporters())
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        limit = RATE_LIMITS.get(path, RATE_LIMITS["POST"])
        if not self.check_rate_limit(path, limit):
            return
        try:
            if path == "/api/telemetry":
                data = self.read_json(MAX_TELEMETRY_BODY)
                payload = normalize_payload(data)
                return self.send_json(self.store.add(payload, self.client_ip()))
            if path == "/api/feature-usage":
                data = self.read_json(MAX_EVENT_BODY)
                return self.send_json(self.jsonl.add_feature_usage(data, self.client_ip()))
            if path == "/api/crash-report":
                data = self.read_json(MAX_EVENT_BODY)
                return self.send_json(self.jsonl.add_crash_report(data, self.client_ip()))
            if path == "/api/feedback":
                data = self.read_json(MAX_FEEDBACK_BODY)
                return self.send_json(self.jsonl.add_feedback(data, self.client_ip()))
            if path == "/api/rule-evidence":
                data = self.read_json(MAX_EVIDENCE_BODY)
                return self.send_json(self.jsonl.add_rule_evidence(data, self.client_ip()))
            if path == "/api/supporter/verify":
                data = self.read_json(MAX_SUPPORTER_BODY)
                payload, status = self.jsonl.verify_supporter(
                    data,
                    self.client_ip(),
                    self.headers.get("User-Agent", ""),
                )
                return self.send_json(payload, status)
            return self.send_json({"ok": False, "error": "not_found"}, 404)
        except ValueError as exc:
            status = 413 if str(exc) == "invalid_size" else 400
            return self.send_json({"ok": False, "error": str(exc)[:80]}, status)
        except Exception as exc:
            return self.send_json({"ok": False, "error": "invalid_payload", "message": str(exc)[:120]}, 400)

    def log_message(self, fmt, *args):
        print("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), fmt % args), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--panel-dir", default=os.environ.get("DEX2OAT_PANEL_DIR") or "")
    args = parser.parse_args()
    root = Path(args.directory).resolve()
    if not root.is_dir():
        raise SystemExit(f"missing directory: {root}")
    data_dir = Path(args.db).resolve().parent
    panel_dir = args.panel_dir or str(data_dir.parent / "panel")
    Handler.bridge = DirectusBridge(panel_dir)
    Handler.store = TelemetryStore(args.db, Handler.bridge)
    Handler.jsonl = JsonlStore(data_dir, Handler.bridge)
    handler = functools.partial(Handler, directory=str(root))
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"serving {root} on {args.host}:{args.port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
