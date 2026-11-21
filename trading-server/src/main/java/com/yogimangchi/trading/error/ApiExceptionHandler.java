package com.yogimangchi.trading.error;

import com.yogimangchi.trading.ops.OpsAlertService;
import com.yogimangchi.trading.ops.OpsErrorBuffer;
import com.yogimangchi.trading.ops.RequestIdMdcFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private final ObjectProvider<OpsErrorBuffer> errorBuffer;
    private final ObjectProvider<OpsAlertService> alerts;

    public ApiExceptionHandler() {
        this((ObjectProvider<OpsErrorBuffer>) null, null);
    }

    public ApiExceptionHandler(ObjectProvider<OpsErrorBuffer> errorBuffer) {
        this(errorBuffer, null);
    }

    @Autowired
    public ApiExceptionHandler(
            ObjectProvider<OpsErrorBuffer> errorBuffer,
            ObjectProvider<OpsAlertService> alerts) {
        this.errorBuffer = errorBuffer;
        this.alerts = alerts;
    }

    @ExceptionHandler(RateLimitedException.class)
    public ResponseEntity<ProblemDetail> handleRateLimitedException(RateLimitedException exception) {
        ErrorCode code = exception.getCode();
        log.info("Rate limit exceeded code={} retryAfterSeconds={} reqId={}",
                code, exception.retryAfterSeconds(), currentRequestId());
        var problem = businessProblem(code);
        problem.setProperty("retryAfterSeconds", exception.retryAfterSeconds());
        recordIfDiagnostic(code.status().value(), code.name(), code.name(), null);
        return ResponseEntity.status(code.status())
                .header(HttpHeaders.RETRY_AFTER, Long.toString(exception.retryAfterSeconds()))
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(BusinessException.class)
    public ProblemDetail handleBusinessException(BusinessException exception) {
        ErrorCode code = exception.getCode();
        log.info("Business request rejected code={} reqId={}", code, currentRequestId());
        var problem = businessProblem(code);
        if (exception instanceof com.yogimangchi.trading.tradinground.RestartLimited limited) {
            problem.setProperty("nextAvailableAt", limited.nextAvailableAt());
        }
        if (exception instanceof com.yogimangchi.trading.execution.recovery.RecoveryBlocked held) {
            problem.setProperty("riskEventId", held.eventId());
            problem.setProperty("referenceTime", held.referenceTime());
            problem.setProperty("outcome", "NOT_ACCEPTED");
        }
        recordIfDiagnostic(code.status().value(), code.name(), code.name(), null);
        return problem;
    }

    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ProblemDetail handleLockConflict(PessimisticLockingFailureException exception) {
        HttpServletRequest request = currentRequest();
        String method = request != null ? request.getMethod() : null;
        String uri = request != null ? request.getRequestURI() : null;
        String reqId = currentRequestId();
        String rootCause = rootCauseName(exception);
        log.warn("Account lock contention method={} uri={} reqId={} rootCause={}", method, uri, reqId, rootCause);
        recordIfDiagnostic(ErrorCode.TRADING_BUSY.status().value(), ErrorCode.TRADING_BUSY.name(), rootCause, null);
        return businessProblem(ErrorCode.TRADING_BUSY);
    }

    @ExceptionHandler({DataAccessException.class, CannotCreateTransactionException.class})
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public ProblemDetail handleDataAccessUnavailable(RuntimeException exception) {
        HttpServletRequest request = currentRequest();
        String method = request != null ? request.getMethod() : null;
        String uri = request != null ? request.getRequestURI() : null;
        String reqId = currentRequestId();
        String rootCause = rootCauseName(exception);
        String topFrame = OpsErrorBuffer.extractTopAppFrame(exception);
        log.error("Database/pool failure method={} uri={} reqId={} rootCause={} topFrame={}",
                method, uri, reqId, rootCause, topFrame, exception);
        recordIfDiagnostic(HttpStatus.SERVICE_UNAVAILABLE.value(), "DB_UNAVAILABLE", rootCause, topFrame);
        dispatchCriticalAlert("trading-503:", "Trading API 503 database/pool failure",
                HttpStatus.SERVICE_UNAVAILABLE.value(), "DB_UNAVAILABLE", method, uri, reqId, rootCause, topFrame);
        var problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.SERVICE_UNAVAILABLE, "일시적으로 데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        problem.setProperty("code", "SERVICE_UNAVAILABLE");
        problem.setProperty("outcome", "UNKNOWN");
        attachRequestId(problem);
        return problem;
    }

    private ProblemDetail businessProblem(ErrorCode code) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(code.status(), code.message());
        problem.setProperty("code", code.name());
        // Admission can fail before looking up a key whose original command already committed.
        // This attempt made no write, but it cannot establish the original command's outcome.
        boolean admission = code == ErrorCode.TRADING_BUSY || code == ErrorCode.ENGINE_RECOVERING;
        problem.setProperty("outcome", admission ? "UNKNOWN" : "NOT_ACCEPTED");
        if (admission) {
            problem.setProperty("attemptOutcome", "NOT_ACCEPTED");
        }
        attachRequestId(problem);
        return problem;
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ProblemDetail handleUnexpectedException(Exception exception) {
        HttpServletRequest request = currentRequest();
        String method = request != null ? request.getMethod() : null;
        String uri = request != null ? request.getRequestURI() : null;
        String reqId = currentRequestId();
        String rootCause = rootCauseName(exception);
        String topFrame = OpsErrorBuffer.extractTopAppFrame(exception);
        log.error("Unexpected API failure method={} uri={} reqId={} rootCause={} topFrame={}",
                method, uri, reqId, rootCause, topFrame, exception);
        recordIfDiagnostic(HttpStatus.INTERNAL_SERVER_ERROR.value(), "INTERNAL_ERROR", rootCause, topFrame);
        dispatchCriticalAlert("trading-5xx:", "Trading API 500 internal error",
                HttpStatus.INTERNAL_SERVER_ERROR.value(), "INTERNAL_ERROR", method, uri, reqId, rootCause, topFrame);
        var problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리하는 중 서버 오류가 발생했습니다.");
        problem.setProperty("code", "INTERNAL_ERROR");
        problem.setProperty("outcome", "UNKNOWN");
        attachRequestId(problem);
        return problem;
    }

    @Override
    protected ResponseEntity<Object> createResponseEntity(
            Object body, HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        if (body instanceof ProblemDetail problem) {
            attachRequestId(problem);
        }
        if (statusCode != null && statusCode.is5xxServerError()) {
            HttpServletRequest servletReq = currentRequest();
            String method = servletReq != null ? servletReq.getMethod() : null;
            String uri = servletReq != null ? servletReq.getRequestURI() : null;
            String reqId = currentRequestId();
            String detail = body instanceof ProblemDetail problem ? problem.getTitle() : "SpringMvc5xx";
            String code = statusCode.value() == HttpStatus.SERVICE_UNAVAILABLE.value()
                    ? "SERVICE_UNAVAILABLE" : "SPRING_5XX";
            log.error("Spring MVC 5xx response status={} method={} uri={} reqId={} detail={}",
                    statusCode.value(), method, uri, reqId, detail);
            recordIfDiagnostic(statusCode.value(), code, detail, null);
            dispatchCriticalAlert("trading-5xx:", "Trading Spring MVC 5xx error",
                    statusCode.value(), code, method, uri, reqId, detail, null);
        }
        return super.createResponseEntity(body, headers, statusCode, request);
    }

    private void recordIfDiagnostic(int status, String code, String rootCause, String topAppFrame) {
        OpsErrorBuffer buffer = errorBuffer != null ? errorBuffer.getIfAvailable() : null;
        if (buffer == null) {
            return;
        }
        HttpServletRequest request = currentRequest();
        buffer.record(
                status,
                code,
                request != null ? request.getMethod() : null,
                request != null ? request.getRequestURI() : null,
                currentRequestId(),
                rootCause,
                topAppFrame);
    }

    private void dispatchCriticalAlert(
            String keyPrefix,
            String title,
            int status,
            String code,
            String method,
            String uri,
            String reqId,
            String rootCause,
            String topFrame) {
        OpsAlertService alertService = alerts != null ? alerts.getIfAvailable() : null;
        if (alertService == null) {
            return;
        }
        String sanitizedUri = OpsErrorBuffer.sanitizeUri(uri);
        String key = keyPrefix + (sanitizedUri != null ? sanitizedUri : "unknown");
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("status", status);
        details.put("code", code);
        if (method != null) details.put("method", method);
        if (sanitizedUri != null) details.put("uri", sanitizedUri);
        if (reqId != null) details.put("requestId", reqId);
        if (rootCause != null) details.put("rootCause", rootCause);
        if (topFrame != null) details.put("topAppFrame", topFrame);
        alertService.alert(key, "CRITICAL", title, details);
    }

    private static void attachRequestId(ProblemDetail problem) {
        String reqId = currentRequestId();
        if (reqId != null && !reqId.isBlank()) {
            problem.setProperty("requestId", reqId);
        }
    }

    private static String currentRequestId() {
        String mdc = MDC.get(RequestIdMdcFilter.MDC_KEY);
        if (mdc != null && !mdc.isBlank()) {
            return mdc;
        }
        HttpServletRequest request = currentRequest();
        if (request != null && request.getAttribute(RequestIdMdcFilter.REQUEST_ATTR) instanceof String attr) {
            return attr;
        }
        return null;
    }

    private static HttpServletRequest currentRequest() {
        var attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servlet) {
            return servlet.getRequest();
        }
        return null;
    }

    private static String rootCauseName(Throwable throwable) {
        Throwable cursor = throwable;
        int depth = 0;
        while (cursor.getCause() != null && cursor.getCause() != cursor && depth < 16) {
            cursor = cursor.getCause();
            depth++;
        }
        return cursor.getClass().getSimpleName();
    }
}
