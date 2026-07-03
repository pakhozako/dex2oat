# Dex2oat Business Panel

Dex2oat business data management uses Directus Studio, a ready-made upstream
admin panel and API layer. Do not build or serve a hand-written Dex2oat admin
dashboard on `18080`.

## Responsibilities

- `18080`: 1Panel or another mature server management panel.
- `18082`: Dex2oat-Lock public release/API/module communication service.
- `18083`: Directus Studio for private Dex2oat business data.
- `18081`: legacy admin port; keep disabled.

Directus should manage:

- feedback submissions
- supporter plans and verified supporters
- supporter verification attempts
- optional module communication telemetry
- manually approved rule evidence
- release mirror records and operator notes

## Deploy

Use temporary SSH credentials only:

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<server password>"
npm.cmd run panel:deploy
npm.cmd run panel:status
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

The deploy tool writes files only under
`/root/codex-managed/dex2oat-lock/panel`. It creates a server-side `.env` with
random credentials if one does not already exist.

## Access

Directus binds to `127.0.0.1:18083` by default. Publish it through
1Panel/Caddy/Nginx with HTTPS when browser access is needed. Do not expose or
commit `DIRECTUS_ADMIN_PASSWORD` or the generated server `.env`.

## Bridge

Keep WebUI and module traffic pointed at `18082`. The public cloud API may store
accepted data into Directus collections, but WebUI must never receive Directus
admin credentials.

Server-side bridge helper:

```bash
cd /root/codex-managed/dex2oat-lock/panel
python3 cloud_bridge.py telemetry '{"installHash":"fnv1a-demo"}'
python3 cloud_bridge.py feedback '{"title":"Demo feedback"}'
python3 cloud_bridge.py evidence '{"installHash":"fnv1a-demo","capturedProps":{}}'
```

The bridge is only for trusted server-side code. It reads the Directus admin
login from the private panel `.env`, sanitizes payloads into collection fields,
and leaves the public `18082` API responsible for rate limits, allowlists and
request validation.
