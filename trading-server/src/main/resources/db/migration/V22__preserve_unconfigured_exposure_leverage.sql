-- Stop old Trading writers/workers before this cutover. Never reprice existing exposure.
-- Previously the implicit 10x preference could leave OPEN/PENDING OPEN rows without a setting.
LOCK TABLE symbol_leverage, position, trading_order IN SHARE ROW EXCLUSIVE MODE;

DO $$ BEGIN
    IF EXISTS (
        SELECT e.account_id,e.trading_symbol_id,e.side
        FROM (
            SELECT account_id,trading_symbol_id,side,leverage FROM position WHERE status='OPEN'
            UNION ALL
            SELECT account_id,trading_symbol_id,side,leverage FROM trading_order
            WHERE status='PENDING' AND action='OPEN'
        ) e
        WHERE NOT EXISTS (
            SELECT 1 FROM symbol_leverage s WHERE s.account_id=e.account_id
                AND s.trading_symbol_id=e.trading_symbol_id AND s.side=e.side
        )
        GROUP BY e.account_id,e.trading_symbol_id,e.side
        HAVING count(DISTINCT e.leverage)>1
    ) THEN
        RAISE EXCEPTION 'Conflicting unconfigured exposure leverage; reconcile before default leverage cutover';
    END IF;
END $$;

INSERT INTO symbol_leverage(account_id,trading_symbol_id,side,leverage,updated_at)
SELECT e.account_id,e.trading_symbol_id,e.side,min(e.leverage),clock_timestamp()
FROM (
    SELECT account_id,trading_symbol_id,side,leverage FROM position WHERE status='OPEN'
    UNION ALL
    SELECT account_id,trading_symbol_id,side,leverage FROM trading_order
    WHERE status='PENDING' AND action='OPEN'
) e
WHERE NOT EXISTS (
    SELECT 1 FROM symbol_leverage s WHERE s.account_id=e.account_id
        AND s.trading_symbol_id=e.trading_symbol_id AND s.side=e.side
)
GROUP BY e.account_id,e.trading_symbol_id,e.side;

-- No blanket 1x UPDATE, no wallet/position/order/fill changes, and no invented historic preference.
-- With neither a saved setting nor current exposure, the application returns the implicit 1x value.
