package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import java.util.List;

/** A package-private constructor restricts historical-price execution to the durable work runner. */
public final class RiskReplayPermit {
    private final long accountId;private final List<LatestMarkPrice> prices;
    RiskReplayPermit(long accountId,LatestMarkPrice price){this(accountId,List.of(price));}
    RiskReplayPermit(long accountId,List<LatestMarkPrice> prices){
        this.accountId=accountId;this.prices=List.copyOf(prices);
        if(this.prices.isEmpty()||this.prices.size()>8)throw new IllegalArgumentException("One to eight ordered received prices required");
    }
    public long accountId(){return accountId;}
    public LatestMarkPrice price(){return prices.get(0);}
    public List<LatestMarkPrice> prices(){return prices;}
}
