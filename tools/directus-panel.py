#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy and inspect the Dex2oat-Lock Directus business panel.

The tool only operates inside /root/codex-managed/dex2oat-lock/panel and never
stores local credentials. Use DEX2OAT_CLOUD_PASSWORD or SSH key authentication.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import secrets
import string
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PANEL_SOURCE = ROOT / "deploy" / "directus"
DEFAULT_BASE_DIR = "/root/codex-managed/dex2oat-lock"
DEFAULT_PANEL_PORT = 18083
DEFAULT_DIRECTUS_IMAGE = "ghcr.io/directus/directus:12.0.2"
DEFAULT_POSTGRES_IMAGE = "m.daocloud.io/docker.io/library/postgres:16-alpine"
DEFAULT_ADMIN_EMAIL = "admin@dex2oat.example.com"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


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


def checked_run(client, command: str, timeout: int = 60) -> str:
    code, out, err = ssh_run(client, command, timeout=timeout)
    if code != 0:
        raise RuntimeError(f"remote command failed ({code})\n{out}{err}")
    return out


def require_managed_base(client, base_dir: str) -> None:
    command = f"test -d {shell_quote(base_dir)} && test -w {shell_quote(base_dir)}"
    code, out, err = ssh_run(client, command, timeout=20)
    if code != 0:
        raise RuntimeError(f"managed base directory is not writable: {base_dir}\n{out}{err}")


def ensure_remote_dir(sftp, remote_path: str) -> None:
    parts = [part for part in remote_path.split("/") if part]
    current = ""
    for part in parts:
        current += "/" + part
        try:
            sftp.stat(current)
        except OSError:
            sftp.mkdir(current)


def upload_tree(sftp, local_dir: Path, remote_dir: str) -> list[str]:
    uploaded: list[str] = []
    ensure_remote_dir(sftp, remote_dir)
    for local_path in sorted(local_dir.rglob("*")):
        rel = local_path.relative_to(local_dir).as_posix()
        if rel.startswith("data/") or "__pycache__/" in rel or rel in {".env"}:
            continue
        remote_path = posixpath.join(remote_dir, rel)
        if local_path.is_dir():
            ensure_remote_dir(sftp, remote_path)
            continue
        ensure_remote_dir(sftp, posixpath.dirname(remote_path))
        tmp_path = f"{remote_path}.tmp-{os.getpid()}"
        sftp.put(str(local_path), tmp_path)
        try:
            sftp.remove(remote_path)
        except OSError:
            pass
        sftp.rename(tmp_path, remote_path)
        uploaded.append(rel)
    return uploaded


def random_secret(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def make_env(args) -> str:
    public_url = args.public_url or f"http://127.0.0.1:{args.panel_port}"
    admin_email = args.admin_email or DEFAULT_ADMIN_EMAIL
    return "\n".join([
        f"DIRECTUS_IMAGE={DEFAULT_DIRECTUS_IMAGE}",
        f"POSTGRES_IMAGE={DEFAULT_POSTGRES_IMAGE}",
        f"DEX2OAT_PANEL_BIND={args.panel_bind}",
        f"DEX2OAT_PANEL_PORT={args.panel_port}",
        f"DEX2OAT_PANEL_PUBLIC_URL={public_url}",
        "POSTGRES_DB=dex2oat_directus",
        "POSTGRES_USER=dex2oat_directus",
        f"POSTGRES_PASSWORD={random_secret(48)}",
        f"DIRECTUS_KEY={random_secret(48)}",
        f"DIRECTUS_SECRET={random_secret(64)}",
        f"DIRECTUS_ADMIN_EMAIL={admin_email}",
        f"DIRECTUS_ADMIN_PASSWORD={random_secret(32)}",
        "DIRECTUS_LOG_LEVEL=info",
        "DIRECTUS_RATE_LIMITER_POINTS=600",
        "DIRECTUS_RATE_LIMITER_DURATION=60",
        "",
    ])


def sync_env_runtime_defaults(client, sftp, env_path: str) -> list[str]:
    with sftp.file(env_path, "rb") as handle:
        text = handle.read().decode("utf-8", "replace")

    changed: list[str] = []
    lines = text.splitlines()
    seen: set[str] = set()
    next_lines: list[str] = []
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        key, value = line.split("=", 1)
        seen.add(key)
        if key == "DIRECTUS_IMAGE" and value.strip() in {"", "directus/directus:12.0.2"}:
            line = f"DIRECTUS_IMAGE={DEFAULT_DIRECTUS_IMAGE}"
            changed.append(key)
        elif key == "DIRECTUS_ADMIN_EMAIL" and value.strip() in {"", "admin@dex2oat.local"}:
            line = f"DIRECTUS_ADMIN_EMAIL={DEFAULT_ADMIN_EMAIL}"
            changed.append(key)
        elif key == "DIRECTUS_RATE_LIMITER_POINTS" and value.strip() in {"", "120"}:
            line = "DIRECTUS_RATE_LIMITER_POINTS=600"
            changed.append(key)
        next_lines.append(line)

    if "POSTGRES_IMAGE" not in seen:
        next_lines.insert(1 if next_lines else 0, f"POSTGRES_IMAGE={DEFAULT_POSTGRES_IMAGE}")
        changed.append("POSTGRES_IMAGE")

    if changed:
        tmp_path = f"{env_path}.tmp-{os.getpid()}"
        newline = "\n" if text.endswith("\n") else ""
        with sftp.file(tmp_path, "wb") as handle:
            handle.write(("\n".join(next_lines) + newline).encode("utf-8"))
        backup_path = f"{env_path}.bak-{int(time.time())}"
        checked_run(
            client,
            (
                f"cp -p {shell_quote(env_path)} {shell_quote(backup_path)} && "
                f"mv -f {shell_quote(tmp_path)} {shell_quote(env_path)} && "
                f"chmod 0600 {shell_quote(env_path)} {shell_quote(backup_path)}"
            ),
            timeout=20,
        )
    return changed


def write_env_if_missing(client, sftp, panel_dir: str, args) -> bool:
    env_path = posixpath.join(panel_dir, ".env")
    try:
        sftp.stat(env_path)
        checked_run(client, f"chmod 0600 {shell_quote(env_path)}", timeout=20)
        return False
    except OSError:
        pass
    tmp_path = f"{env_path}.tmp-{os.getpid()}"
    with sftp.file(tmp_path, "wb") as handle:
        handle.write(make_env(args).encode("utf-8"))
    sftp.rename(tmp_path, env_path)
    checked_run(client, f"chmod 0600 {shell_quote(env_path)}", timeout=20)
    return True


def panel_dir(args) -> str:
    return posixpath.join(args.base_dir.rstrip("/"), "panel")


def compose_shell(panel_path: str, body: str) -> str:
    return f"""
set -eu
cd {shell_quote(panel_path)}
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Docker Compose is not installed" >&2
  exit 127
fi
{body}
"""


def command_deploy(args) -> dict:
    remote_panel_dir = panel_dir(args)
    client = connect(args)
    try:
        require_managed_base(client, args.base_dir)
        checked_run(client, f"mkdir -p {shell_quote(remote_panel_dir)}", timeout=20)
        sftp = client.open_sftp()
        try:
            uploaded = upload_tree(sftp, PANEL_SOURCE, remote_panel_dir)
            generated_env = write_env_if_missing(client, sftp, remote_panel_dir, args)
        finally:
            sftp.close()

        env_updated = []
        sftp = client.open_sftp()
        try:
            env_updated = sync_env_runtime_defaults(client, sftp, posixpath.join(remote_panel_dir, ".env"))
        finally:
            sftp.close()

        checked_run(
            client,
            compose_shell(
                remote_panel_dir,
                """
mkdir -p data/postgres uploads extensions backups
chmod 0700 data backups
chown -R 1000:1000 uploads extensions 2>/dev/null || true
$COMPOSE --env-file .env -f docker-compose.yml pull
$COMPOSE --env-file .env -f docker-compose.yml up -d
""",
            ),
            timeout=args.deploy_timeout,
        )
        bootstrap = checked_run(
            client,
            compose_shell(
                remote_panel_dir,
                f"""
set -a
. ./.env
set +a
python3 bootstrap.py --url http://127.0.0.1:${{DEX2OAT_PANEL_PORT:-{DEFAULT_PANEL_PORT}}} --email "$DIRECTUS_ADMIN_EMAIL" --password "$DIRECTUS_ADMIN_PASSWORD"
""",
            ),
            timeout=240,
        )
        status = command_status(args, client=client)
        return {
            "deployed": True,
            "panelDir": remote_panel_dir,
            "envCreated": generated_env,
            "envUpdated": env_updated,
            "uploaded": uploaded,
            "status": status,
            "bootstrap": json.loads(bootstrap),
        }
    finally:
        client.close()


def command_status(args, client=None) -> dict:
    close_client = False
    if client is None:
        client = connect(args)
        close_client = True
    remote_panel_dir = panel_dir(args)
    try:
        require_managed_base(client, args.base_dir)
        script = f"""
set -eu
PANEL_DIR={shell_quote(remote_panel_dir)}
export PANEL_DIR
if [ ! -d "$PANEL_DIR" ]; then
  python3 - <<'PY'
import json, os
data = {{
    "panelDir": os.environ.get("PANEL_DIR", ""),
    "installed": False,
    "port": {DEFAULT_PANEL_PORT},
    "ping": False,
    "containers": [],
    "ports": [],
}}
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
  exit 0
fi
export PANEL_DIR
cd "$PANEL_DIR"
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  COMPOSE=""
fi
export COMPOSE
set -a
[ -f .env ] && . ./.env
set +a
PANEL_PORT="${{DEX2OAT_PANEL_PORT:-{DEFAULT_PANEL_PORT}}}"
if [ -n "$COMPOSE" ] && [ -f docker-compose.yml ]; then
  COMPOSE_JSON="$($COMPOSE --env-file .env -f docker-compose.yml ps --format json 2>/dev/null || true)"
else
  COMPOSE_JSON=""
fi
PORTS="$(ss -ltnp 2>/dev/null | grep -E ':(18080|18081|18082|18083)\\b' || true)"
PING=0
if curl -fsS "http://127.0.0.1:$PANEL_PORT/server/ping" >/dev/null 2>&1; then
  PING=1
fi
export PANEL_PORT COMPOSE_JSON PORTS PING
python3 - <<'PY'
import json, os
containers = []
raw = os.environ.get("COMPOSE_JSON", "")
text = raw.strip()
if text:
    try:
        parsed = json.loads(text)
        containers = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                containers.append(json.loads(line))
            except json.JSONDecodeError:
                containers.append({{"raw": line}})
data = {{
    "panelDir": os.getcwd(),
    "installed": os.path.exists("docker-compose.yml"),
    "composeAvailable": bool(os.environ.get("COMPOSE")),
    "port": int(os.environ.get("PANEL_PORT") or 0),
    "ping": os.environ.get("PING") == "1",
    "containers": containers,
    "ports": [line for line in os.environ.get("PORTS", "").splitlines() if line],
}}
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
"""
        out = checked_run(client, script, timeout=60)
        return json.loads(out)
    finally:
        if close_client:
            client.close()


def command_logs(args) -> str:
    lines = max(20, min(args.lines, 500))
    remote_panel_dir = panel_dir(args)
    client = connect(args)
    try:
        require_managed_base(client, args.base_dir)
        return checked_run(
            client,
            compose_shell(remote_panel_dir, f"$COMPOSE --env-file .env -f docker-compose.yml logs --tail={lines}"),
            timeout=90,
        )
    finally:
        client.close()


def command_bootstrap(args) -> dict:
    remote_panel_dir = panel_dir(args)
    client = connect(args)
    try:
        require_managed_base(client, args.base_dir)
        out = checked_run(
            client,
            compose_shell(
                remote_panel_dir,
                f"""
set -a
. ./.env
set +a
python3 bootstrap.py --url http://127.0.0.1:${{DEX2OAT_PANEL_PORT:-{DEFAULT_PANEL_PORT}}} --email "$DIRECTUS_ADMIN_EMAIL" --password "$DIRECTUS_ADMIN_PASSWORD"
""",
            ),
            timeout=240,
        )
        return json.loads(out)
    finally:
        client.close()


def command_credentials(args) -> dict:
    remote_panel_dir = panel_dir(args)
    client = connect(args)
    try:
        require_managed_base(client, args.base_dir)
        out = checked_run(
            client,
            f"""
set -eu
cd {shell_quote(remote_panel_dir)}
test -f .env
python3 - <<'PY'
import json
keys = ("DEX2OAT_PANEL_PUBLIC_URL", "DEX2OAT_PANEL_PORT", "DIRECTUS_ADMIN_EMAIL", "DIRECTUS_ADMIN_PASSWORD")
data = {{}}
for line in open(".env", encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key in keys:
        data[key] = value
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
""",
            timeout=30,
        )
        return json.loads(out)
    finally:
        client.close()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy or inspect the Dex2oat-Lock Directus business panel.")
    parser.add_argument("command", choices=("deploy", "status", "logs", "bootstrap", "credentials"), nargs="?", default="status")
    parser.add_argument("--host", default=os.environ.get("DEX2OAT_CLOUD_HOST") or "154.219.110.62")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DEX2OAT_CLOUD_SSH_PORT") or "22"))
    parser.add_argument("--user", default=os.environ.get("DEX2OAT_CLOUD_USER") or "root")
    parser.add_argument("--password-env", default="DEX2OAT_CLOUD_PASSWORD")
    parser.add_argument("--key", default=os.environ.get("DEX2OAT_CLOUD_KEY") or "")
    parser.add_argument("--base-dir", default=os.environ.get("DEX2OAT_CLOUD_BASE") or DEFAULT_BASE_DIR)
    parser.add_argument("--panel-bind", default=os.environ.get("DEX2OAT_PANEL_BIND") or "127.0.0.1")
    parser.add_argument("--panel-port", type=int, default=int(os.environ.get("DEX2OAT_PANEL_PORT") or str(DEFAULT_PANEL_PORT)))
    parser.add_argument("--public-url", default=os.environ.get("DEX2OAT_PANEL_PUBLIC_URL") or "")
    parser.add_argument("--admin-email", default=os.environ.get("DEX2OAT_PANEL_ADMIN_EMAIL") or "")
    parser.add_argument("--deploy-timeout", type=int, default=900)
    parser.add_argument("--lines", type=int, default=120)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.command == "deploy":
        print(json.dumps(command_deploy(args), ensure_ascii=False, indent=2))
    elif args.command == "status":
        print(json.dumps(command_status(args), ensure_ascii=False, indent=2))
    elif args.command == "logs":
        print(command_logs(args), end="")
    elif args.command == "bootstrap":
        print(json.dumps(command_bootstrap(args), ensure_ascii=False, indent=2))
    elif args.command == "credentials":
        print(json.dumps(command_credentials(args), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
