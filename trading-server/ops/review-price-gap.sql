-- Explicit operator review, never automatic reconciliation. No financial amounts or Fill rows change.
-- Required psql variables: account_id, hold_id, review_reference (ticket/evidence, >=8 chars).
-- Example (no credentials): psql -X -v ON_ERROR_STOP=1 -v account_id=123 -v hold_id=456 -v review_reference=review-ticket-123 -f ops/review-price-gap.sql
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='5s';
SELECT pg_advisory_xact_lock_shared(8947201901);
SELECT id FROM trading.trading_account WHERE id=:'account_id'::bigint FOR UPDATE;
-- Only missing-provider/receipt continuity holds. Processing failures and ledger mismatches require their own evidence/fix.
-- All received events remain recorded; this acknowledges the never-received interval cannot be reconstructed.
UPDATE trading.risk_hold SET resolved_at=clock_timestamp(),resolution_reference=:'review_reference'
WHERE id=:'hold_id'::bigint AND account_id=:'account_id'::bigint AND resolved_at IS NULL
  AND reason IN ('PROVIDER_CONTINUITY_UNKNOWN','UNOBSERVED_PRICE_INTERVAL','POSTGRES_INGRESS_INTERRUPTED')
  AND length(:'review_reference') BETWEEN 8 AND 500
RETURNING id,account_id,trading_symbol_id,event_id,reason,resolved_at,resolution_reference;
COMMIT;
