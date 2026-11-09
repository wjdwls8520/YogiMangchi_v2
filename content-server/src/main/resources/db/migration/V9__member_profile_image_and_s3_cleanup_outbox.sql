ALTER TABLE member
    ADD COLUMN IF NOT EXISTS profile_img_url VARCHAR(1000),
    ADD COLUMN IF NOT EXISTS profile_img_s3_key VARCHAR(512);

CREATE TABLE IF NOT EXISTS s3_cleanup_task (
    id BIGSERIAL PRIMARY KEY,
    s3_key VARCHAR(512) NOT NULL UNIQUE,
    reason VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_s3_cleanup_task_pending
    ON s3_cleanup_task (status, next_attempt_at, id);
