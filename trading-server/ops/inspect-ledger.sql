-- psql -v account_id=... -f trading-server/ops/inspect-ledger.sql
-- Financially read-only; credentials belong in the environment, never this file.
SELECT a.id, a.status, c.checked_at, c.status AS reconciliation_status,
       c.failed_checks, c.evidence,
       clock_timestamp()-c.checked_at AS evidence_age
FROM trading.trading_account a
LEFT JOIN trading.ledger_reconciliation c ON c.account_id=a.id
WHERE a.id=:'account_id'::bigint;
SELECT id, trading_symbol_id, event_id, reason, evidence, held_at,
       resolved_at, resolution_reference
FROM trading.risk_hold WHERE account_id=:'account_id'::bigint ORDER BY id;
