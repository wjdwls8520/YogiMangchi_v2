package com.yogimangchi.content.error;

import com.yogimangchi.content.ops.OpsAlertService;
import com.yogimangchi.content.ops.OpsErrorBuffer;
import com.yogimangchi.content.ops.RequestIdMdcFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.CacheControl;
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
        return problem(e.status(), e.code(), request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> fields(MethodArgumentNotValidException e, HttpServletRequest request) {
        var errors = e.getBindingResult();
        // Inspect fixed field names only; rejected values and validator messages never enter responses.
        String code = errors.hasFieldErrors("nickname") ? "INVALID_NICKNAME"
                : errors.hasFieldErrors("termAgree") || errors.hasFieldErrors("privateAgree") ? "REQUIRED_CONSENT_MISSING"
                : errors.hasFieldErrors("termsVersion") || errors.hasFieldErrors("privacyVersion") ? "POLICY_VERSION_REQUIRED"
                : "INVALID_REQUEST";
        return problem(HttpStatus.BAD_REQUEST, code, request);
    }

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class,
            org.springframework.web.bind.ServletRequestBindingException.class
    })
    ResponseEntity<ProblemDetail> validation(Exception e, HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", request);
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<ProblemDetail> maxUploadSize(
            org.springframework.web.multipart.MaxUploadSizeExceededException e,
            HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "IMAGE_FILE_TOO_LARGE", request);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ProblemDetail> conflict(DataIntegrityViolationException e, HttpServletRequest request) {
        if (e.getMostSpecificCause() instanceof java.sql.SQLException sql && "23505".equals(sql.getSQLState())) {
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof org.hibernate.exception.ConstraintViolationException constraint) {
                    if ("member_nickname_key".equals(constraint.getConstraintName())) {
                        return problem(HttpStatus.CONFLICT, "NICKNAME_UNAVAILABLE", request);
                    }
                    if ("oauth_identity_provider_provider_subject_key".equals(constraint.getConstraintName())) {
                        return problem(HttpStatus.CONFLICT, "MEMBER_ALREADY_EXISTS", request);
                    }
                }
            }
            return problem(HttpStatus.CONFLICT, "RESOURCE_ALREADY_EXISTS", request);
        }
        return unexpected(e, request);
    }

    @ExceptionHandler({HttpMediaTypeNotSupportedException.class, HttpRequestMethodNotSupportedException.class})
    ResponseEntity<ProblemDetail> protocol(Exception e, HttpServletRequest request) {
        return problem(HttpStatus.valueOf(((ErrorResponse) e).getStatusCode().value()), "INVALID_REQUEST", request);
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
        String reqId = resolveRequestId(request);
        String rootCauseType = rootCauseType(e);
        // Never log raw SQL messages or parameters that may contain PII.
        log.error("Content database/pool unavailable code=SERVICE_TEMPORARILY_UNAVAILABLE method={} uri={} reqId={} rootCauseType={}",
                method, uri, reqId, rootCauseType);
        recordOpsError(HttpStatus.SERVICE_UNAVAILABLE.value(), "SERVICE_TEMPORARILY_UNAVAILABLE", method, uri, reqId, rootCauseType);
        notifyOpsAlert("content-db-unavailable", "ERROR", "Content DB/pool unavailable (503)", method, uri, reqId, rootCauseType);
        return problem(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_TEMPORARILY_UNAVAILABLE", request);
    }

    @ExceptionHandler({org.springframework.dao.DataAccessException.class, jakarta.persistence.PersistenceException.class})
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
        String reqId = resolveRequestId(request);
        String rootCauseType = rootCauseType(e);
        // SQL/provider response messages may contain personal data; never dump request/token objects.
        log.error("Content request failed code=INTERNAL_ERROR method={} uri={} reqId={} exceptionType={} rootCauseType={}",
                method, uri, reqId, e.getClass().getSimpleName(), rootCauseType);
        recordOpsError(HttpStatus.INTERNAL_SERVER_ERROR.value(), "INTERNAL_ERROR", method, uri, reqId, rootCauseType);
        notifyOpsAlert("content-internal-error", "ERROR", "Content unhandled server error (500)", method, uri, reqId, rootCauseType);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", request);
    }

    private ResponseEntity<ProblemDetail> logAndRespondLockConflict(Exception e, HttpServletRequest request) {
        String method = requestMethod(request);
        String uri = requestUri(request);
        String reqId = resolveRequestId(request);
        String rootCauseType = rootCauseType(e);
        log.warn("Content lock conflict code=MEMBER_BUSY method={} uri={} reqId={} rootCauseType={}",
                method, uri, reqId, rootCauseType);
        recordOpsError(HttpStatus.CONFLICT.value(), "MEMBER_BUSY", method, uri, reqId, rootCauseType);
        return problem(HttpStatus.CONFLICT, "MEMBER_BUSY", request);
    }

    private void recordOpsError(int status, String code, String method, String uri, String reqId, String rootCauseType) {
        if (errorBuffer != null) {
            errorBuffer.record(status, code, method, uri, reqId, rootCauseType);
        }
    }

    private void notifyOpsAlert(String key, String severity, String title, String method, String uri, String reqId, String rootCauseType) {
        if (alertService != null) {
            Map<String, Object> details = new LinkedHashMap<>();
            if (method != null) details.put("method", method);
            if (uri != null) details.put("uri", uri);
            if (reqId != null) details.put("requestId", reqId);
            if (rootCauseType != null) details.put("rootCauseType", rootCauseType);
            alertService.alert(key, severity, title, details);
        }
    }

    private static boolean isLockTimeout(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof org.springframework.dao.PessimisticLockingFailureException
                    || cause instanceof jakarta.persistence.PessimisticLockException
                    || cause instanceof jakarta.persistence.LockTimeoutException
                    || cause instanceof java.sql.SQLException sql && "55P03".equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static String rootCauseType(Throwable e) {
        Throwable cursor = e;
        while (cursor.getCause() != null && cursor.getCause() != cursor) {
            cursor = cursor.getCause();
        }
        return cursor.getClass().getSimpleName();
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

    private ResponseEntity<ProblemDetail> problem(HttpStatus status, String code, HttpServletRequest request) {
        var detail = ProblemDetail.forStatusAndDetail(status, code);
        detail.setProperty("code", code);
        String reqId = resolveRequestId(request);
        if (reqId != null) {
            detail.setProperty("requestId", reqId);
        }
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(detail);
    }

    public static void write(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        String reqId = MDC.get(RequestIdMdcFilter.MDC_KEY);
        String safeReqId = (reqId != null && reqId.matches("^[A-Za-z0-9._-]{1,64}$")) ? reqId : null;
        StringBuilder body = new StringBuilder(128);
        body.append("{\"type\":\"about:blank\",\"status\":").append(status)
                .append(",\"code\":\"").append(code).append("\",\"detail\":\"").append(code).append("\"");
        if (safeReqId != null) {
            body.append(",\"requestId\":\"").append(safeReqId).append("\"");
        }
        body.append('}');
        response.getWriter().write(body.toString());
    }
}
