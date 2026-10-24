package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import java.util.Objects;

/** A package-private constructor restricts historical-price execution to the durable work runner. */
public final class RiskReplayPermit {
    private final long accountId;private final LatestMarkPrice price;
    RiskReplayPermit(long accountId,LatestMarkPrice price){this.accountId=accountId;this.price=Objects.requireNonNull(price);}
    public long accountId(){return accountId;}
    public LatestMarkPrice price(){return price;}
}
