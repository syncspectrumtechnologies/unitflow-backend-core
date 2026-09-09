# UnitFlow Tally Agent

Runs on the Windows machine or LAN server where TallyPrime HTTP XML access is enabled.

```bash
UNITFLOW_CORE_API_BASE_URL=https://core-api.unitflow.in \
UNITFLOW_TALLY_CONNECTOR_TOKEN=<token-from-erp> \
TALLY_HTTP_URL=http://localhost:9000 \
node tally-agent.mjs
```

By default it pushes UnitFlow ledgers/vouchers to Tally, then pulls Tally ledgers/vouchers back for reconciliation and conflict review. Set `TALLY_PULL_INBOUND=false` for one-way export only.

Use Windows Task Scheduler or PM2 to run it on an interval. Keep the token secret and rotate it from ERP if a device changes.
