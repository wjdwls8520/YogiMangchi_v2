CREATE TABLE trading_symbol (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    quote_asset VARCHAR(20) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    provider_symbol VARCHAR(40) NOT NULL,
    status VARCHAR(16) NOT NULL,
    CONSTRAINT uq_trading_symbol_pair UNIQUE (symbol, quote_asset),
    CONSTRAINT uq_trading_symbol_provider UNIQUE (provider, provider_symbol),
    CONSTRAINT ck_trading_symbol_name CHECK (length(btrim(name)) > 0 AND name = btrim(name)),
    CONSTRAINT ck_trading_symbol_symbol CHECK (symbol ~ '^[A-Z0-9]+$'),
    CONSTRAINT ck_trading_symbol_quote_asset CHECK (quote_asset = 'USDT'),
    CONSTRAINT ck_trading_symbol_provider CHECK (provider IN ('BINANCE')),
    CONSTRAINT ck_trading_symbol_provider_symbol CHECK (provider_symbol ~ '^[A-Z0-9]+$'),
    CONSTRAINT ck_trading_symbol_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
