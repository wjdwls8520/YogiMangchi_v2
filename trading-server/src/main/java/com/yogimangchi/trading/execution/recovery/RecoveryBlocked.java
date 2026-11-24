package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.error.*;
import java.time.Instant;

public final class RecoveryBlocked extends BusinessException {
    private final Long eventId;private final Instant referenceTime;
    public RecoveryBlocked(ErrorCode code,Long eventId,Instant referenceTime){super(code);this.eventId=eventId;this.referenceTime=referenceTime;}
    public Long eventId(){return eventId;}
    public Instant referenceTime(){return referenceTime;}
}
