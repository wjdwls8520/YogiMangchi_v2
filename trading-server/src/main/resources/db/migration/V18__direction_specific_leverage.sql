-- Offline cutover: stop every old Trading application/worker; mixed versions are unsupported.
-- Preserve historical position/order/fill amounts; copy only the configuration to each direction.
LOCK TABLE symbol_leverage IN ACCESS EXCLUSIVE MODE;
ALTER TABLE symbol_leverage ADD COLUMN side VARCHAR(5);
UPDATE symbol_leverage SET side='LONG';
ALTER TABLE symbol_leverage DROP CONSTRAINT symbol_leverage_account_id_trading_symbol_id_key;
INSERT INTO symbol_leverage(account_id,trading_symbol_id,side,leverage,updated_at)
SELECT account_id,trading_symbol_id,'SHORT',leverage,updated_at FROM symbol_leverage;
ALTER TABLE symbol_leverage ALTER COLUMN side SET NOT NULL;
ALTER TABLE symbol_leverage ADD CONSTRAINT symbol_leverage_side_check CHECK(side IN ('LONG','SHORT'));
ALTER TABLE symbol_leverage ADD CONSTRAINT symbol_leverage_direction_unique UNIQUE(account_id,trading_symbol_id,side);
