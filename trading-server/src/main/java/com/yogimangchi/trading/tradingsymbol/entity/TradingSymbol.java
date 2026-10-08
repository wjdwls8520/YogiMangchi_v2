package com.yogimangchi.trading.tradingsymbol.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.Objects;
import java.math.BigDecimal;

@Entity
@Table(name = "trading_symbol")
public class TradingSymbol {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 20, updatable = false)
    private String symbol;

    @Column(nullable = false, length = 20, updatable = false)
    private String quoteAsset;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20, updatable = false)
    private TradingSymbolProvider provider;

    @Column(nullable = false, length = 40)
    private String providerSymbol;

    @Column(nullable = false)
    private long providerUnitMultiplier;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TradingSymbolStatus status;

    protected TradingSymbol() {
    }

    private TradingSymbol(String name, String symbol, String quoteAsset,
                          TradingSymbolProvider provider, String providerSymbol, long providerUnitMultiplier) {
        if (name == null || name.isBlank() || name.length() > 100 || !name.equals(name.strip())) {
            throw new IllegalArgumentException("name must be non-blank, trimmed, and at most 100 characters");
        }
        requireSymbol(symbol, 20, "symbol");
        if (!"USDT".equals(quoteAsset)) {
            throw new IllegalArgumentException("quoteAsset must be USDT");
        }
        requireSymbol(providerSymbol, 40, "providerSymbol");
        requireProviderUnitMultiplier(providerUnitMultiplier);
        this.name = name;
        this.symbol = symbol;
        this.quoteAsset = quoteAsset;
        this.provider = Objects.requireNonNull(provider, "provider must not be null");
        this.providerSymbol = providerSymbol;
        this.providerUnitMultiplier = providerUnitMultiplier;
        this.status = TradingSymbolStatus.INACTIVE;
    }

    public static TradingSymbol register(String name, String symbol, String quoteAsset,
                                         TradingSymbolProvider provider, String providerSymbol, long providerUnitMultiplier) {
        return new TradingSymbol(name, symbol, quoteAsset, provider, providerSymbol, providerUnitMultiplier);
    }

    // Future administration must verify provider metadata and existing trading state before activation.
    public void activate() {
        this.status = TradingSymbolStatus.ACTIVE;
    }

    public void deactivate() {
        this.status = TradingSymbolStatus.INACTIVE;
    }

    public void changeProviderMapping(String providerSymbol, long providerUnitMultiplier) {
        requireSymbol(providerSymbol, 40, "providerSymbol");
        requireProviderUnitMultiplier(providerUnitMultiplier);
        this.providerSymbol = providerSymbol;
        this.providerUnitMultiplier = providerUnitMultiplier;
    }

    public static void requireProviderUnitMultiplier(long multiplier) {
        if (multiplier <= 0) {
            throw new IllegalArgumentException("providerUnitMultiplier must be positive");
        }
        try {
            BigDecimal.ONE.divide(BigDecimal.valueOf(multiplier));
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("providerUnitMultiplier must permit exact decimal normalization", exception);
        }
    }

    private static void requireSymbol(String value, int maxLength, String field) {
        if (value == null || value.length() > maxLength || !value.matches("[A-Z0-9]+")) {
            throw new IllegalArgumentException(field + " must contain uppercase letters/digits within its length limit");
        }
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getSymbol() { return symbol; }
    public String getQuoteAsset() { return quoteAsset; }
    public TradingSymbolProvider getProvider() { return provider; }
    public String getProviderSymbol() { return providerSymbol; }
    public long getProviderUnitMultiplier() { return providerUnitMultiplier; }
    public TradingSymbolStatus getStatus() { return status; }
}
