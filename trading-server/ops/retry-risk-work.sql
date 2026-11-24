-- Use ONLY after diagnosing/fixing the failed work; grant a new bounded three-attempt window.
-- Required psql variables: account_id, event_id, review_reference (>=8 chars).
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='5s';
SELECT pg_advisory_xact_lock_shared(8947201901);
SELECT id FROM trading.trading_account WHERE id=:'account_id'::bigint FOR UPDATE;
UPDATE trading.risk_hold SET resolved_at=clock_timestamp(),resolution_reference=:'review_reference'
WHERE account_id=:'account_id'::bigint AND event_id=:'event_id'::bigint AND reason='RISK_PROCESSING_FAILED'
  AND resolved_at IS NULL AND length(:'review_reference') BETWEEN 8 AND 500
RETURNING id,event_id,reason,resolved_at;
UPDATE trading.risk_account_work w SET status='PENDING',retry_limit=attempts+3,next_attempt_at=clock_timestamp()
WHERE account_id=:'account_id'::bigint AND event_id=:'event_id'::bigint AND status='HELD'
  AND length(:'review_reference') BETWEEN 8 AND 500
  AND NOT EXISTS(SELECT 1 FROM trading.risk_hold h WHERE h.account_id=w.account_id AND h.reason='RISK_PROCESSING_FAILED' AND h.resolved_at IS NULL)
RETURNING account_id,event_id,status,attempts,retry_limit;
COMMIT;
-- Lifetime attempt evidence is preserved. Later events stay behind this work for this account.
