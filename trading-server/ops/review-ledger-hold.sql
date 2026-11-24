-- Only after root-cause repair, an independent fresh recheck and operator review.
-- psql -v account_id=... -v hold_id=... -v review_reference=TICKET-... -f ...
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='3s';
SELECT id FROM trading.trading_account WHERE id=:'account_id'::bigint FOR UPDATE;
-- No financial row is modified. The first mismatch evidence remains in risk_hold.
UPDATE trading.risk_hold h
SET resolved_at=clock_timestamp(), resolution_reference=:'review_reference'
FROM trading.ledger_reconciliation c, trading.trading_account a
WHERE h.id=:'hold_id'::bigint AND h.account_id=:'account_id'::bigint
  AND h.reason='LEDGER_MISMATCH' AND h.resolved_at IS NULL
  AND a.id=h.account_id AND a.status='ACTIVE' AND c.account_id=h.account_id
  AND c.status IN ('MATCHED','UNVERIFIED') AND c.failed_checks='[]'::jsonb
  AND c.checked_at>h.held_at AND c.checked_at>clock_timestamp()-interval '5 minutes'
  AND length(:'review_reference')>=8
RETURNING h.id,h.resolved_at,h.resolution_reference;
COMMIT;
-- UPDATE 0 means the preconditions failed; never force the hold open.
