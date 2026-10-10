-- Verified via Binance USD-M /fapi/v1/exchangeInfo on 2026-10-08:
-- 1000PEPEUSDT baseAsset=1000PEPE, 1000SHIBUSDT baseAsset=1000SHIB; quoteAsset=USDT.
-- One provider base unit contains provider_unit_multiplier domain base units.
ALTER TABLE trading_symbol ADD COLUMN provider_unit_multiplier BIGINT;

UPDATE trading_symbol SET provider_unit_multiplier = 1
WHERE provider = 'BINANCE' AND provider_symbol = symbol || quote_asset;

UPDATE trading_symbol SET provider_unit_multiplier = 1000
WHERE provider = 'BINANCE' AND quote_asset = 'USDT'
  AND ((symbol = 'PEPE' AND provider_symbol = '1000PEPEUSDT')
    OR (symbol = 'SHIB' AND provider_symbol = '1000SHIBUSDT'));

-- Fail transactionally rather than guess a multiplier for an unverified custom mapping.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM trading_symbol WHERE provider_unit_multiplier IS NULL) THEN
        RAISE EXCEPTION 'Unverified provider mapping: verify contract units before applying V3';
    END IF;
END $$;

ALTER TABLE trading_symbol ALTER COLUMN provider_unit_multiplier SET NOT NULL;
ALTER TABLE trading_symbol ADD CONSTRAINT ck_trading_symbol_provider_unit_multiplier
    CHECK (provider_unit_multiplier > 0);
-- No default: new registrations must explicitly supply a verified multiplier.
