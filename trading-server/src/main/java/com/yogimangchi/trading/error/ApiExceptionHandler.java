package com.yogimangchi.trading.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(BusinessException.class)
    public ProblemDetail handleBusinessException(BusinessException exception) {
        log.info("Business request rejected code={}", exception.getCode());
        return businessProblem(exception.getCode());
    }

    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ProblemDetail handleLockConflict(PessimisticLockingFailureException exception) {
        return businessProblem(ErrorCode.TRADING_BUSY);
    }

    private ProblemDetail businessProblem(ErrorCode code) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(code.status(), code.message());
        problem.setProperty("code", code.name());
        return problem;
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ProblemDetail handleUnexpectedException(Exception exception) {
        log.error("Unexpected API failure", exception);
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리하는 중 서버 오류가 발생했습니다.");
    }
}
