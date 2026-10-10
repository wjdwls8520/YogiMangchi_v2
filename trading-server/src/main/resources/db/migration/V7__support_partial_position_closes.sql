-- Preserve the original lot, including already closed V4-V6 history, before changing quantity/margin to remaining values.
ALTER TABLE position ADD COLUMN initial_quantity NUMERIC(28,8);
ALTER TABLE position ADD COLUMN initial_margin NUMERIC(38,18);
UPDATE position SET initial_quantity=quantity, initial_margin=margin;
ALTER TABLE position ALTER COLUMN initial_quantity SET NOT NULL;
ALTER TABLE position ALTER COLUMN initial_margin SET NOT NULL;
ALTER TABLE position DROP CONSTRAINT position_quantity_check;
ALTER TABLE position DROP CONSTRAINT position_margin_check;
ALTER TABLE position DROP CONSTRAINT position_close_state;
UPDATE position SET quantity=0, margin=0 WHERE status<>'OPEN';
ALTER TABLE position ADD CONSTRAINT position_quantity_check CHECK (initial_quantity>0 AND quantity>=0 AND quantity<=initial_quantity);
ALTER TABLE position ADD CONSTRAINT position_margin_check CHECK (initial_margin>0 AND margin>=0 AND margin<=initial_margin);
ALTER TABLE position ADD CONSTRAINT position_close_state CHECK (
    (status='OPEN' AND quantity>0 AND margin>0 AND closed_at IS NULL AND exit_price IS NULL) OR
    (status<>'OPEN' AND quantity=0 AND margin=0 AND closed_at IS NOT NULL AND exit_price IS NOT NULL AND exit_price>0));
DROP INDEX order_close_position_unique;
-- Multiple partial CLOSE executions are valid; forced liquidation still happens once per lot.
CREATE UNIQUE INDEX order_liquidation_position_unique ON trading_order(position_id) WHERE action='LIQUIDATE';
