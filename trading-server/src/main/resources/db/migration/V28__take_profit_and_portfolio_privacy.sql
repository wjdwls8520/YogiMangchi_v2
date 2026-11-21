-- V28: Position Take Profit, Contest Cancellation Administrative Closure, and Member Portfolio Visibility Preference

CREATE TABLE position_take_profit (
    position_id BIGINT PRIMARY KEY REFERENCES position(id),
    account_id BIGINT NOT NULL REFERENCES trading_account(id),
    trading_symbol_id BIGINT NOT NULL REFERENCES trading_symbol(id),
    side VARCHAR(8) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
    status VARCHAR(16) NOT NULL DEFAULT 'NONE',
    take_profit_price NUMERIC(38, 18),
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at TIMESTAMPTZ,
    triggered_at TIMESTAMPTZ,
    price_event_time TIMESTAMPTZ,
    trigger_price NUMERIC(38, 18),
    trigger_order_id BIGINT REFERENCES trading_order(id),
    reason VARCHAR(32),
    CONSTRAINT position_take_profit_state CHECK (
        (status = 'NONE' AND take_profit_price IS NULL AND version = 0) OR
        (status IN ('ACTIVE', 'CANCELED', 'TRIGGERED', 'EXPIRED')
         AND take_profit_price > 0
         AND version > 0
         AND updated_at IS NOT NULL)
    )
);

CREATE INDEX idx_position_take_profit_active_account
    ON position_take_profit (account_id, trading_symbol_id)
    WHERE status = 'ACTIVE';

CREATE TABLE position_take_profit_command (
    account_id BIGINT NOT NULL REFERENCES trading_account(id),
    request_key VARCHAR(100) NOT NULL,
    position_id BIGINT NOT NULL REFERENCES position(id),
    request_fingerprint VARCHAR(64) NOT NULL,
    response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (account_id, request_key)
);

ALTER TABLE trading_event
    ADD COLUMN take_profit_version BIGINT;

ALTER TABLE trading_event DROP CONSTRAINT trading_event_event_type_check;
ALTER TABLE trading_event ADD CONSTRAINT trading_event_event_type_check CHECK (
    event_type IN (
        'ORDER_PENDING',
        'ORDER_FILLED',
        'ORDER_CANCELED',
        'ORDER_REJECTED',
        'POSITION_LIQUIDATED',
        'STOP_LOSS_CHANGED',
        'TAKE_PROFIT_CHANGED'
    )
);

ALTER TABLE trading_event DROP CONSTRAINT trading_event_source_check;
ALTER TABLE trading_event ADD CONSTRAINT trading_event_source_check CHECK (
    (event_type = 'STOP_LOSS_CHANGED'
        AND order_id IS NULL AND order_status IS NULL
        AND position_id IS NOT NULL AND stop_loss_version > 0 AND take_profit_version IS NULL)
    OR (event_type = 'TAKE_PROFIT_CHANGED'
        AND order_id IS NULL AND order_status IS NULL
        AND position_id IS NOT NULL AND take_profit_version > 0 AND stop_loss_version IS NULL)
    OR (event_type NOT IN ('STOP_LOSS_CHANGED', 'TAKE_PROFIT_CHANGED')
        AND order_id IS NOT NULL AND order_status IS NOT NULL
        AND position_id IS NULL AND stop_loss_version IS NULL AND take_profit_version IS NULL)
);

CREATE UNIQUE INDEX trading_event_take_profit_version
    ON trading_event (position_id, take_profit_version)
    WHERE event_type = 'TAKE_PROFIT_CHANGED';

ALTER TABLE position DROP CONSTRAINT position_close_state;
ALTER TABLE position ADD CONSTRAINT position_close_state CHECK (
    ((close_reason IS NULL OR (close_reason = 'CONTEST_SETTLEMENT' AND status = 'LIQUIDATED')) AND (
        (status = 'OPEN' AND quantity > 0 AND margin > 0 AND entry_notional > 0
            AND closed_at IS NULL AND exit_price IS NULL AND merged_into_position_id IS NULL)
        OR (status IN ('CLOSED', 'LIQUIDATED') AND quantity = 0 AND margin = 0 AND entry_notional = 0
            AND closed_at IS NOT NULL AND exit_price IS NOT NULL AND exit_price > 0 AND merged_into_position_id IS NULL)
        OR (status = 'MERGED' AND merged_into_position_id IS NOT NULL AND merged_into_position_id <> id)
    ))
    OR (close_reason IN ('MEMBER_WITHDRAWAL', 'GUEST_RETRY', 'MEMBER_RESTART', 'CONTEST_CANCELED')
        AND status = 'CLOSED' AND quantity = 0 AND margin = 0 AND entry_notional = 0
        AND reserved_close_quantity = 0 AND closed_at IS NOT NULL AND exit_price IS NULL
        AND merged_into_position_id IS NULL)
);

CREATE TABLE member_portfolio_preference (
    member_id BIGINT PRIMARY KEY,
    portfolio_public BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
