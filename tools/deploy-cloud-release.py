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
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "tools" / "version.json"
RELEASE_DIR = ROOT / "releases"
DEFAULT_BASE_DIR = "/root/codex-managed/dex2oat-lock"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def read_sha256(path: Path) -> str:
    return path.read_text(encoding="utf-8").split()[0]


def atomic_write_text(sftp, remote_path: str, text: str) -> None:
    tmp_path = f"{remote_path}.tmp-{os.getpid()}"
    with sftp.file(tmp_path, "w") as handle:
        handle.write(text)
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


def build_index_html(version: dict, entry: dict, rules_version: str) -> str:
    update_href = "/api/update.json"
    releases_href = "/api/releases.json"
    rules_href = "/api/rules.json"
    evidence_href = "/api/evidence-summary.json"
    download_href = urlparse(entry["zipUrl"]).path
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dex2oat-Lock Cloud</title>
  <style>
    :root {{
      color-scheme: light dark;
      --surface: #fffbfe;
      --surface2: #f3edf7;
      --surface3: #ece6f0;
      --primary: #6750a4;
      --on: #1d1b20;
      --muted: #625b71;
      --outline: #cac4d0;
      --ok: #146c2e;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --surface: #141218;
        --surface2: #211f26;
        --surface3: #2b2930;
        --primary: #d0bcff;
        --on: #e6e0e9;
        --muted: #cac4d0;
        --outline: #49454f;
        --ok: #7bd88f;
      }}
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, transparent), transparent 42%), var(--surface);
      color: var(--on);
      font: 15px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    main {{ width: min(960px, 100%); margin: 0 auto; padding: 32px 20px 48px; }}
    .hero {{
      display: grid;
      gap: 18px;
      padding: 28px;
      border: 1px solid color-mix(in srgb, var(--outline) 68%, transparent);
      border-radius: 28px;
      background: color-mix(in srgb, var(--surface2) 88%, transparent);
      box-shadow: 0 8px 28px rgba(0, 0, 0, .08);
    }}
    h1 {{ margin: 0; font-size: clamp(30px, 6vw, 56px); line-height: 1.04; }}
    .lead {{ max-width: 680px; margin: 0; color: var(--muted); font-size: 17px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-top: 18px; }}
    .card {{ padding: 20px; border: 1px solid color-mix(in srgb, var(--outline) 62%, transparent); border-radius: 22px; background: color-mix(in srgb, var(--surface3) 74%, transparent); }}
    .card span {{ display: block; color: var(--muted); font-size: 13px; }}
    .card strong {{ display: block; margin-top: 6px; font-size: 24px; }}
    .button {{ display: inline-flex; min-height: 44px; align-items: center; justify-content: center; border-radius: 999px; background: var(--primary); color: var(--surface); padding: 0 20px; text-decoration: none; font-weight: 700; }}
    .actions {{ display: flex; flex-wrap: wrap; gap: 12px; }}
    .links {{ display: grid; gap: 10px; margin-top: 22px; }}
    .links a {{ color: var(--primary); text-decoration: none; }}
    .status {{ color: var(--ok); font-weight: 700; }}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="status">Service online</p>
      <h1>Dex2oat-Lock Cloud</h1>
      <p class="lead">Release mirror, cloud rule metadata, module communication, rule evidence sync, and maintenance checks. User-facing state stays inside the module WebUI.</p>
      <div class="actions"><a class="button" href="{download_href}">Download {entry["version"]}</a></div>
      <div class="grid">
        <article class="card"><span>Latest version</span><strong>{entry["version"]}</strong></article>
        <article class="card"><span>Version code</span><strong>{entry["versionCode"]}</strong></article>
        <article class="card"><span>Rules</span><strong>{rules_version}</strong></article>
        <article class="card"><span>Status</span><strong>OK</strong></article>
      </div>
      <div class="links">
        <a href="{update_href}">{update_href}</a>
        <a href="{releases_href}">{releases_href}</a>
        <a href="{rules_href}">{rules_href}</a>
        <a href="{evidence_href}">{evidence_href}</a>
      </div>
    </section>
  </main>
</body>
</html>
"""


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
    http_base = args.http_base or version.get("cloudBaseUrl") or f"http://{args.host}:18080"
    entry = make_release_entry(version, http_base, sha256, size, updated_at)
    rules_version = version.get("rulesVersion") or label
    rules = {
        "ok": True,
        "rulesVersion": rules_version,
        "schemaVersion": version.get("schemaVersion", 0),
        "updatedAt": updated_at,
        "note": "Cloud rule metadata endpoint is reserved; module release embeds protected rule data.",
    }
    health = {
        "ok": True,
        "service": "dex2oat-cloud",
        "version": label,
        "updatedAt": updated_at,
    }

    base = args.base_dir.rstrip("/")
    public_dir = posixpath.join(base, "public")
    api_dir = posixpath.join(public_dir, "api")
    files_dir = posixpath.join(public_dir, "files")
    backup_dir = posixpath.join(base, "backups", f"deploy-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}")

    client = connect(args)
    try:
        if ssh_run(client, f"test -d {shell_quote(base)} && echo yes || echo no") != "yes":
            raise RuntimeError(f"managed base directory does not exist: {base}")
        ssh_run(client, f"mkdir -p {shell_quote(api_dir)} {shell_quote(files_dir)} {shell_quote(backup_dir)}")
        backup_cmd = (
            f"for f in {shell_quote(public_dir)}/index.html {shell_quote(public_dir)}/health.json "
            f"{shell_quote(public_dir)}/update.json {shell_quote(public_dir)}/releases.json "
            f"{shell_quote(api_dir)}/update.json {shell_quote(api_dir)}/releases.json {shell_quote(api_dir)}/rules.json; "
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
            atomic_write_text(sftp, posixpath.join(public_dir, "health.json"), json.dumps(health, ensure_ascii=False, indent=2) + "\n")
            if not args.no_index:
                atomic_write_text(sftp, posixpath.join(public_dir, "index.html"), build_index_html(version, entry, rules_version))
        finally:
            sftp.close()

        chmod_targets = [
            posixpath.join(public_dir, "index.html"),
            posixpath.join(public_dir, "health.json"),
            posixpath.join(public_dir, "update.json"),
            posixpath.join(public_dir, "releases.json"),
            posixpath.join(api_dir, "update.json"),
            posixpath.join(api_dir, "releases.json"),
            posixpath.join(api_dir, "rules.json"),
            posixpath.join(files_dir, zip_name),
            posixpath.join(files_dir, manifest_name),
        ]
        ssh_run(client, "chmod 0644 " + " ".join(shell_quote(item) for item in chmod_targets))
        remote_sha = ssh_run(client, f"sha256sum {shell_quote(posixpath.join(files_dir, zip_name))} | awk '{{print $1}}'")
        service_state = ssh_run(client, "systemctl is-active dex2oat-cloud.service 2>/dev/null || true")
        if remote_sha != sha256:
            raise RuntimeError(f"remote sha mismatch: {remote_sha} != {sha256}")
    finally:
        client.close()

    if not args.skip_http_verify:
        update = http_json(f"{http_base.rstrip('/')}/api/update.json")
        if update.get("version") != label or update.get("sha256") != sha256:
            raise RuntimeError("HTTP update endpoint did not return the deployed release")

    return {
        "deployed": True,
        "version": label,
        "versionCode": version["versionCode"],
        "sha256": sha256,
        "bytes": size,
        "httpBase": http_base,
        "backup": backup_dir,
        "service": service_state,
    }


def http_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def check(args) -> dict:
    version = load_json(VERSION_FILE)
    http_base = args.http_base or version.get("cloudBaseUrl") or f"http://{args.host}:18080"
    update = http_json(f"{http_base.rstrip('/')}/api/update.json")
    releases = http_json(f"{http_base.rstrip('/')}/api/releases.json")
    health = http_json(f"{http_base.rstrip('/')}/health.json")
    return {
        "httpBase": http_base,
        "update": update,
        "latest": releases.get("latest"),
        "health": health,
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
    parser.add_argument("--no-index", action="store_true", help="Do not update public/index.html.")
    parser.add_argument("--skip-http-verify", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    result = check(args) if args.command == "check" else deploy(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
