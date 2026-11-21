-- V29: Symbol emergency halt status (HALTED) and optional idempotent batch command replay (cancel-all / close-all)

ALTER TABLE trading_symbol DROP CONSTRAINT ck_trading_symbol_status;
ALTER TABLE trading_symbol ADD CONSTRAINT ck_trading_symbol_status
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'HALTED'));

CREATE TABLE idempotent_command (
    account_id BIGINT NOT NULL REFERENCES trading_account(id) ON DELETE CASCADE,
    request_key VARCHAR(100) NOT NULL,
    operation VARCHAR(32) NOT NULL CHECK (operation IN ('CANCEL_ALL', 'CLOSE_ALL')),
    request_fingerprint VARCHAR(64) NOT NULL,
    response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (account_id, request_key)
);
