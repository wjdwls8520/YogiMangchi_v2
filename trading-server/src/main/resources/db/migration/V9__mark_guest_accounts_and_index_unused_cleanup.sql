-- V1-V8 only create Guest accounts. Future non-Guest rows default to false and are never purged here.
ALTER TABLE trading_account ADD COLUMN guest_account BOOLEAN NOT NULL DEFAULT false;
UPDATE trading_account SET guest_account = true;

-- Untouched Guest rows only; financial writes move them out of this index.
CREATE INDEX account_unused_guest_expiry_idx ON trading_account (credential_expires_at, id)
    WHERE guest_account AND last_financial_change_at = created_at;

-- Cleanup checks all position history, not only OPEN positions; also bounds the account FK check.
CREATE INDEX position_account_history_idx ON position (account_id, id);
