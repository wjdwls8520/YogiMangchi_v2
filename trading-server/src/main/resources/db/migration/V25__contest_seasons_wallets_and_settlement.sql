-- V25: Seasonal Contest Trading, MOCK vs CONTEST Wallet Separation, and Chunk-500 Settlement Pipeline

CREATE TABLE contest_season (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(2000) NOT NULL DEFAULT '',
    seed_money NUMERIC(38, 18) NOT NULL DEFAULT 10000 CHECK (seed_money > 0),
    recruitment_start_at TIMESTAMPTZ NOT NULL,
    recruitment_end_at TIMESTAMPTZ NOT NULL,
    contest_start_at TIMESTAMPTZ NOT NULL,
    contest_end_at TIMESTAMPTZ NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_canceled BOOLEAN NOT NULL DEFAULT false,
    settled_at TIMESTAMPTZ NULL,
    created_by_member_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_contest_season_auto_settle
    ON contest_season (contest_end_at, id)
    WHERE settled_at IS NULL AND is_canceled = false;

ALTER TABLE trading_account
    ADD COLUMN account_type VARCHAR(16) NOT NULL DEFAULT 'MOCK',
    ADD COLUMN contest_season_id BIGINT NULL REFERENCES contest_season(id);

ALTER TABLE trading_account DROP CONSTRAINT IF EXISTS trading_account_member_id_key;

CREATE UNIQUE INDEX uq_trading_account_member_mock
    ON trading_account (member_id)
    WHERE account_type = 'MOCK' AND member_id IS NOT NULL;

CREATE UNIQUE INDEX uq_trading_account_member_contest_season
    ON trading_account (member_id, contest_season_id)
    WHERE account_type = 'CONTEST' AND member_id IS NOT NULL AND contest_season_id IS NOT NULL;

CREATE INDEX idx_trading_account_contest_season
    ON trading_account (contest_season_id, id)
    WHERE account_type = 'CONTEST';

ALTER TABLE trading_account ADD CONSTRAINT trading_account_type_check CHECK (
    (account_type = 'MOCK' AND contest_season_id IS NULL)
    OR (account_type = 'CONTEST' AND NOT guest_account AND member_id IS NOT NULL AND contest_season_id IS NOT NULL)
);

-- Contest accounts do not use MOCK member_trading_round rows; their round_id remains NULL like Guest accounts.
CREATE OR REPLACE FUNCTION assign_member_round() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE rid BIGINT; guest BOOLEAN; acct_type VARCHAR(16);
BEGIN
 IF TG_TABLE_NAME IN ('fill','trading_event') THEN
   IF TG_TABLE_NAME='trading_event' THEN
     IF NEW.order_id IS NULL THEN
       SELECT round_id INTO rid FROM position WHERE id=NEW.position_id AND account_id=NEW.account_id;
       IF NOT FOUND THEN RAISE EXCEPTION 'Owned stop loss position required'; END IF;
     ELSE
       SELECT round_id INTO rid FROM trading_order WHERE id=NEW.order_id;
     END IF;
   ELSE
     SELECT round_id INTO rid FROM trading_order WHERE id=NEW.order_id;
   END IF;
 ELSE
   SELECT guest_account, account_type INTO guest, acct_type FROM trading_account WHERE id=NEW.account_id;
   IF guest OR acct_type = 'CONTEST' THEN rid:=NULL;
   ELSE
     SELECT id INTO rid FROM member_trading_round WHERE account_id=NEW.account_id AND status='ACTIVE';
     IF rid IS NULL THEN RAISE EXCEPTION 'Active member round required'; END IF;
   END IF;
 END IF;
 IF NEW.round_id IS NOT NULL AND NEW.round_id IS DISTINCT FROM rid THEN RAISE EXCEPTION 'Invalid financial round'; END IF;
 IF TG_TABLE_NAME='fill' AND rid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM member_trading_round WHERE id=rid AND status='ACTIVE') THEN RAISE EXCEPTION 'Completed round cannot receive a new fill'; END IF;
 NEW.round_id:=rid;
 RETURN NEW;
END $$;

ALTER TABLE position DROP CONSTRAINT position_close_state;
ALTER TABLE position ADD CONSTRAINT position_close_state CHECK (
 ((close_reason IS NULL OR (close_reason = 'CONTEST_SETTLEMENT' AND status = 'LIQUIDATED')) AND (
 (status='OPEN' AND quantity>0 AND margin>0 AND entry_notional>0 AND closed_at IS NULL AND exit_price IS NULL AND merged_into_position_id IS NULL) OR
 (status IN ('CLOSED','LIQUIDATED') AND quantity=0 AND margin=0 AND entry_notional=0 AND closed_at IS NOT NULL AND exit_price IS NOT NULL AND exit_price>0 AND merged_into_position_id IS NULL) OR
 (status='MERGED' AND merged_into_position_id IS NOT NULL AND merged_into_position_id<>id))) OR
 (close_reason IN ('MEMBER_WITHDRAWAL','GUEST_RETRY','MEMBER_RESTART') AND status='CLOSED' AND quantity=0 AND margin=0 AND entry_notional=0 AND reserved_close_quantity=0 AND closed_at IS NOT NULL AND exit_price IS NULL AND merged_into_position_id IS NULL));

CREATE TABLE contest_application (
    id BIGSERIAL PRIMARY KEY,
    contest_season_id BIGINT NOT NULL REFERENCES contest_season(id),
    member_id BIGINT NOT NULL,
    nickname VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reject_reason VARCHAR(500) NULL,
    applied_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NULL,
    processed_by_member_id BIGINT NULL,
    UNIQUE (contest_season_id, member_id)
);

CREATE INDEX idx_contest_application_season_status ON contest_application (contest_season_id, status, id DESC);
CREATE INDEX idx_contest_application_member ON contest_application (member_id, id DESC);

CREATE TABLE contest_participant (
    id BIGSERIAL PRIMARY KEY,
    contest_season_id BIGINT NOT NULL REFERENCES contest_season(id),
    member_id BIGINT NOT NULL,
    nickname VARCHAR(32) NOT NULL,
    account_id BIGINT NOT NULL UNIQUE REFERENCES trading_account(id),
    seed_money NUMERIC(38, 18) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL,
    approved_by_member_id BIGINT NULL,
    final_balance NUMERIC(38, 18) NULL,
    final_realized_pnl NUMERIC(38, 18) NULL,
    final_roi_pct NUMERIC(20, 4) NULL,
    final_rank INT NULL,
    settled_at TIMESTAMPTZ NULL,
    UNIQUE (contest_season_id, member_id)
);

CREATE INDEX idx_contest_participant_season_rank ON contest_participant (contest_season_id, final_rank ASC, id ASC);
CREATE INDEX idx_contest_participant_member ON contest_participant (member_id, contest_season_id DESC);

CREATE TABLE contest_settlement_price_snapshot (
    id BIGSERIAL PRIMARY KEY,
    contest_season_id BIGINT NOT NULL REFERENCES contest_season(id),
    trading_symbol_id BIGINT NOT NULL REFERENCES trading_symbol(id),
    settlement_price NUMERIC(38, 18) NOT NULL CHECK (settlement_price > 0),
    captured_at TIMESTAMPTZ NOT NULL,
    UNIQUE (contest_season_id, trading_symbol_id)
);

CREATE TABLE contest_settlement_run (
    id BIGSERIAL PRIMARY KEY,
    contest_season_id BIGINT NOT NULL REFERENCES contest_season(id),
    attempt_no INT NOT NULL,
    triggered_by VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    last_completed_phase VARCHAR(48) NOT NULL,
    deactivated_wallet_count INT NOT NULL DEFAULT 0,
    canceled_order_count INT NOT NULL DEFAULT 0,
    liquidated_position_count INT NOT NULL DEFAULT 0,
    finalized_participant_count INT NOT NULL DEFAULT 0,
    failure_reason VARCHAR(1000) NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_contest_settlement_run_season ON contest_settlement_run (contest_season_id, id DESC);
