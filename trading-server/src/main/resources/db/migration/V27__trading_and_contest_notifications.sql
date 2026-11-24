CREATE TABLE IF NOT EXISTS notification (
    id BIGSERIAL PRIMARY KEY,
    receiver_member_id BIGINT NOT NULL,
    actor_member_id BIGINT NULL,
    category VARCHAR(32) NOT NULL,
    type VARCHAR(64) NOT NULL,
    payload_json JSONB NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    dedupe_key VARCHAR(128) NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_receiver_id_idx
    ON notification(receiver_member_id, id DESC);

CREATE INDEX IF NOT EXISTS notification_receiver_unread_idx
    ON notification(receiver_member_id, is_read, id DESC);

CREATE TABLE IF NOT EXISTS notification_state (
    member_id BIGINT PRIMARY KEY,
    last_checked_notification_id BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
