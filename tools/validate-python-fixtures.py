#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Behavioral fixtures for Python release/cloud helper scripts."""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_tool(file_name: str, module_name: str):
    path = ROOT / "tools" / file_name
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_deploy_cloud_release() -> None:
    tool = load_tool("deploy-cloud-release.py", "deploy_cloud_release")
    expected = {
        "version": "v4.5",
        "versionCode": 450,
        "sha256": "abc123",
        "size": 12345,
        "zipName": "Dex2oat-Lock-v4.5-release.zip",
    }
    remote = {
        "version": "v4.5",
        "versionCode": 450,
        "sha256": "abc123",
        "size": 12345,
        "zipUrl": "https://example.test/files/Dex2oat-Lock-v4.5-release.zip",
    }
    if tool.compare_remote_release("update", remote, expected):
        raise AssertionError("matching cloud release was reported as mismatched")

    bad_sha = {**remote, "sha256": "bad"}
    mismatches = tool.compare_remote_release("update", bad_sha, expected)
    if not any("sha256" in item for item in mismatches):
        raise AssertionError("cloud release SHA mismatch was not detected")

    bad_url = {**remote, "zipUrl": "https://example.test/files/Dex2oat-Lock-v4.4-release.zip"}
    mismatches = tool.compare_remote_release("update", bad_url, expected)
    if not any("zipUrl" in item for item in mismatches):
        raise AssertionError("cloud release ZIP URL mismatch was not detected")

    local = tool.local_release_expectation(tool.load_json(tool.VERSION_FILE))
    current_version = tool.load_json(tool.VERSION_FILE).get("version")
    if not local or local.get("version") != current_version or not local.get("sha256"):
        raise AssertionError("local release expectation did not read the current built release")

    supporters = {
        "ok": True,
        "version": "v4.5",
        "versionCode": 450,
        "items": [
            {"id": "mem-1", "name": "A", "skinId": "memorial-amber", "skinIds": ["memorial-amber"]},
            {"id": "founder-1", "name": "B", "skinId": "founder-qingmu", "skinIds": ["founder-qingmu"]},
        ],
    }
    summary = tool.validate_public_supporters(supporters, {"version": "v4.5", "versionCode": 450})
    if summary.get("items") != 2 or summary.get("versionCode") != 450:
        raise AssertionError("public supporters contract summary is incorrect")

    legacy = {key: value for key, value in supporters.items() if key != "versionCode"}
    legacy_summary = tool.validate_public_supporters(legacy, {"version": "v4.5", "versionCode": 450})
    if legacy_summary.get("versionCode") is not None or not legacy_summary.get("warnings"):
        raise AssertionError("public supporters contract did not tolerate legacy missing versionCode with a warning")

    leaked = {
        **supporters,
        "items": [{"id": "leak", "name": "leak", "hash": "secret"}],
    }
    try:
        tool.validate_public_supporters(leaked, {"version": "v4.5", "versionCode": 450})
    except RuntimeError as error:
        if "leaks private fields" not in str(error):
            raise AssertionError("public supporters leak error was not specific enough") from error
    else:
        raise AssertionError("public supporters contract did not reject leaked hash fields")


def main() -> int:
    validate_deploy_cloud_release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
