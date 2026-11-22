package com.yogimangchi.content.error;

import com.yogimangchi.content.ops.OpsAlertService;
import com.yogimangchi.content.ops.OpsErrorBuffer;
import com.yogimangchi.content.ops.RequestIdMdcFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiErrors {
    private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);

    private final OpsErrorBuffer errorBuffer;
    private final OpsAlertService alertService;

    public ApiErrors() {
        this(null, null);
    }

    @Autowired
    public ApiErrors(OpsErrorBuffer errorBuffer, OpsAlertService alertService) {
        this.errorBuffer = errorBuffer;
        this.alertService = alertService;
    }

    @ExceptionHandler(AuthFailure.class)
    ResponseEntity<ProblemDetail> auth(AuthFailure e, HttpServletRequest request) {
        if (e.status() == HttpStatus.CONFLICT) {
            recordOpsError(
                    HttpStatus.CONFLICT.value(),
                    e.code(),
                    requestMethod(request),
                    requestUri(request),
                    resolveRequestId(request),
                    e.code(),
                    OpsErrorBuffer.extractTopAppFrame(e));
        }
        return problem(e.status(), e.code(), e.detail(), request);
    }

    @ExceptionHandler(RateLimitedException.class)
    ResponseEntity<ProblemDetail> rateLimited(RateLimitedException e, HttpServletRequest request) {
        String method = requestMethod(request);
        String uri = requestUri(request);
        String reqId = resolveRequestId(request);
        recordOpsError(HttpStatus.TOO_MANY_REQUESTS.value(), "RATE_LIMITED", method, uri, reqId, "RateLimitedException", null);
        var detail = ProblemDetail.forStatusAndDetail(
                HttpStatus.TOO_MANY_REQUESTS,
                "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
        detail.setProperty("code", "RATE_LIMITED");
        if (reqId != null) {
            detail.setProperty("requestId", reqId);
        }
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(e.retryAfterSeconds()))
                .cacheControl(CacheControl.noStore())
                .body(detail);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> fields(MethodArgumentNotValidException e, HttpServletRequest request) {
        var errors = e.getBindingResult();
        // Inspect fixed field names only; rejected values and validator messages never enter responses.
        String code = errors.hasFieldErrors("nickname") ? "INVALID_NICKNAME"
                : errors.hasFieldErrors("termAgree") || errors.hasFieldErrors("privateAgree") ? "REQUIRED_CONSENT_MISSING"
                : errors.hasFieldErrors("termsVersion") || errors.hasFieldErrors("privacyVersion") ? "POLICY_VERSION_REQUIRED"
                : "INVALID_REQUEST";
        return problem(HttpStatus.BAD_REQUEST, code, null, request);
    }

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class,
            org.springframework.web.bind.ServletRequestBindingException.class
    })
    ResponseEntity<ProblemDetail> validation(Exception e, HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", null, request);
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<ProblemDetail> maxUploadSize(
            org.springframework.web.multipart.MaxUploadSizeExceededException e,
            HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "IMAGE_FILE_TOO_LARGE", "업로드 파일 용량 제한을 초과했습니다.", request);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ProblemDetail> conflict(DataIntegrityViolationException e, HttpServletRequest request) {
        if (e.getMostSpecificCause() instanceof SQLException sql && "23505".equals(sql.getSQLState())) {
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof org.hibernate.exception.ConstraintViolationException constraint) {
                    if ("member_nickname_key".equals(constraint.getConstraintName())) {
                        return problem(HttpStatus.CONFLICT, "NICKNAME_UNAVAILABLE", null, request);
                    }
                    if ("oauth_identity_provider_provider_subject_key".equals(constraint.getConstraintName())) {
                        return problem(HttpStatus.CONFLICT, "MEMBER_ALREADY_EXISTS", null, request);
                    }
                }
            }
            return problem(HttpStatus.CONFLICT, "RESOURCE_ALREADY_EXISTS", null, request);
        }
        return unexpected(e, request);
    }

    @ExceptionHandler({HttpMediaTypeNotSupportedException.class, HttpRequestMethodNotSupportedException.class})
    ResponseEntity<ProblemDetail> protocol(Exception e, HttpServletRequest request) {
        return problem(HttpStatus.valueOf(((ErrorResponse) e).getStatusCode().value()), "INVALID_REQUEST", null, request);
    }

    @ExceptionHandler({
            org.springframework.dao.PessimisticLockingFailureException.class,
            jakarta.persistence.PessimisticLockException.class,
            jakarta.persistence.LockTimeoutException.class
    })
    ResponseEntity<ProblemDetail> busy(Exception e, HttpServletRequest request) {
        return logAndRespondLockConflict(e, request);
    }

    @ExceptionHandler({
            org.springframework.dao.DataAccessResourceFailureException.class,
            org.springframework.transaction.CannotCreateTransactionException.class
    })
    ResponseEntity<ProblemDetail> unavailable(Exception e, HttpServletRequest request) {
        String method = requestMethod(request);
        String uri = requestUri(request);
        String sanitizedUri = OpsErrorBuffer.sanitizeUri(uri);
        String reqId = resolveRequestId(request);
        String rootCauseType = rootCauseType(e);
        List<String> appFrames = OpsErrorBuffer.extractTopAppFrames(e, 5);
        String topFrame = appFrames.isEmpty() ? null : appFrames.get(0);
        // Never log raw SQL messages or parameters that may contain PII.
        log.error("Content database/pool unavailable code=SERVICE_TEMPORARILY_UNAVAILABLE method={} uri={} reqId={} rootCauseType={} appFrames={}",
                method, sanitizedUri, reqId, rootCauseType, appFrames);
        recordOpsError(HttpStatus.SERVICE_UNAVAILABLE.value(), "SERVICE_TEMPORARILY_UNAVAILABLE",
                method, sanitizedUri, reqId, rootCauseType, topFrame);
        notifyOpsAlert("content-503:" + (sanitizedUri != null ? sanitizedUri : "unknown"),
                "CRITICAL", "Content DB/pool unavailable (503)", method, sanitizedUri, reqId, rootCauseType, topFrame);
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_TEMPORARILY_UNAVAILABLE", null, request);
    }

    @ExceptionHandler({DataAccessException.class, jakarta.persistence.PersistenceException.class})
    ResponseEntity<ProblemDetail> dataAccess(Exception e, HttpServletRequest request) {
        if (isLockTimeout(e)) {
            return logAndRespondLockConflict(e, request);
        }
        return unexpected(e, request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> unexpected(Exception e, HttpServletRequest request) {
        if (isLockTimeout(e)) {
            return logAndRespondLockConflict(e, request);
        }
        String method = requestMethod(request);
        String uri = requestUri(request);
        String sanitizedUri = OpsErrorBuffer.sanitizeUri(uri);
        String reqId = resolveRequestId(request);
        Throwable root = rootCause(e);
        String rootCauseType = root.getClass().getSimpleName();
        String safeRootMessage = safeDiagnosticMessage(e, root);
        List<String> appFrames = OpsErrorBuffer.extractTopAppFrames(e, 5);
        String topFrame = appFrames.isEmpty() ? null : appFrames.get(0);
        // Log top 5 com.yogimangchi.* frames and sanitized non-SQL root cause for rapid 3AM triage
        // without ever leaking stack frames or exception messages to HTTP clients.
        log.error("Content request failed code=INTERNAL_ERROR method={} uri={} reqId={} exceptionType={} rootCauseType={} rootCauseMsg={} appFrames={}",
                method, sanitizedUri, reqId, e.getClass().getSimpleName(), rootCauseType, safeRootMessage, appFrames);
        recordOpsError(HttpStatus.INTERNAL_SERVER_ERROR.value(), "INTERNAL_ERROR",
                method, sanitizedUri, reqId, rootCauseType, topFrame);
        notifyOpsAlert("content-500:" + (sanitizedUri != null ? sanitizedUri : "unknown"),
                "CRITICAL", "Content unhandled server error (500)", method, sanitizedUri, reqId, rootCauseType, topFrame);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", null, request);
    }

    private ResponseEntity<ProblemDetail> logAndRespondLockConflict(Exception e, HttpServletRequest request) {
        String method = requestMethod(request);
        String uri = requestUri(request);
        String sanitizedUri = OpsErrorBuffer.sanitizeUri(uri);
        String reqId = resolveRequestId(request);
        String rootCauseType = rootCauseType(e);
        String topFrame = OpsErrorBuffer.extractTopAppFrame(e);
        log.warn("Content lock conflict code=MEMBER_BUSY method={} uri={} reqId={} rootCauseType={}",
                method, sanitizedUri, reqId, rootCauseType);
        recordOpsError(HttpStatus.CONFLICT.value(), "MEMBER_BUSY", method, sanitizedUri, reqId, rootCauseType, topFrame);
        return problem(HttpStatus.CONFLICT, "MEMBER_BUSY", null, request);
    }

    private void recordOpsError(
            int status,
            String code,
            String method,
            String uri,
            String reqId,
            String rootCauseType,
            String topAppFrame) {
        if (errorBuffer != null) {
            errorBuffer.record(status, code, method, uri, reqId, rootCauseType, topAppFrame);
        }
    }

    private void notifyOpsAlert(
            String key,
            String severity,
            String title,
            String method,
            String uri,
            String reqId,
            String rootCauseType,
            String topAppFrame) {
        if (alertService != null) {
            Map<String, Object> details = new LinkedHashMap<>();
            if (method != null) details.put("method", method);
            if (uri != null) details.put("uri", uri);
            if (reqId != null) details.put("requestId", reqId);
            if (rootCauseType != null) details.put("rootCauseType", rootCauseType);
            if (topAppFrame != null) details.put("topAppFrame", topAppFrame);
            alertService.alert(key, severity, title, details);
        }
    }

    private static boolean isLockTimeout(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof org.springframework.dao.PessimisticLockingFailureException
                    || cause instanceof jakarta.persistence.PessimisticLockException
                    || cause instanceof jakarta.persistence.LockTimeoutException
                    || cause instanceof SQLException sql && "55P03".equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static Throwable rootCause(Throwable e) {
        Throwable cursor = e;
        int depth = 0;
        while (cursor.getCause() != null && cursor.getCause() != cursor && depth < 16) {
            cursor = cursor.getCause();
            depth++;
        }
        return cursor;
    }

    private static String rootCauseType(Throwable e) {
        return rootCause(e).getClass().getSimpleName();
    }

    /** Returns sanitized diagnostic message for non-SQL exceptions (never dumps raw SQL/PII/tokens). */
    private static String safeDiagnosticMessage(Throwable outer, Throwable root) {
        if (outer instanceof DataAccessException || outer instanceof jakarta.persistence.PersistenceException
                || root instanceof SQLException) {
            if (root instanceof SQLException sql && sql.getSQLState() != null) {
                return "SQLState=" + sql.getSQLState();
            }
            return "[SQL_REDACTED]";
        }
        String raw = root.getMessage();
        if (raw == null || raw.isBlank()) {
            return "-";
        }
        String cleaned = raw.replaceAll("[\\p{Cntrl}]", " ")
                .replaceAll("(?i)Bearer\\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]")
                .replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", "[EMAIL]")
                .strip();
        return cleaned.length() > 160 ? cleaned.substring(0, 160) : cleaned;
    }

    private static String requestMethod(HttpServletRequest request) {
        return request == null ? null : request.getMethod();
    }

    private static String requestUri(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String uri = request.getRequestURI();
        return uri == null ? null : uri.replaceAll("[\\p{Cntrl}]", "");
    }

    private static String resolveRequestId(HttpServletRequest request) {
        if (request != null) {
            Object attr = request.getAttribute(RequestIdMdcFilter.REQUEST_ATTR);
            if (attr instanceof String s && !s.isBlank()) {
                return s;
            }
        }
        String mdc = MDC.get(RequestIdMdcFilter.MDC_KEY);
        return (mdc == null || mdc.isBlank()) ? null : mdc;
    }

    private ResponseEntity<ProblemDetail> problem(HttpStatus status, String code, String customDetail, HttpServletRequest request) {
        String effectiveDetail = (customDetail != null && !customDetail.isBlank()) ? customDetail : code;
        var detail = ProblemDetail.forStatusAndDetail(status, effectiveDetail);
        detail.setProperty("code", code);
        String reqId = resolveRequestId(request);
        if (reqId != null) {
            detail.setProperty("requestId", reqId);
        }
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(detail);
    }

    public static void write(HttpServletResponse response, int status, String code) throws IOException {
        write(response, status, code, code);
    }

    public static void write(HttpServletResponse response, int status, String code, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        String effectiveDetail = (detail != null && !detail.isBlank()) ? detail : code;
        String reqId = MDC.get(RequestIdMdcFilter.MDC_KEY);
        String safeReqId = (reqId != null && reqId.matches("^[A-Za-z0-9._-]{1,64}$")) ? reqId : null;
        StringBuilder body = new StringBuilder(160);
        body.append("{\"type\":\"about:blank\",\"status\":").append(status)
                .append(",\"code\":\"").append(escapeJson(code))
                .append("\",\"detail\":\"").append(escapeJson(effectiveDetail)).append("\"");
        if (safeReqId != null) {
            body.append(",\"requestId\":\"").append(safeReqId).append("\"");
        }
        body.append('}');
        response.getWriter().write(body.toString());
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(' ');
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.toString();
    }
}
