#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy a built Dex2oat-Lock release to the managed cloud mirror.

This tool intentionally avoids storing credentials. Set DEX2OAT_CLOUD_PASSWORD
or use SSH key authentication before running it.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "tools" / "version.json"
RELEASE_DIR = ROOT / "releases"
CLOUD_SERVER_FILE = ROOT / "deploy" / "cloud" / "dex2oat_cloud_server.py"
PRIVATE_SUPPORTERS_FILE = ROOT / "deploy" / "cloud" / "supporters.private.json"
DEFAULT_BASE_DIR = "/root/codex-managed/dex2oat-lock"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def read_sha256(path: Path) -> str:
    return path.read_text(encoding="utf-8").split()[0]


def local_release_expectation(version: dict) -> dict | None:
    label = version["version"]
    zip_name = f"Dex2oat-Lock-{label}-release.zip"
    zip_path = RELEASE_DIR / zip_name
    sha_path = RELEASE_DIR / f"Dex2oat-Lock-{label}-release.sha256"
    manifest_path = RELEASE_DIR / f"Dex2oat-Lock-{label}-manifest.json"
    if not zip_path.exists() or not sha_path.exists() or not manifest_path.exists():
        return None
    return {
        "version": label,
        "versionCode": int(version["versionCode"]),
        "sha256": read_sha256(sha_path),
        "size": zip_path.stat().st_size,
        "zipName": zip_name,
    }


def compare_remote_release(name: str, remote: dict | None, expected: dict) -> list[str]:
    if not isinstance(remote, dict):
        return [f"{name} is missing or not an object"]
    mismatches = []
    for key in ("version", "versionCode", "sha256", "size"):
        if remote.get(key) != expected[key]:
            mismatches.append(f"{name}.{key}={remote.get(key)!r} != {expected[key]!r}")
    if expected["zipName"] not in str(remote.get("zipUrl", "")):
        mismatches.append(f"{name}.zipUrl does not point to {expected['zipName']}")
    return mismatches


def atomic_write_text(sftp, remote_path: str, text: str) -> None:
    tmp_path = f"{remote_path}.tmp-{os.getpid()}"
    with sftp.file(tmp_path, "wb") as handle:
        handle.write(text.encode("utf-8"))
    try:
        sftp.remove(remote_path)
    except OSError:
        pass
    sftp.rename(tmp_path, remote_path)


def atomic_put(sftp, local_path: Path, remote_path: str) -> None:
    tmp_path = f"{remote_path}.tmp-{os.getpid()}"
    sftp.put(str(local_path), tmp_path)
    try:
        sftp.remove(remote_path)
    except OSError:
        pass
    sftp.rename(tmp_path, remote_path)


def ssh_run(client, command: str, timeout: int = 30) -> str:
    _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if code:
        raise RuntimeError(f"remote command failed ({code}): {command}\n{out}\n{err}")
    return out.strip()


def make_release_entry(version: dict, http_base: str, sha256: str, size: int, updated_at: str) -> dict:
    label = version["version"]
    zip_name = f"Dex2oat-Lock-{label}-release.zip"
    return {
        "version": label,
        "versionCode": int(version["versionCode"]),
        "zipUrl": f"{http_base.rstrip('/')}/files/{zip_name}",
        "githubZipUrl": version.get("zipUrl", ""),
        "sha256": sha256,
        "size": size,
        "changelog": version.get("changelog", ""),
        "updatedAt": updated_at,
    }


def make_supporters_payload(version: dict, updated_at: str) -> dict:
    return {
        "ok": True,
        "version": version.get("version", "v0"),
        "versionCode": int(version.get("versionCode") or 0),
        "updatedAt": updated_at,
        "items": [
            {
                "name": "pakhozako",
                "tier": "作者",
                "badge": "作者",
                "note": "Dex2oat Lock",
                "order": 100,
                "active": True,
                "expiresAt": 0
            }
        ]
    }


def load_private_supporters() -> dict | None:
    if not PRIVATE_SUPPORTERS_FILE.exists():
        return None
    data = load_json(PRIVATE_SUPPORTERS_FILE)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise SystemExit(f"Invalid private supporters file: {PRIVATE_SUPPORTERS_FILE}")
    return data


def run_local_preflight(args) -> dict:
    if args.skip_local_preflight:
        return {"skipped": True, "reason": "explicit --skip-local-preflight"}
    node = os.environ.get("DEX2OAT_NODE") or "node"
    result = subprocess.run(
        [node, "tools/validate.js"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=360,
    )
    if result.returncode != 0:
        detail = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
        raise SystemExit(f"Local release preflight failed. Run `node tools\\validate.js` locally for details.\n{detail}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {}
    return {
        "skipped": False,
        "releaseSha256": (data.get("releaseManifest") or {}).get("sha256", ""),
        "sourceSha256": (data.get("sourceManifest") or {}).get("sha256", ""),
        "webuiSmoke": bool(data.get("webuiSmoke")),
    }


def require_paramiko():
    try:
        import paramiko  # type: ignore
    except Exception as error:  # pragma: no cover - local tool guidance
        raise SystemExit(
            "Missing Python dependency: paramiko. Install it with `python -m pip install --user paramiko`."
        ) from error
    return paramiko


def connect(args):
    paramiko = require_paramiko()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs = {
        "hostname": args.host,
        "port": args.port,
        "username": args.user,
        "timeout": 12,
        "banner_timeout": 12,
        "auth_timeout": 12,
        "look_for_keys": True,
        "allow_agent": True,
    }
    password = os.environ.get(args.password_env, "")
    if password:
        kwargs["password"] = password
        kwargs["look_for_keys"] = False
        kwargs["allow_agent"] = False
    if args.key:
        kwargs["key_filename"] = args.key
    client.connect(**kwargs)
    return client


def deploy(args) -> dict:
    local_preflight = run_local_preflight(args)
    version = load_json(VERSION_FILE)
    label = version["version"]
    zip_name = f"Dex2oat-Lock-{label}-release.zip"
    manifest_name = f"Dex2oat-Lock-{label}-manifest.json"
    zip_path = RELEASE_DIR / zip_name
    sha_path = RELEASE_DIR / f"Dex2oat-Lock-{label}-release.sha256"
    manifest_path = RELEASE_DIR / manifest_name
    if not zip_path.exists() or not sha_path.exists() or not manifest_path.exists():
        raise SystemExit(f"Missing release files for {label}. Run `node tools\\build.js` first.")

    sha256 = read_sha256(sha_path)
    size = zip_path.stat().st_size
    updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    http_base = args.http_base or version.get("cloudBaseUrl") or f"http://{args.host}:18082"
    entry = make_release_entry(version, http_base, sha256, size, updated_at)
    rules_version = version.get("rulesVersion") or label
    rules = {
        "ok": True,
        "rulesVersion": rules_version,
        "schemaVersion": version.get("schemaVersion", 0),
        "updatedAt": updated_at,
        "note": "Cloud rule metadata endpoint is reserved; module release embeds protected rule data.",
    }
    supporters = make_supporters_payload(version, updated_at)
    private_supporters = load_private_supporters()
    health = {
        "ok": True,
        "service": "dex2oat-cloud",
        "version": label,
        "updatedAt": updated_at,
    }

    base = args.base_dir.rstrip("/")
    public_dir = posixpath.join(base, "public")
    api_dir = posixpath.join(public_dir, "api")
    data_dir = posixpath.join(base, "data")
    scripts_dir = posixpath.join(base, "scripts")
    files_dir = posixpath.join(public_dir, "files")
    backup_dir = posixpath.join(base, "backups", f"deploy-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}")

    client = connect(args)
    try:
        if ssh_run(client, f"test -d {shell_quote(base)} && echo yes || echo no") != "yes":
            raise RuntimeError(f"managed base directory does not exist: {base}")
        ssh_run(client, f"mkdir -p {shell_quote(api_dir)} {shell_quote(files_dir)} {shell_quote(data_dir)} {shell_quote(scripts_dir)} {shell_quote(backup_dir)}")
        backup_cmd = (
            f"for f in {shell_quote(public_dir)}/health.json "
            f"{shell_quote(public_dir)}/update.json {shell_quote(public_dir)}/releases.json "
            f"{shell_quote(api_dir)}/update.json {shell_quote(api_dir)}/releases.json {shell_quote(api_dir)}/rules.json "
            f"{shell_quote(data_dir)}/supporters.json {shell_quote(scripts_dir)}/dex2oat_cloud_server.py; "
            f"do [ -f \"$f\" ] && cp -p \"$f\" {shell_quote(backup_dir)}/ || true; done"
        )
        ssh_run(client, backup_cmd)
        sftp = client.open_sftp()
        try:
            atomic_put(sftp, zip_path, posixpath.join(files_dir, zip_name))
            atomic_put(sftp, manifest_path, posixpath.join(files_dir, manifest_name))
            current_items = []
            try:
                with sftp.file(posixpath.join(api_dir, "releases.json"), "r") as handle:
                    current_items = json.loads(handle.read().decode("utf-8", "replace")).get("items") or []
            except Exception:
                current_items = []
            releases = {
                "ok": True,
                "latest": entry,
                "items": [entry] + [item for item in current_items if item.get("version") != label],
                "updatedAt": updated_at,
            }
            for prefix in (public_dir, api_dir):
                atomic_write_text(sftp, posixpath.join(prefix, "update.json"), json.dumps(entry, ensure_ascii=False, indent=2) + "\n")
                atomic_write_text(sftp, posixpath.join(prefix, "releases.json"), json.dumps(releases, ensure_ascii=False, indent=2) + "\n")
            atomic_write_text(sftp, posixpath.join(api_dir, "rules.json"), json.dumps(rules, ensure_ascii=False, indent=2) + "\n")
            atomic_write_text(sftp, posixpath.join(api_dir, "supporters.json"), json.dumps(supporters, ensure_ascii=False, indent=2) + "\n")
            if private_supporters:
                atomic_write_text(sftp, posixpath.join(data_dir, "supporters.json"), json.dumps(private_supporters, ensure_ascii=False, indent=2) + "\n")
            if CLOUD_SERVER_FILE.exists():
                atomic_put(sftp, CLOUD_SERVER_FILE, posixpath.join(scripts_dir, "dex2oat_cloud_server.py"))
            atomic_write_text(sftp, posixpath.join(public_dir, "health.json"), json.dumps(health, ensure_ascii=False, indent=2) + "\n")
        finally:
            sftp.close()

        chmod_targets = [
            posixpath.join(public_dir, "health.json"),
            posixpath.join(public_dir, "update.json"),
            posixpath.join(public_dir, "releases.json"),
            posixpath.join(api_dir, "update.json"),
            posixpath.join(api_dir, "releases.json"),
            posixpath.join(api_dir, "rules.json"),
            posixpath.join(api_dir, "supporters.json"),
            posixpath.join(files_dir, zip_name),
            posixpath.join(files_dir, manifest_name),
        ]
        ssh_run(client, "chmod 0644 " + " ".join(shell_quote(item) for item in chmod_targets))
        if private_supporters:
            ssh_run(client, f"chmod 0600 {shell_quote(posixpath.join(data_dir, 'supporters.json'))}")
        if CLOUD_SERVER_FILE.exists():
            ssh_run(client, f"chmod 0644 {shell_quote(posixpath.join(scripts_dir, 'dex2oat_cloud_server.py'))}")
        cleanup_pages = ["index.html", "admin.html", "usage.html"]
        ssh_run(
            client,
            "rm -f " + " ".join(shell_quote(posixpath.join(public_dir, name)) for name in cleanup_pages),
            timeout=20,
        )
        remote_sha = ssh_run(client, f"sha256sum {shell_quote(posixpath.join(files_dir, zip_name))} | awk '{{print $1}}'")
        if CLOUD_SERVER_FILE.exists():
            ssh_run(client, "systemctl restart dex2oat-cloud.service", timeout=30)
            time.sleep(1)
        service_state = ssh_run(client, "systemctl is-active dex2oat-cloud.service 2>/dev/null || true")
        if remote_sha != sha256:
            raise RuntimeError(f"remote sha mismatch: {remote_sha} != {sha256}")
    finally:
        client.close()

    if not args.skip_http_verify:
        update = http_json(f"{http_base.rstrip('/')}/api/update.json")
        if update.get("version") != label or update.get("sha256") != sha256:
            raise RuntimeError(
                "HTTP update endpoint did not return the deployed release "
                f"(expected version={label} sha256={sha256}, got version={update.get('version')} sha256={update.get('sha256')})"
            )

    return {
        "deployed": True,
        "version": label,
        "versionCode": version["versionCode"],
        "sha256": sha256,
        "bytes": size,
        "httpBase": http_base,
        "backup": backup_dir,
        "service": service_state,
        "cloudServerUploaded": CLOUD_SERVER_FILE.exists(),
        "privateSupportersUploaded": bool(private_supporters),
        "localPreflight": local_preflight,
    }


def http_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def validate_public_supporters(data: dict, version: dict) -> dict:
    if not isinstance(data, dict) or not data.get("ok"):
        raise RuntimeError("Public supporters directory is not ok")
    if data.get("version") != version.get("version"):
        raise RuntimeError(f"Public supporters directory version {data.get('version')} != {version.get('version')}")
    warnings = []
    if data.get("versionCode") is None:
        warnings.append("public supporters directory has no versionCode; next deploy will add it")
    elif int(data.get("versionCode") or 0) != int(version.get("versionCode") or 0):
        raise RuntimeError(
            "Public supporters directory versionCode "
            f"{data.get('versionCode')} != {version.get('versionCode')}"
        )

    items = data.get("items") or []
    if not isinstance(items, list):
        raise RuntimeError("Public supporters directory items is not a list")
    forbidden_keys = {"hash", "sha256", "credential", "credentialHash", "code", "secret"}
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise RuntimeError(f"Public supporters item {index} is not an object")
        leaked = sorted(forbidden_keys.intersection(item))
        if leaked:
            raise RuntimeError(f"Public supporters item {index} leaks private fields: {', '.join(leaked)}")
    return {
        "version": data.get("version"),
        "versionCode": int(data.get("versionCode") or 0) if data.get("versionCode") is not None else None,
        "items": len(items),
        "warnings": warnings,
    }


def check(args) -> dict:
    version = load_json(VERSION_FILE)
    http_base = args.http_base or version.get("cloudBaseUrl") or f"http://{args.host}:18082"
    update = http_json(f"{http_base.rstrip('/')}/api/update.json")
    releases = http_json(f"{http_base.rstrip('/')}/api/releases.json")
    health = http_json(f"{http_base.rstrip('/')}/health.json")
    supporters = http_json(f"{http_base.rstrip('/')}/api/supporters.json")
    supporters_check = validate_public_supporters(supporters, version)
    expected = local_release_expectation(version)
    local_compare = {"skipped": True, "reason": "missing local release files"}
    if args.skip_local_compare:
        local_compare = {"skipped": True, "reason": "explicit --skip-local-compare"}
    elif expected:
        mismatches = []
        mismatches.extend(compare_remote_release("update", update, expected))
        mismatches.extend(compare_remote_release("latest", releases.get("latest"), expected))
        if mismatches:
            raise RuntimeError("Cloud release does not match local build:\n" + "\n".join(mismatches))
        local_compare = {
            "skipped": False,
            "version": expected["version"],
            "versionCode": expected["versionCode"],
            "sha256": expected["sha256"],
            "size": expected["size"],
        }
    return {
        "httpBase": http_base,
        "update": update,
        "latest": releases.get("latest"),
        "releaseCount": len(releases.get("items") or []),
        "health": health,
        "supporters": supporters_check,
        "localCompare": local_compare,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy or check the Dex2oat-Lock managed cloud release mirror.")
    parser.add_argument("command", nargs="?", choices=("deploy", "check"), default="deploy")
    parser.add_argument("--host", default=os.environ.get("DEX2OAT_CLOUD_HOST") or "154.219.110.62")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DEX2OAT_CLOUD_SSH_PORT") or "22"))
    parser.add_argument("--user", default=os.environ.get("DEX2OAT_CLOUD_USER") or "root")
    parser.add_argument("--password-env", default="DEX2OAT_CLOUD_PASSWORD")
    parser.add_argument("--key", default=os.environ.get("DEX2OAT_CLOUD_KEY") or "")
    parser.add_argument("--base-dir", default=os.environ.get("DEX2OAT_CLOUD_BASE") or DEFAULT_BASE_DIR)
    parser.add_argument("--http-base", default=os.environ.get("DEX2OAT_CLOUD_HTTP_BASE") or "")
    parser.add_argument("--skip-http-verify", action="store_true")
    parser.add_argument("--skip-local-preflight", action="store_true")
    parser.add_argument("--skip-local-compare", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    result = check(args) if args.command == "check" else deploy(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
