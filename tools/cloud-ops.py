#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Maintenance helper for the managed Dex2oat-Lock cloud workspace.

The tool does not store credentials. Use DEX2OAT_CLOUD_PASSWORD or SSH key
authentication, and only operate inside /root/codex-managed/dex2oat-lock.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "tools" / "version.json"
DEFAULT_BASE_DIR = "/root/codex-managed/dex2oat-lock"


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


def ssh_run(client, command: str, timeout: int = 60) -> tuple[int, str, str]:
    _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    return stdout.channel.recv_exit_status(), out, err


def require_managed_base(client, base_dir: str) -> None:
    code, out, err = ssh_run(client, f"test -d {shell_quote(base_dir)} && pwd", timeout=20)
    if code != 0:
        raise RuntimeError(f"managed base directory is not available: {base_dir}\n{out}{err}")


def remote_command(args, body: str, timeout: int = 60) -> str:
    client = connect(args)
    try:
        require_managed_base(client, args.base_dir)
        command = f"set -eu\nBASE={shell_quote(args.base_dir)}\nexport BASE\ncd \"$BASE\"\n{body}"
        code, out, err = ssh_run(client, command, timeout=timeout)
        if code != 0:
            raise RuntimeError(f"remote command failed ({code})\n{out}{err}")
        return out
    finally:
        client.close()


def command_status(args) -> dict:
    script = r"""
python3 - <<'PY'
import json, os, shutil, subprocess
base = os.environ.get("BASE", ".")
def cmd(args):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.strip()
def active(name):
    output = cmd(["systemctl", "is-active", name])
    return output.splitlines()[0] if output else "unknown"
def endpoint(path):
    result = subprocess.run(["curl", "-fsS", "http://127.0.0.1:18080" + path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0
disk = shutil.disk_usage(base)
data = {
  "base": os.path.abspath(base),
  "services": {
    "dex2oat-cloud.service": active("dex2oat-cloud.service"),
    "dex2oat-admin.service": active("dex2oat-admin.service"),
    "dex2oat-cloud-backup.timer": active("dex2oat-cloud-backup.timer"),
    "dex2oat-cloud-health.timer": active("dex2oat-cloud-health.timer")
  },
  "disk": {
    "total": disk.total,
    "used": disk.used,
    "free": disk.free,
    "percent": round((disk.used / disk.total) * 100, 2) if disk.total else 0
  },
  "publicUsagePanel": os.path.exists(os.path.join(base, "public", "usage.html")),
  "healthLog": os.path.exists(os.path.join(base, "logs", "health-check.latest.txt")),
  "backupLog": os.path.exists(os.path.join(base, "logs", "backup.latest.txt")),
  "endpoints": {
    "/health.json": endpoint("/health.json"),
    "/api/update.json": endpoint("/api/update.json"),
    "/api/releases.json": endpoint("/api/releases.json"),
    "/api/rules.json": endpoint("/api/rules.json"),
    "/api/evidence-summary.json": endpoint("/api/evidence-summary.json")
  },
}
for name in ("public/api/update.json", "public/api/releases.json", "public/api/rules.json"):
    data[name] = os.path.exists(os.path.join(base, name))
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
"""
    return json.loads(remote_command(args, script, timeout=60))


def command_health(args) -> str:
    return remote_command(args, '"$BASE/scripts/health-check.sh"\ncat "$BASE/logs/health-check.latest.txt"', timeout=90)


def command_logs(args) -> str:
    lines = max(20, min(args.lines, 400))
    script = f"""
printf '%s\\n' '--- health-check.latest.txt ---'
tail -n {lines} "$BASE/logs/health-check.latest.txt" 2>/dev/null || true
printf '%s\\n' '--- backup.latest.txt ---'
tail -n {lines} "$BASE/logs/backup.latest.txt" 2>/dev/null || true
printf '%s\\n' '--- service journal ---'
journalctl -u dex2oat-cloud.service -u dex2oat-admin.service --no-pager -n {lines} 2>/dev/null || true
"""
    return remote_command(args, script, timeout=90)


def command_backups(args) -> str:
    script = r"""
printf '%s\n' '--- backups ---'
find "$BASE/backups" -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %9s %p\n' 2>/dev/null | sort | tail -60
printf '%s\n' '--- releases ---'
find "$BASE/public/files" "$BASE/releases" -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %9s %p\n' 2>/dev/null | sort | tail -60
"""
    return remote_command(args, script, timeout=60)


def command_inventory(args) -> str:
    script = r"""
printf '%s\n' '--- tree ---'
find "$BASE" -maxdepth 2 -type f | sort | sed "s#$BASE/##" | head -160
printf '%s\n' '--- scripts ---'
ls -l "$BASE/scripts"
printf '%s\n' '--- ports ---'
ss -ltnp 2>/dev/null | grep -E ':(18080|18081)\b' || true
printf '%s\n' '--- resources ---'
df -h "$BASE"
free -h
"""
    return remote_command(args, script, timeout=90)


def command_worker(args) -> str:
    script = r"""
printf '%s\n' '--- worker dirs ---'
mkdir -p "$BASE/worker/jobs" "$BASE/worker/logs" "$BASE/worker/artifacts" "$BASE/worker/repos"
find "$BASE/worker" -maxdepth 2 -type d | sort
printf '%s\n' '--- latest worker logs ---'
find "$BASE/worker/logs" -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %9s %p\n' 2>/dev/null | sort | tail -30
printf '%s\n' '--- worker env ---'
"$BASE/scripts/run-worker-task.sh" worker-env-check sh -lc '. "$0"; node -v; npm -v; python3 --version; git --version; df -h "$DEX2OAT_WORKER"' "$BASE/scripts/remote-env.sh" 2>/dev/null || true
tail -n 80 "$BASE/worker/logs"/worker-env-check-*.log 2>/dev/null | tail -80 || true
"""
    return remote_command(args, script, timeout=90)


def command_worker_selfcheck(args) -> str:
    script = r"""
mkdir -p "$BASE/worker/jobs" "$BASE/worker/logs" "$BASE/worker/artifacts" "$BASE/worker/repos"
"$BASE/scripts/run-worker-task.sh" worker-selfcheck sh -lc '. "$0"; node -v; npm -v; python3 --version; git --version; free -h; df -h "$DEX2OAT_WORKER"' "$BASE/scripts/remote-env.sh"
tail -n 120 "$BASE/worker/logs"/worker-selfcheck-*.log 2>/dev/null | tail -120
"""
    return remote_command(args, script, timeout=90)


def parse_args(argv: list[str]) -> argparse.Namespace:
    version = load_json(VERSION_FILE)
    parser = argparse.ArgumentParser(description="Inspect the managed Dex2oat-Lock cloud workspace.")
    parser.add_argument("command", choices=("status", "health", "logs", "backups", "inventory", "worker", "worker-selfcheck"), nargs="?", default="status")
    parser.add_argument("--host", default=os.environ.get("DEX2OAT_CLOUD_HOST") or "154.219.110.62")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DEX2OAT_CLOUD_SSH_PORT") or "22"))
    parser.add_argument("--user", default=os.environ.get("DEX2OAT_CLOUD_USER") or "root")
    parser.add_argument("--password-env", default="DEX2OAT_CLOUD_PASSWORD")
    parser.add_argument("--key", default=os.environ.get("DEX2OAT_CLOUD_KEY") or "")
    parser.add_argument("--base-dir", default=os.environ.get("DEX2OAT_CLOUD_BASE") or DEFAULT_BASE_DIR)
    parser.add_argument("--http-base", default=os.environ.get("DEX2OAT_CLOUD_HTTP_BASE") or version.get("cloudBaseUrl") or "")
    parser.add_argument("--lines", type=int, default=80)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.command == "status":
        print(json.dumps(command_status(args), ensure_ascii=False, indent=2))
    elif args.command == "health":
        print(command_health(args), end="")
    elif args.command == "logs":
        print(command_logs(args), end="")
    elif args.command == "backups":
        print(command_backups(args), end="")
    elif args.command == "inventory":
        print(command_inventory(args), end="")
    elif args.command == "worker":
        print(command_worker(args), end="")
    elif args.command == "worker-selfcheck":
        print(command_worker_selfcheck(args), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
