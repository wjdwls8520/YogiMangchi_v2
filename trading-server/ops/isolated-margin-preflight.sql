-- V10 Cross ledger structural inspection ONLY. This is not a migration or an approval.
-- Run with psql -X -v ON_ERROR_STOP=1 -f ops/isolated-margin-preflight.sql.
-- No credentials, account identifiers or individual balances are returned.
-- Missing tables/columns fail closed. Use a role with SELECT access to trading.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = trading, pg_catalog;

WITH open_positions AS (
    SELECT * FROM position WHERE status = 'OPEN'
), pending_orders AS (
    SELECT * FROM trading_order WHERE status = 'PENDING'
), violations AS (
    SELECT
        (SELECT count(*) FROM wallet w
         WHERE w.used_margin <> COALESCE((SELECT sum(p.margin) FROM open_positions p WHERE p.account_id = w.account_id), 0)
            OR w.reserved_margin <> COALESCE((SELECT sum(o.reserved_margin) FROM pending_orders o
                                             WHERE o.account_id = w.account_id AND o.action = 'OPEN'), 0)) AS wallet_total_mismatches,
        (SELECT count(*) FROM wallet WHERE balance < used_margin + reserved_margin) AS unfunded_wallets,
        (SELECT count(*) FROM open_positions p
         WHERE p.reserved_close_quantity <> COALESCE((SELECT sum(o.quantity) FROM pending_orders o
                                                      WHERE o.position_id = p.id AND o.action = 'CLOSE'), 0)) AS close_quantity_mismatches,
        (SELECT count(*) FROM pending_orders o LEFT JOIN position p ON p.id = o.position_id
         WHERE o.action = 'CLOSE' AND (p.id IS NULL OR p.status <> 'OPEN' OR p.account_id <> o.account_id
                                      OR p.trading_symbol_id <> o.trading_symbol_id OR p.side <> o.side)) AS invalid_close_targets,
        (SELECT count(*) FROM open_positions p LEFT JOIN symbol_leverage l
             ON l.account_id = p.account_id AND l.trading_symbol_id = p.trading_symbol_id
         WHERE l.id IS NULL OR p.leverage <> l.leverage) AS position_leverage_mismatches,
        (SELECT count(*) FROM pending_orders o LEFT JOIN symbol_leverage l
             ON l.account_id = o.account_id AND l.trading_symbol_id = o.trading_symbol_id
         WHERE o.action = 'OPEN' AND (l.id IS NULL OR o.leverage <> l.leverage)) AS pending_leverage_mismatches,
        (SELECT count(*) FROM open_positions p LEFT JOIN wallet w ON w.account_id = p.account_id
         WHERE w.account_id IS NULL) AS missing_position_wallets,
        (SELECT count(*) FROM pending_orders o LEFT JOIN wallet w ON w.account_id = o.account_id
         WHERE w.account_id IS NULL) AS missing_pending_wallets,
        (SELECT count(*) FROM trading_order o LEFT JOIN fill f ON f.order_id = o.id
         WHERE o.status = 'FILLED' AND (f.id IS NULL OR f.quantity <> o.quantity OR f.price <> o.filled_price)) AS execution_fact_mismatches
)
SELECT transaction_timestamp() AS inspected_at,
       current_setting('transaction_read_only') AS inspection_read_only,
       (SELECT max(version::integer) FROM flyway_schema_history WHERE success AND version IS NOT NULL) AS schema_version,
       (SELECT count(*) FROM trading_account) AS accounts,
       (SELECT count(*) FROM open_positions) AS open_positions,
       (SELECT count(*) FROM pending_orders) AS pending_orders,
       v.*,
       'STRUCTURAL_CHECK_ONLY_NOT_MIGRATION_APPROVAL' AS scope
FROM violations v;

ROLLBACK;
