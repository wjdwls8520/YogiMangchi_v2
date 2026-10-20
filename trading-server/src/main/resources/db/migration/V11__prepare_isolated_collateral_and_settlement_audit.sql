-- Offline writer cutover: stop all old Trading instances/workers before applying.
-- Existing OPEN Cross exposures are NOT silently declared safe or closed by this migration.
LOCK TABLE trading_account, wallet, position, trading_order, fill, symbol_leverage IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM wallet w WHERE w.balance < w.used_margin + w.reserved_margin
        OR w.used_margin <> COALESCE((SELECT sum(p.margin) FROM position p WHERE p.account_id=w.account_id AND p.status='OPEN'),0)
        OR w.reserved_margin <> COALESCE((SELECT sum(o.reserved_margin) FROM trading_order o WHERE o.account_id=w.account_id AND o.status='PENDING' AND o.action='OPEN'),0))
    OR EXISTS (SELECT 1 FROM position p WHERE p.status='OPEN' AND p.reserved_close_quantity <>
        COALESCE((SELECT sum(o.quantity) FROM trading_order o WHERE o.position_id=p.id AND o.status='PENDING' AND o.action='CLOSE'),0))
    OR EXISTS (SELECT 1 FROM trading_order o JOIN position p ON p.id=o.position_id
        WHERE o.status='PENDING' AND o.action='CLOSE'
        AND (p.status<>'OPEN' OR p.account_id<>o.account_id OR p.trading_symbol_id<>o.trading_symbol_id OR p.side<>o.side))
    OR EXISTS (SELECT 1 FROM position p LEFT JOIN wallet w ON w.account_id=p.account_id
        WHERE p.status='OPEN' AND w.account_id IS NULL)
    OR EXISTS (SELECT 1 FROM trading_order o LEFT JOIN wallet w ON w.account_id=o.account_id
        WHERE o.status='PENDING' AND w.account_id IS NULL)
    OR EXISTS (SELECT 1 FROM position p LEFT JOIN symbol_leverage l ON l.account_id=p.account_id AND l.trading_symbol_id=p.trading_symbol_id
        WHERE p.status='OPEN' AND (l.id IS NULL OR l.leverage<>p.leverage))
    OR EXISTS (SELECT 1 FROM trading_order o LEFT JOIN symbol_leverage l ON l.account_id=o.account_id AND l.trading_symbol_id=o.trading_symbol_id
        WHERE o.status='PENDING' AND o.action='OPEN' AND (l.id IS NULL OR l.leverage<>o.leverage))
    OR EXISTS (SELECT 1 FROM trading_order o LEFT JOIN fill f ON f.order_id=o.id
        WHERE o.status='FILLED' AND (f.id IS NULL OR f.quantity<>o.quantity OR f.price<>o.filled_price))
    THEN RAISE EXCEPTION 'Isolated cutover: inconsistent or unfunded legacy ledger; explicit reconciliation required'; END IF;
END $$;

ALTER TABLE trading_account ADD COLUMN margin_transition_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE trading_account ADD COLUMN isolated_activated_at TIMESTAMPTZ;
UPDATE trading_account a SET margin_transition_status='COMPLETE',isolated_activated_at=now()
WHERE NOT EXISTS (SELECT 1 FROM position p WHERE p.account_id=a.id AND p.status='OPEN');
ALTER TABLE trading_account ALTER COLUMN margin_transition_status SET DEFAULT 'COMPLETE';
ALTER TABLE trading_account ALTER COLUMN isolated_activated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE trading_account ADD CONSTRAINT account_margin_transition_check CHECK (
    (margin_transition_status='COMPLETE' AND isolated_activated_at IS NOT NULL)
    OR (margin_transition_status IN ('PENDING','REVIEW_REQUIRED') AND isolated_activated_at IS NULL));

-- Preserve the original financial model of historical facts. New executions use ISOLATED.
ALTER TABLE position ADD COLUMN opened_margin_mode VARCHAR(8) NOT NULL DEFAULT 'CROSS' CHECK (opened_margin_mode IN ('CROSS','ISOLATED'));
ALTER TABLE position ALTER COLUMN opened_margin_mode SET DEFAULT 'ISOLATED';
ALTER TABLE position ADD COLUMN isolated_cutover_margin NUMERIC(38,18);
ALTER TABLE position ADD COLUMN isolated_cutover_price NUMERIC(38,18);
ALTER TABLE position ADD COLUMN isolated_cutover_at TIMESTAMPTZ;
ALTER TABLE position ADD CONSTRAINT position_isolated_cutover_check CHECK (
    (isolated_cutover_margin IS NULL AND isolated_cutover_price IS NULL AND isolated_cutover_at IS NULL)
    OR (isolated_cutover_margin IS NOT NULL AND isolated_cutover_price IS NOT NULL
        AND isolated_cutover_margin>0 AND isolated_cutover_price>0 AND isolated_cutover_at IS NOT NULL));

ALTER TABLE trading_order ADD COLUMN submitted_margin_mode VARCHAR(8) NOT NULL DEFAULT 'CROSS' CHECK (submitted_margin_mode IN ('CROSS','ISOLATED'));
ALTER TABLE trading_order ALTER COLUMN submitted_margin_mode SET DEFAULT 'ISOLATED';
ALTER TABLE fill ADD COLUMN margin_mode VARCHAR(8) NOT NULL DEFAULT 'CROSS' CHECK (margin_mode IN ('CROSS','ISOLATED'));
ALTER TABLE fill ALTER COLUMN margin_mode SET DEFAULT 'ISOLATED';
ALTER TABLE fill ADD COLUMN fee NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (fee>=0);
ALTER TABLE fill ADD COLUMN settlement_adjustment NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (settlement_adjustment>=0);
ALTER TABLE wallet ADD COLUMN fees_paid NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (fees_paid>=0);
ALTER TABLE wallet ADD COLUMN settlement_adjustment NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (settlement_adjustment>=0);
