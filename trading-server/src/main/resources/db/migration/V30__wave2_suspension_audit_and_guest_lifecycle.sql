-- V30: Wave 2 member suspension propagation, admin audit logs, expired guest lifecycle, and contest disqualification

CREATE TABLE IF NOT EXISTS member_suspension (
    member_id BIGINT PRIMARY KEY,
    suspended BOOLEAN NOT NULL,
    reason VARCHAR(500) NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_member_id BIGINT NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(48) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    detail TEXT NULL,
    request_id VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_id
    ON admin_audit_log (created_at DESC, id DESC);

ALTER TABLE trading_account DROP CONSTRAINT IF EXISTS trading_account_status_check;
ALTER TABLE trading_account ADD CONSTRAINT trading_account_status_check
    CHECK (status IN ('ACTIVE', 'BANKRUPT', 'WITHDRAWN', 'EXPIRED'));

CREATE INDEX IF NOT EXISTS idx_trading_account_expired_active_guest
    ON trading_account (credential_expires_at, id)
    WHERE guest_account AND status = 'ACTIVE';

ALTER TABLE position DROP CONSTRAINT IF EXISTS position_close_state;
ALTER TABLE position ADD CONSTRAINT position_close_state CHECK (
    ((close_reason IS NULL OR (close_reason = 'CONTEST_SETTLEMENT' AND status = 'LIQUIDATED')) AND (
        (status = 'OPEN' AND quantity > 0 AND margin > 0 AND entry_notional > 0
            AND closed_at IS NULL AND exit_price IS NULL AND merged_into_position_id IS NULL)
        OR (status IN ('CLOSED', 'LIQUIDATED') AND quantity = 0 AND margin = 0 AND entry_notional = 0
            AND closed_at IS NOT NULL AND exit_price IS NOT NULL AND exit_price > 0 AND merged_into_position_id IS NULL)
        OR (status = 'MERGED' AND merged_into_position_id IS NOT NULL AND merged_into_position_id <> id)
    ))
    OR (close_reason IN ('MEMBER_WITHDRAWAL', 'GUEST_RETRY', 'MEMBER_RESTART', 'CONTEST_CANCELED', 'GUEST_EXPIRED', 'CONTEST_DISQUALIFIED')
        AND status = 'CLOSED' AND quantity = 0 AND margin = 0 AND entry_notional = 0
        AND reserved_close_quantity = 0 AND closed_at IS NOT NULL AND exit_price IS NULL
        AND merged_into_position_id IS NULL)
);

ALTER TABLE contest_participant
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS disqualified_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS disqualify_reason VARCHAR(500) NULL,
    ADD COLUMN IF NOT EXISTS disqualified_by_member_id BIGINT NULL;

ALTER TABLE contest_participant DROP CONSTRAINT IF EXISTS contest_participant_status_check;
ALTER TABLE contest_participant ADD CONSTRAINT contest_participant_status_check
    CHECK (status IN ('ACTIVE', 'DISQUALIFIED'));

CREATE INDEX IF NOT EXISTS idx_notification_created_at
    ON notification (created_at, id);

CREATE INDEX IF NOT EXISTS idx_idempotent_command_created_at
    ON idempotent_command (created_at);

CREATE INDEX IF NOT EXISTS idx_position_sl_cmd_created_at
    ON position_stop_loss_command (created_at);

CREATE INDEX IF NOT EXISTS idx_position_tp_cmd_created_at
    ON position_take_profit_command (created_at);
