#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run a lightweight Android shell smoke test against the cloud release ZIP.

The tool connects to the managed Android lab host, downloads the published
release ZIP, pushes it to the running AVD, and checks every packaged .sh file
with Android's /system/bin/sh parser. Credentials are read from environment
variables only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "tools" / "version.json"
DEFAULT_ANDROID_ENV = "/opt/dex2oat-android-lab/env.sh"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


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
        "timeout": 20,
        "banner_timeout": 20,
        "auth_timeout": 20,
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


def ssh_run(client, command: str, timeout: int = 120) -> str:
    _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if code:
        raise RuntimeError(f"remote command failed ({code})\nSTDOUT:\n{out}\nSTDERR:\n{err}")
    return out.strip()


def release_url(args) -> str:
    if args.zip_url:
        return args.zip_url
    version = load_json(VERSION_FILE)
    http_base = (args.http_base or version.get("cloudBaseUrl") or "").rstrip("/")
    if not http_base:
        raise SystemExit("Missing cloudBaseUrl in tools/version.json; pass --http-base or --zip-url.")
    return f"{http_base}/files/Dex2oat-Lock-{version['version']}-release.zip"


def run_smoke(args) -> dict:
    zip_url = release_url(args)
    remote = f"""
set -eu
. {shell_quote(args.android_env)}
WORK=/tmp/dex2oat-android-release-smoke
ZIP=$WORK/release.zip
TREE=$WORK/tree
TARGET=/data/local/tmp/dex2oat-release-smoke
rm -rf "$WORK"
mkdir -p "$TREE"
curl -fsSL -o "$ZIP" {shell_quote(zip_url)}
python3 -m zipfile -e "$ZIP" "$TREE"
devices="$(adb devices -l | sed '/^$/d')"
boot="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r' || true)"
sdk="$(adb shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\\r' || true)"
model="$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\\r' || true)"
adb shell rm -rf "$TARGET" >/dev/null 2>&1 || true
adb push "$TREE" "$TARGET" >/dev/null
scripts="$(adb shell 'set -eu; count=0; for f in $(find /data/local/tmp/dex2oat-release-smoke -name "*.sh" | sort); do sh -n "$f"; count=$((count+1)); done; printf "%s" "$count"')"
adb shell rm -rf "$TARGET" >/dev/null 2>&1 || true
rm -rf "$WORK"
printf '%s\\n' "boot_completed=$boot" "sdk=$sdk" "model=$model" "scripts=$scripts"
printf '%s\\n' "devices<<EOF" "$devices" "EOF"
"""
    client = connect(args)
    try:
        output = ssh_run(client, remote, timeout=args.timeout)
    finally:
        client.close()

    result = {"zipUrl": zip_url, "devices": []}
    lines = output.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if line == "devices<<EOF":
            index += 1
            devices = []
            while index < len(lines) and lines[index] != "EOF":
                devices.append(lines[index])
                index += 1
            result["devices"] = devices
        elif "=" in line:
            key, value = line.split("=", 1)
            result[key] = value
        index += 1

    scripts = int(result.get("scripts") or 0)
    if result.get("boot_completed") != "1":
        raise RuntimeError(f"Android lab is not booted: boot_completed={result.get('boot_completed')!r}")
    if scripts < 1:
        raise RuntimeError("Android release smoke did not check any shell scripts")
    result["scripts"] = scripts
    result["ok"] = True
    return result


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Android shell smoke against the published Dex2oat release ZIP.")
    parser.add_argument("--host", default=os.environ.get("DEX2OAT_CLOUD_HOST") or "154.219.110.62")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DEX2OAT_CLOUD_SSH_PORT") or "22"))
    parser.add_argument("--user", default=os.environ.get("DEX2OAT_CLOUD_USER") or "root")
    parser.add_argument("--password-env", default="DEX2OAT_CLOUD_PASSWORD")
    parser.add_argument("--key", default=os.environ.get("DEX2OAT_CLOUD_KEY") or "")
    parser.add_argument("--http-base", default=os.environ.get("DEX2OAT_CLOUD_HTTP_BASE") or "")
    parser.add_argument("--zip-url", default="")
    parser.add_argument("--android-env", default=os.environ.get("DEX2OAT_ANDROID_ENV") or DEFAULT_ANDROID_ENV)
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    print(json.dumps(run_smoke(args), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
