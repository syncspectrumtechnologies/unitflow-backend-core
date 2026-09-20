# UnitFlow Tally Agent

Runs on the Windows machine or LAN server where TallyPrime HTTP XML access is enabled.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows-service.ps1 `
  -CoreApiBaseUrl "https://core-api.unitflow.in" `
  -ConnectorToken "<token-from-erp>" `
  -TallyHttpUrl "http://localhost:9000" `
  -IntervalMinutes 15
```

The installer creates a Windows Scheduled Task named `UnitFlow Tally Agent`, stores local config in `%ProgramData%\UnitFlow\TallyAgent`, locks the env file ACL, installs dependencies, starts immediately, and repeats on the selected interval.

By default it pushes UnitFlow ledgers, stock items, GST-ready vouchers, and pulls Tally ledgers/vouchers back for reconciliation and conflict review. Set `TALLY_PULL_INBOUND=false` for one-way export only.

Mapping rules are controlled from ERP > Tally Sync. The default rules are:

- Sales invoices -> Tally Sales voucher, party ledger debit, UnitFlow Sales credit, GST output ledgers from stored tax charges.
- Payments -> Tally Receipt voucher, UnitFlow Cash/Bank debit, party ledger credit.
- Purchases -> Tally Purchase voucher, UnitFlow Purchases/input GST debit, party ledger credit.
- Manual accounting vouchers -> existing UnitFlow debit/credit lines.
- Generic GST charges split to CGST/SGST when seller and party GST state code match; otherwise IGST.
- Invoice/purchase item rows export as stock item entries with quantity, unit, rate, and amount.

Keep the connector token secret and rotate it from ERP if a device changes.
