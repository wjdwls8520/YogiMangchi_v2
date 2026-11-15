CREATE TABLE IF NOT EXISTS notification (
    id BIGSERIAL PRIMARY KEY,
    receiver_member_id BIGINT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    actor_member_id BIGINT NULL REFERENCES member(id) ON DELETE SET NULL,
    category VARCHAR(32) NOT NULL,
    type VARCHAR(64) NOT NULL,
    payload_json JSONB NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_receiver_id_idx
    ON notification(receiver_member_id, id DESC);

CREATE INDEX IF NOT EXISTS notification_receiver_unread_idx
    ON notification(receiver_member_id, is_read, id DESC);

CREATE TABLE IF NOT EXISTS notification_state (
    member_id BIGINT PRIMARY KEY REFERENCES member(id) ON DELETE CASCADE,
    last_checked_notification_id BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_dedupe_state (
    id BIGSERIAL PRIMARY KEY,
    notification_type VARCHAR(64) NOT NULL,
    actor_member_id BIGINT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    receiver_member_id BIGINT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL,
    target_id BIGINT NOT NULL,
    first_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notification_dedupe_state_uk
        UNIQUE (notification_type, actor_member_id, receiver_member_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS notification_group_state (
    id BIGSERIAL PRIMARY KEY,
    receiver_member_id BIGINT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    notification_type VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id BIGINT NOT NULL,
    notification_id BIGINT NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
    group_count BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notification_group_state_uk
        UNIQUE (receiver_member_id, notification_type, target_type, target_id)
);
