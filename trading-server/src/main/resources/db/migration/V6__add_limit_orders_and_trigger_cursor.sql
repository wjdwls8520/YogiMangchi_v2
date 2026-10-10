ALTER TABLE trading_order ALTER COLUMN position_id DROP NOT NULL;
ALTER TABLE trading_order ALTER COLUMN filled_price DROP NOT NULL;
ALTER TABLE trading_order DROP CONSTRAINT order_type_check;
ALTER TABLE trading_order DROP CONSTRAINT order_action_check;
ALTER TABLE trading_order DROP CONSTRAINT order_status_check;
ALTER TABLE trading_order ADD CONSTRAINT order_type_check CHECK (type IN ('MARKET','LIMIT'));
ALTER TABLE trading_order ADD CONSTRAINT order_action_check CHECK (action IN ('OPEN','CLOSE','LIQUIDATE'));
ALTER TABLE trading_order ADD CONSTRAINT order_status_check CHECK (status IN ('PENDING','FILLED','CANCELED','REJECTED'));
ALTER TABLE trading_order ADD COLUMN limit_price NUMERIC(38,18);
ALTER TABLE trading_order ADD COLUMN reserved_margin NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (reserved_margin >= 0);
ALTER TABLE trading_order ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE trading_order ADD COLUMN reason VARCHAR(64);
UPDATE trading_order SET completed_at=created_at;
ALTER TABLE trading_order ADD CONSTRAINT order_limit_state CHECK (
    (type='MARKET' AND limit_price IS NULL AND status='FILLED') OR
    (type='LIMIT' AND action='OPEN' AND limit_price IS NOT NULL AND limit_price>0));
ALTER TABLE trading_order ADD CONSTRAINT order_execution_state CHECK (
    (status='FILLED' AND position_id IS NOT NULL AND filled_price IS NOT NULL AND completed_at IS NOT NULL AND reserved_margin=0) OR
    (status='PENDING' AND position_id IS NULL AND filled_price IS NULL AND completed_at IS NULL AND reserved_margin>0) OR
    (status IN ('CANCELED','REJECTED') AND position_id IS NULL AND filled_price IS NULL AND completed_at IS NOT NULL AND reserved_margin=0));
DROP INDEX order_close_position_unique;
CREATE UNIQUE INDEX order_close_position_unique ON trading_order(position_id) WHERE action IN ('CLOSE','LIQUIDATE');
CREATE INDEX order_pending_trigger_idx ON trading_order(trading_symbol_id,side,limit_price,account_id) WHERE status='PENDING';
CREATE INDEX order_pending_account_idx ON trading_order(account_id,id) WHERE status='PENDING';
CREATE INDEX position_symbol_account_idx ON position(trading_symbol_id,account_id) WHERE status='OPEN';

-- Single ordered worker. Checkpoint advances only after every account transaction for an event commits.
CREATE TABLE market_trigger_cursor (
    id INTEGER PRIMARY KEY CHECK (id=1),
    stream_id VARCHAR(64) NOT NULL,
    price_book TEXT NOT NULL,
    gap_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL
);
INSERT INTO market_trigger_cursor(id,stream_id,price_book,updated_at) VALUES (1,'0-0','{}',now());
