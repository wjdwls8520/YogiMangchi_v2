-- Bounded retention purge indexes for completed risk account work and unreferenced price journal events.
CREATE INDEX IF NOT EXISTS risk_work_retention_completed
    ON risk_account_work(completed_at, event_id, account_id)
    WHERE status IN ('DONE', 'RETIRED');

CREATE INDEX IF NOT EXISTS risk_price_event_retention_recorded
    ON risk_price_event(recorded_at, id);

CREATE INDEX IF NOT EXISTS risk_work_attempt_account_event
    ON risk_work_attempt(account_id, event_id);

CREATE INDEX IF NOT EXISTS risk_work_event_id
    ON risk_account_work(event_id);
