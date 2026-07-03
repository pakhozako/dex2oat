# Dex2oat Business Panel

This directory deploys a ready-made Directus Studio instance for Dex2oat-Lock
business operations. It is not a replacement for the public `18082` module API
and it is not a replacement for the `18080` server panel.

## Port Layout

- `18080`: 1Panel or another mature server management panel.
- `18082`: Dex2oat-Lock release/API/module communication service.
- `18083`: Directus Studio for Dex2oat business data.
- `18081`: legacy admin port, keep disabled.

## Why Directus

Directus is an upstream maintained admin studio and API layer. For this project
it is used to manage records that should not be handled by a hand-written HTML
console:

- supporter plans and verified supporters
- supporter verification logs
- feedback submissions
- optional module communication telemetry
- manually approved rule-evidence uploads
- release mirror records and operator notes

## Deployment

Preferred remote deployment from the project root:

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<temporary ssh password>"
npm.cmd run panel:deploy
npm.cmd run panel:status
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

The deploy tool creates `/root/codex-managed/dex2oat-lock/panel/.env` on the
server if it does not exist. Generated passwords and secrets stay on the server
and are not committed.

If you deploy manually, copy `.env.example` to `.env`, replace every secret, and
run:

```bash
docker compose --env-file .env -f docker-compose.yml up -d
python3 bootstrap.py --url http://127.0.0.1:18083 --email "$DIRECTUS_ADMIN_EMAIL" --password "$DIRECTUS_ADMIN_PASSWORD"
```

## Exposure

Keep Directus bound to `127.0.0.1` by default and expose it through 1Panel,
Caddy, or Nginx with HTTPS and a real hostname. Direct IP access on `18083` is
useful for short tests only. Do not expose the generated admin password or
`.env` file.

## 18082 Bridge Contract

The public module should continue to talk to `18082`. The cloud API can then
store operational data into Directus-backed collections:

- `/api/telemetry` -> `dex2oat_telemetry_events`
- `/api/rule-evidence` -> `dex2oat_rule_evidence`
- `/api/feedback` -> `dex2oat_feedback_submissions`
- `/api/supporter/verify` -> read public supporter data on `18082`, write accepted/rejected attempts to `dex2oat_supporter_verifications`

This keeps public module endpoints small and rate-limited while Directus handles
the private online management panel.
