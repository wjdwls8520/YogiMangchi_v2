-- Operational latest check, never a wallet adjustment or fabricated execution.
-- An unused Guest's disposable diagnostic snapshot follows its existing authorized cleanup lifecycle.
CREATE TABLE ledger_reconciliation (
 account_id BIGINT PRIMARY KEY REFERENCES trading_account(id) ON DELETE CASCADE,
 checked_at TIMESTAMPTZ NOT NULL,
 status VARCHAR(16) NOT NULL CHECK(status IN ('MATCHED','MISMATCH','UNVERIFIED')),
 failed_checks JSONB NOT NULL CHECK(jsonb_typeof(failed_checks)='array'),
 evidence JSONB NOT NULL
);
CREATE TABLE ledger_reconciliation_cursor(id SMALLINT PRIMARY KEY CHECK(id=1),last_account_id BIGINT NOT NULL DEFAULT 0);
INSERT INTO ledger_reconciliation_cursor(id) VALUES(1);
