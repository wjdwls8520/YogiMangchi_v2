-- Read-only V22 preflight. Run against the intended DB before stopping old Trading writers/workers.
-- Returns only missing settings or inconsistencies; no rows means no exposure backfill is needed.
-- CONFLICT_REVIEW_REQUIRED blocks V22. SETTING_EXPOSURE_MISMATCH also needs investigation;
-- V22 never rewrites an existing setting or reallocates collateral to repair inconsistent data.
WITH exposure AS (
    SELECT account_id,trading_symbol_id,side,leverage FROM trading.position WHERE status='OPEN'
    UNION ALL
    SELECT account_id,trading_symbol_id,side,leverage FROM trading.trading_order
    WHERE status='PENDING' AND action='OPEN'
), scoped AS (
    SELECT account_id,trading_symbol_id,side,array_agg(DISTINCT leverage ORDER BY leverage) AS exposure_leverages
    FROM exposure GROUP BY account_id,trading_symbol_id,side
)
SELECT e.account_id,e.trading_symbol_id,e.side,e.exposure_leverages,s.leverage AS saved_leverage,
    CASE WHEN cardinality(e.exposure_leverages)>1 THEN 'CONFLICT_REVIEW_REQUIRED'
         WHEN s.id IS NOT NULL THEN 'SETTING_EXPOSURE_MISMATCH'
         ELSE 'PRESERVE_EXPOSURE' END AS cutover_action
FROM scoped e LEFT JOIN trading.symbol_leverage s
    ON s.account_id=e.account_id AND s.trading_symbol_id=e.trading_symbol_id AND s.side=e.side
WHERE s.id IS NULL OR cardinality(e.exposure_leverages)>1 OR s.leverage<>e.exposure_leverages[1]
ORDER BY e.account_id,e.trading_symbol_id,e.side;
