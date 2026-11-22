-- V14: Wave 3 durable suspension outbox, persistent admin audit log, banned OAuth surrogate ID,
--      community daily view deduplication, weekly popular index, support CLOSED status,
--      and retention indexes for soft-deleted attachments & notifications.

-- 1. Durable member suspension delivery outbox -> trading-server
CREATE TABLE member_suspension_delivery (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES member(id),
    suspended BOOLEAN NOT NULL,
    reason VARCHAR(500),
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX member_suspension_delivery_pending_idx
    ON member_suspension_delivery (next_attempt_at, id)
    WHERE status = 'PENDING';

CREATE INDEX member_suspension_delivery_member_idx
    ON member_suspension_delivery (member_id, id DESC);

-- 2. Persistent append-only admin audit log
CREATE TABLE admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_member_id BIGINT NOT NULL,
    admin_nickname VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(48) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    summary VARCHAR(500),
    detail_json JSONB,
    request_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_log_created_idx
    ON admin_audit_log (created_at DESC, id DESC);

CREATE INDEX admin_audit_log_action_idx
    ON admin_audit_log (action, id DESC);

CREATE INDEX admin_audit_log_admin_idx
    ON admin_audit_log (admin_member_id, id DESC);

-- 3. Surrogate ID on banned_oauth_identity for admin listing & unban by ID
ALTER TABLE banned_oauth_identity
    ADD COLUMN id BIGSERIAL NOT NULL;

CREATE UNIQUE INDEX banned_oauth_identity_id_uk
    ON banned_oauth_identity (id);

CREATE INDEX banned_oauth_identity_banned_at_idx
    ON banned_oauth_identity (banned_at DESC, id DESC);

-- 4. Community post daily view deduplication & weekly popular / soft-delete retention indexes
CREATE TABLE community_post_viewer_daily (
    post_id BIGINT NOT NULL REFERENCES community_post(id) ON DELETE CASCADE,
    viewed_date DATE NOT NULL,
    viewer_key VARCHAR(96) NOT NULL,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, viewed_date, viewer_key)
);

CREATE INDEX community_post_viewer_daily_date_idx
    ON community_post_viewer_daily (viewed_date);

CREATE INDEX community_post_created_popular_idx
    ON community_post (created_at DESC, like_count DESC, id DESC)
    WHERE status = 'ACTIVE';

CREATE INDEX community_post_deleted_at_idx
    ON community_post (deleted_at, id)
    WHERE deleted_at IS NOT NULL;

-- 5. Support 1:1 inquiry lifecycle: CLOSED status + updated_at / closed_at
ALTER TABLE support_inquiry DROP CONSTRAINT IF EXISTS support_inquiry_status_check;
ALTER TABLE support_inquiry ADD CONSTRAINT support_inquiry_status_check
    CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED'));

ALTER TABLE support_inquiry
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- 6. Notification 90-day retention cleanup indexes
CREATE INDEX IF NOT EXISTS notification_created_at_idx
    ON notification (created_at, id);

CREATE INDEX IF NOT EXISTS notification_dedupe_last_notified_idx
    ON notification_dedupe_state (last_notified_at, id);
