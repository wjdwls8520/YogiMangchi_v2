ALTER TABLE position ADD COLUMN reserved_close_quantity NUMERIC(28,8) NOT NULL DEFAULT 0;
ALTER TABLE position ADD CONSTRAINT position_close_reservation_check
    CHECK (reserved_close_quantity>=0 AND reserved_close_quantity<=quantity);

ALTER TABLE trading_order DROP CONSTRAINT order_limit_state;
ALTER TABLE trading_order DROP CONSTRAINT order_execution_state;
ALTER TABLE trading_order ADD CONSTRAINT order_limit_state CHECK (
    (type='MARKET' AND limit_price IS NULL AND status='FILLED') OR
    (type='LIMIT' AND action IN ('OPEN','CLOSE') AND limit_price IS NOT NULL AND limit_price>0));
ALTER TABLE trading_order ADD CONSTRAINT order_execution_state CHECK (
    (status='FILLED' AND position_id IS NOT NULL AND filled_price IS NOT NULL AND completed_at IS NOT NULL AND reserved_margin=0) OR
    (status='PENDING' AND filled_price IS NULL AND completed_at IS NULL AND
        ((action='OPEN' AND position_id IS NULL AND reserved_margin>0) OR
         (action='CLOSE' AND position_id IS NOT NULL AND reserved_margin=0))) OR
    (status IN ('CANCELED','REJECTED') AND filled_price IS NULL AND completed_at IS NOT NULL AND reserved_margin=0 AND
        ((action='OPEN' AND position_id IS NULL) OR (action='CLOSE' AND position_id IS NOT NULL))));

DROP INDEX order_pending_trigger_idx;
CREATE INDEX order_pending_trigger_idx ON trading_order(trading_symbol_id,action,side,limit_price,account_id) WHERE status='PENDING';
