# Dex2oat Lock 3.1 Architecture

## Goals

- Remove vendor detection as the core configuration path.
- Generate `system.prop` from captured device values and a rule catalog.
- Consolidate runtime, health, conflict, matching, and config summaries into `/data/adb/dex2oat-lock/state.prop`.
- Make WebUI focus on current status, active source, rule match result, conflicts, and user actions.
- Add integrity checking for WebUI assets, shell scripts, rule files, and critical module files.
- Gate custom and high-risk configuration behind a versioned risk agreement.

## Pipeline

### Install

1. `customize.sh` creates `/data/adb/dex2oat-lock/` and sources `core/state.sh`.
2. `scripts/capture-props.sh` captures ART/dex2oat/runtime related properties.
3. `scripts/generate-props.sh` reads `webroot/data/options.json`, reuses captured values when valid, falls back to rule defaults, and writes `system.prop`.
4. `state.prop` records device summary, config source, prop hash, prop count, rule match totals, lifecycle state, and timestamps.
5. `core/integrity-check.sh` verifies the installed files against `core/integrity-baseline.prop` and writes `integrity.*` state.

### Boot

1. `service.sh` waits for boot completion and handles `trigger-rematch`.
2. Re-match reruns capture and rule generation, then refreshes `system.prop.bak`, `prop-lock.list`, conflict state, and unified state.
3. Runtime apply counters are written both to legacy `service-state.prop` and `state.prop` during the migration window.

### WebUI Save

1. WebUI still edits user-facing option state in `config.json`.
2. Saving generates `system.prop` directly from enabled options and selected values.
3. WebUI writes `config-source.prop` for migration compatibility and updates `state.prop` as the primary status source.

## State Model

Primary file: `/data/adb/dex2oat-lock/state.prop`.

Key groups:

- `schema_version`, `module_version`
- `device.*`: model, manufacturer, brand, Android release, SDK
- `config.*`: source, reason, prop count, prop hash, updated time
- `match.*`: mode, captured total, matched total, default total, updated time
- `service.*`: status, phase, health, counters, boot id, updated time
- `health.*`: status, files ok, props ok, auto fixed, boot id, checked time
- `conflict.*`: scan status, conflict total, checked time
- `integrity.*`: file hash check status, reason, checked total, missing total, changed total
- `summary.*`: final user-facing status, message, attention count, and attention list
- `risk.*`: risk mode, agreement version, agreement time, custom unlock, aggressive unlock
- `lifecycle.*`: install/apply/restore status and reason

Still independent by design:

- `system.prop`: final module configuration consumed by Magisk-style module mounting.
- `system.prop.bak` and `backup/system.prop.factory`: recovery material.
- `config.json`: WebUI edit state.
- logs under `logs/`: diagnostic history, not primary state.
- `integrity-report.txt`: integrity evidence file; WebUI status conclusion still comes from `state.prop`.

## WebUI Model

- Bottom navigation is reduced to `Home / Custom / About`.
- Home shows the real `summary.*` status, attention list, config source, rule match summary, health, conflict, integrity, and quick actions.
- Custom is the main configuration workbench. `safe / caution / aggressive` are risk modes, not bottom navigation tabs.
- About contains version, project metadata, architecture summary, GitHub, agreement status, and diagnostic entry points.
- Diagnostics are shown as cards: unified state, rule match, config generation, integrity, health, conflict, lifecycle, reboot/apply, prop comparison, and logs.

## Risk Agreement

- Home and diagnostics are always readable.
- First entry into Custom requires agreement version `1`.
- Aggressive mode requires the same agreement plus `aggressiveUnlocked=yes`.
- Agreement confirmation requires a 30 second wait, an integer arithmetic challenge, and explicit checkbox confirmation.
- Agreement state is persisted in `config.json` and mirrored to `risk.*` keys in `state.prop`.

## Integrity Model

- `tools/generate-integrity-baseline.js` writes `core/integrity-baseline.prop` during release build.
- `core/integrity-check.sh` verifies WebUI HTML/CSS/JS/data, critical shell scripts, rule generation scripts, `system.prop`, and module metadata.
- Install and boot call integrity check; WebUI homepage and diagnostics display the result.

## Rule Model

The first 3.1 skeleton uses `webroot/data/options.json` as both WebUI schema and rule catalog:

- `id`: rule id
- `label` and `description`: UI and generated comments
- `prop`: target Android property
- `defaultEnabled`: whether the generated prop is active without a captured value
- `defaultValue`: fallback value
- `values`: allowed values for WebUI validation

Captured values win when present and safe. Missing values fall back to rule defaults. User WebUI saves become `config.source=webui-custom` and coexist with later auto-rules rematch by explicit user action.

## Migration Notes

- 3.0 vendor templates and vendor option maps are removed from the package path.
- Legacy files such as `config-source.prop`, `device.prop`, `service-state.prop`, `health.log`, and `conflict-report.txt` remain during the first 3.1 migration window as compatibility mirrors.
- WebUI and diagnostics prefer `state.prop` but can fall back to legacy files when upgrading from older installs.

## Follow-Up Items

- Split `options.json` into a clearer rule schema when the current skeleton is stable.
- Add a rule validator that checks duplicate props, invalid values, and unsafe captured values.
- Move remaining legacy state mirrors behind a compatibility flag after one release cycle.
- Add full prop diff preview before saving custom config.
