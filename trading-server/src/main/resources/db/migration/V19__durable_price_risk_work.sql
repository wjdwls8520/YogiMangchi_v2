-- Offline Trading cutover. Redis remains a cache/fanout; received risk evidence is durable here.
CREATE TABLE risk_price_event (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_key VARCHAR(80) NOT NULL UNIQUE,
 kind VARCHAR(24) NOT NULL CHECK(kind IN ('PRICE','RECONNECTING','UNAVAILABLE','INGRESS_GAP')),
 payload JSONB NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE risk_price_head (
 trading_symbol_id BIGINT PRIMARY KEY REFERENCES trading_symbol(id),
 event_id BIGINT NOT NULL REFERENCES risk_price_event(id),
 received_at TIMESTAMPTZ NOT NULL,event_time TIMESTAMPTZ NOT NULL
);
CREATE TABLE risk_account_work (
 event_id BIGINT NOT NULL REFERENCES risk_price_event(id),
 account_id BIGINT NOT NULL REFERENCES trading_account(id),
 round_id BIGINT REFERENCES member_trading_round(id),
 guest_generation BIGINT,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DONE','HELD','RETIRED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 retry_limit INTEGER NOT NULL DEFAULT 3 CHECK(retry_limit>=3),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 completed_at TIMESTAMPTZ,completion_reason VARCHAR(48),
 PRIMARY KEY(account_id,event_id)
);
CREATE INDEX risk_work_pending ON risk_account_work(event_id,account_id) WHERE status='PENDING';
CREATE TABLE risk_work_attempt (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id BIGINT NOT NULL,event_id BIGINT NOT NULL,
 attempt_number INTEGER NOT NULL,error_code VARCHAR(48) NOT NULL,failed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,event_id) REFERENCES risk_account_work(account_id,event_id)
);
CREATE TABLE risk_hold (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id BIGINT NOT NULL REFERENCES trading_account(id),
 trading_symbol_id BIGINT REFERENCES trading_symbol(id),
 event_id BIGINT REFERENCES risk_price_event(id),
 reason VARCHAR(48) NOT NULL,
 evidence JSONB NOT NULL,
 held_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 resolved_at TIMESTAMPTZ,resolution_reference VARCHAR(500),
 CHECK((resolved_at IS NULL AND resolution_reference IS NULL) OR (resolved_at IS NOT NULL AND length(resolution_reference)>=8))
);
CREATE INDEX risk_active_hold ON risk_hold(account_id,event_id) WHERE resolved_at IS NULL;
CREATE TABLE risk_dispatch_cursor(id SMALLINT PRIMARY KEY CHECK(id=1),event_id BIGINT NOT NULL DEFAULT 0,price_book JSONB NOT NULL DEFAULT '{}');
INSERT INTO risk_dispatch_cursor(id) VALUES(1);
CREATE UNIQUE INDEX risk_hold_scope_active ON risk_hold(account_id,coalesce(trading_symbol_id,0),reason) WHERE resolved_at IS NULL;
