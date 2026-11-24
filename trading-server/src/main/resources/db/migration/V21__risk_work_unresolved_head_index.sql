-- Preserve every accepted event and financial fact. Only the unresolved account head is scheduled.
-- Apply with the Trading worker stopped; do not edit the already applied V19 migration.
CREATE INDEX risk_work_unresolved_head ON risk_account_work(account_id,event_id)
 INCLUDE(status,next_attempt_at) WHERE status IN ('PENDING','HELD');
