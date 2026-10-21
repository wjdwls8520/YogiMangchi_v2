package com.yogimangchi.content.error;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.ErrorResponse;

@RestControllerAdvice
public class ApiErrors {
    private static final Logger log=LoggerFactory.getLogger(ApiErrors.class);
    @ExceptionHandler(AuthFailure.class)
    ResponseEntity<ProblemDetail> auth(AuthFailure e) { return problem(e.status(),e.code()); }
    @ExceptionHandler({MethodArgumentNotValidException.class,HttpMessageNotReadableException.class,MethodArgumentTypeMismatchException.class,org.springframework.web.bind.ServletRequestBindingException.class})
    ResponseEntity<ProblemDetail> validation(Exception e) { return problem(HttpStatus.BAD_REQUEST,"INVALID_REQUEST"); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ProblemDetail> conflict(DataIntegrityViolationException e) {
        if(e.getMostSpecificCause() instanceof java.sql.SQLException sql && "23505".equals(sql.getSQLState()))
            return problem(HttpStatus.CONFLICT,"RESOURCE_ALREADY_EXISTS");
        return unexpected(e);
    }
    @ExceptionHandler({HttpMediaTypeNotSupportedException.class,HttpRequestMethodNotSupportedException.class})
    ResponseEntity<ProblemDetail> protocol(Exception e) {
        return problem(HttpStatus.valueOf(((ErrorResponse)e).getStatusCode().value()),"INVALID_REQUEST");
    }
    @ExceptionHandler(org.springframework.dao.PessimisticLockingFailureException.class)
    ResponseEntity<ProblemDetail> busy(Exception e) { return problem(HttpStatus.CONFLICT,"MEMBER_BUSY"); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> unexpected(Exception e) {
        // SQL/provider response messages may contain personal data; do not dump request/token objects.
        log.error("Content request failed exceptionType={} locations={}",e.getClass().getName(),java.util.Arrays.toString(e.getStackTrace()));
        return problem(HttpStatus.INTERNAL_SERVER_ERROR,"INTERNAL_ERROR");
    }
    private ResponseEntity<ProblemDetail> problem(HttpStatus status,String code) {
        var detail=ProblemDetail.forStatusAndDetail(status,code); detail.setProperty("code",code);
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(detail);
    }
    public static void write(HttpServletResponse response,int status,String code) throws IOException {
        response.setStatus(status); response.setContentType("application/problem+json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-store");
        response.getWriter().write("{\"type\":\"about:blank\",\"status\":"+status+",\"code\":\""+code+"\",\"detail\":\""+code+"\"}");
    }
}
