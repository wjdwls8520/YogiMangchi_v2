-- A retained withdrawal request is also the delivery outbox. No cross-schema FK or query.
CREATE TABLE member_withdrawal (
    member_id BIGINT PRIMARY KEY REFERENCES member(id),
    status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','COMPLETED')),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
    next_attempt_at TIMESTAMPTZ NOT NULL,
    CHECK ((status='PENDING' AND completed_at IS NULL) OR (status='COMPLETED' AND completed_at IS NOT NULL))
);
CREATE INDEX withdrawal_pending_delivery ON member_withdrawal(next_attempt_at,member_id) WHERE status='PENDING';
