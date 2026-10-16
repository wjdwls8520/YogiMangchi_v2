package com.yogimangchi.trading.tradingaccount.service;

import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;

class UnusedGuestCleanupSchedulerTests {
    @Test void disabledSchedulerDoesNothingAndBatchFailureDoesNotPreventTheNextRun() {
        var cleanup = mock(UnusedGuestCleanupService.class);
        var scheduler = new UnusedGuestCleanupScheduler(cleanup, false);
        scheduler.start(); scheduler.start(); scheduler.close();
        verifyNoInteractions(cleanup);
        when(cleanup.cleanupBatch()).thenThrow(new IllegalStateException("test rollback")).thenReturn(1);
        var retry = new UnusedGuestCleanupScheduler(cleanup, false);
        try { retry.runBatch(); retry.runBatch(); verify(cleanup, times(2)).cleanupBatch(); }
        finally { retry.close(); }
    }
}
