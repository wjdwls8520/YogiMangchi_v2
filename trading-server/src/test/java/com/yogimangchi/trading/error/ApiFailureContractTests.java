package com.yogimangchi.trading.error;

import com.yogimangchi.trading.execution.recovery.RecoveryBlocked;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class ApiFailureContractTests {
    @Test void admissionRejectsThisAttemptWithoutClaimingTheEarlierKeyWasNeverCommitted() {
        for (var code:java.util.List.of(ErrorCode.TRADING_BUSY,ErrorCode.ENGINE_RECOVERING)) {
            var response=new ApiExceptionHandler().handleBusinessException(new BusinessException(code));
            assertThat(response.getProperties()).containsEntry("outcome","UNKNOWN").containsEntry("attemptOutcome","NOT_ACCEPTED");
        }
    }
    @Test void recoveryRejectionCarriesSafeReferenceAndDefinitiveNonAcceptance() {
        var time=Instant.parse("2026-10-24T00:00:00Z");
        var response=new ApiExceptionHandler().handleBusinessException(new RecoveryBlocked(ErrorCode.ACCOUNT_RISK_PENDING,42L,time));
        assertThat(response.getProperties()).containsEntry("code","ACCOUNT_RISK_PENDING").containsEntry("outcome","NOT_ACCEPTED")
            .containsEntry("riskEventId",42L).containsEntry("referenceTime",time);
    }
    @Test void unexpectedFailureDoesNotLeakInternalCauseOrPretendDefinitiveRejection() {
        var response=new ApiExceptionHandler().handleUnexpectedException(new IllegalStateException("private SQL implementation detail"));
        assertThat(response.getProperties()).containsEntry("code","INTERNAL_ERROR").containsEntry("outcome","UNKNOWN");
        assertThat(response.getProperties()).doesNotContainKey("attemptOutcome");
        assertThat(response.getDetail()).doesNotContain("SQL","IllegalStateException","private");
    }
}
