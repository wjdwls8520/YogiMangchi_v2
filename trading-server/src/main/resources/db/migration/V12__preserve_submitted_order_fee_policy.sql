-- Existing executions and fee-free pending contracts are immutable. No retroactive fee/reservation change.
-- New application-created orders explicitly snapshot their MARKET/LIMIT rate.
ALTER TABLE trading_order ADD COLUMN fee_rate NUMERIC(8,6) NOT NULL DEFAULT 0
    CHECK (fee_rate IN (0, 0.0003, 0.0005));
