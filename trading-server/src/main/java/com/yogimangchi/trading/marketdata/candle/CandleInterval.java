package com.yogimangchi.trading.marketdata.candle;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Duration;
import java.util.Arrays;

public enum CandleInterval {
    ONE_MINUTE("1m", "1m", 1), THREE_MINUTES("3m", "3m", 3), FIVE_MINUTES("5m", "5m", 5),
    FIFTEEN_MINUTES("15m", "15m", 15), THIRTY_MINUTES("30m", "30m", 30),
    ONE_HOUR("1h", "1h", 60), FOUR_HOURS("4h", "4h", 240), TWELVE_HOURS("12h", "12h", 720),
    ONE_DAY("24h", "1d", 1440);

    private final String value;
    private final String providerValue;
    private final Duration duration;

    CandleInterval(String value, String providerValue, int minutes) {
        this.value = value; this.providerValue = providerValue; this.duration = Duration.ofMinutes(minutes);
    }
    public String value() { return value; }
    public String providerValue() { return providerValue; }
    public long millis() { return duration.toMillis(); }

    public static CandleInterval parse(String value) {
        return Arrays.stream(values()).filter(interval -> interval.value.equals(value)).findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_CANDLE_REQUEST));
    }
}
