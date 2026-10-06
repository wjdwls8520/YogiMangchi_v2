-- Verified against Binance USD-M Futures /fapi/v1/exchangeInfo on 2026-10-07.
-- All contracts: PERPETUAL, TRADING, quoteAsset=USDT, marginAsset=USDT.
-- Applied once by Flyway. Never reset operational status/mapping on application restart.
INSERT INTO trading_symbol (name, symbol, quote_asset, provider, provider_symbol, status)
VALUES
    ('Bitcoin', 'BTC', 'USDT', 'BINANCE', 'BTCUSDT', 'ACTIVE'),
    ('Ethereum', 'ETH', 'USDT', 'BINANCE', 'ETHUSDT', 'ACTIVE'),
    ('XRP', 'XRP', 'USDT', 'BINANCE', 'XRPUSDT', 'ACTIVE'),
    ('BNB', 'BNB', 'USDT', 'BINANCE', 'BNBUSDT', 'ACTIVE'),
    ('Solana', 'SOL', 'USDT', 'BINANCE', 'SOLUSDT', 'ACTIVE'),
    ('Cardano', 'ADA', 'USDT', 'BINANCE', 'ADAUSDT', 'ACTIVE'),
    ('Chainlink', 'LINK', 'USDT', 'BINANCE', 'LINKUSDT', 'ACTIVE'),
    ('Avalanche', 'AVAX', 'USDT', 'BINANCE', 'AVAXUSDT', 'ACTIVE'),
    ('Sui', 'SUI', 'USDT', 'BINANCE', 'SUIUSDT', 'ACTIVE'),
    ('Dogecoin', 'DOGE', 'USDT', 'BINANCE', 'DOGEUSDT', 'ACTIVE'),
    ('Pepe', 'PEPE', 'USDT', 'BINANCE', '1000PEPEUSDT', 'ACTIVE'),
    ('Shiba Inu', 'SHIB', 'USDT', 'BINANCE', '1000SHIBUSDT', 'ACTIVE');
