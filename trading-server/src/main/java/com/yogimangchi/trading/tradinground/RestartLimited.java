package com.yogimangchi.trading.tradinground;
import java.time.Instant;
public class RestartLimited extends com.yogimangchi.trading.error.BusinessException {
    private final Instant next;
    public RestartLimited(Instant next) {super(com.yogimangchi.trading.error.ErrorCode.MEMBER_RESTART_LIMITED);this.next=next;}
    public Instant nextAvailableAt(){return next;}
}
