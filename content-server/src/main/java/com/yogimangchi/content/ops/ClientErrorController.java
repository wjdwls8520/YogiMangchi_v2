package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import com.yogimangchi.content.error.AuthFailure;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/ops", produces = MediaType.APPLICATION_JSON_VALUE)
public class ClientErrorController {
    private static final Logger log = LoggerFactory.getLogger(ClientErrorController.class);
    public static final int MAX_PAYLOAD_BYTES = 4096;

    public record ClientErrorReportRequest(
            String route,
            String message,
            String stack,
            String digest,
            String userAgent) { }

    public record ClientErrorAcceptedResponse(
            boolean accepted,
            String requestId) { }

    private final ClientErrorBuffer buffer;
    private final ContentEndpointRateLimiter rateLimiter;
    private final ObjectMapper json;

    public ClientErrorController(
            ClientErrorBuffer buffer,
            ContentEndpointRateLimiter rateLimiter,
            ObjectMapper json) {
        this.buffer = buffer;
        this.rateLimiter = rateLimiter;
        this.json = json;
    }

    @PostMapping(value = "/client-errors", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Ingest sanitized frontend runtime/error-boundary crash report into a bounded 30-slot in-memory buffer",
            description = "Public/authenticated. IP rate-limited (20/min/IP), payload capped at 4KB, zero DB writes."
    )
    public ResponseEntity<ClientErrorAcceptedResponse> reportClientError(
            @RequestBody(required = false) byte[] rawBody,
            HttpServletRequest request) {
        String remoteAddr = request != null ? request.getRemoteAddr() : "unknown";
        rateLimiter.checkClientError(remoteAddr);

        if (rawBody == null || rawBody.length == 0) {
            throw new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
        }
        if (rawBody.length > MAX_PAYLOAD_BYTES) {
            throw new AuthFailure("PAYLOAD_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE, "오류 보고 본문은 최대 4KB까지 허용됩니다.");
        }

        ClientErrorReportRequest payload;
        try {
            payload = json.readValue(new String(rawBody, StandardCharsets.UTF_8), ClientErrorReportRequest.class);
        } catch (Exception ex) {
            throw new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
        }
        if (payload == null
                || ((payload.message() == null || payload.message().isBlank())
                && (payload.digest() == null || payload.digest().isBlank())
                && (payload.route() == null || payload.route().isBlank()))) {
            throw new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
        }

        String effectiveUa = (payload.userAgent() != null && !payload.userAgent().isBlank())
                ? payload.userAgent()
                : (request != null ? request.getHeader("User-Agent") : null);
        String reqId = RequestIdMdcFilter.currentOrGenerate();

        ClientErrorBuffer.ClientErrorEntry entry = buffer.record(
                payload.route(),
                payload.message(),
                payload.stack(),
                payload.digest(),
                effectiveUa,
                reqId);
        log.warn("[ClientError] reqId={} route={} digest={} message={}",
                reqId, entry.route(), entry.digest(), entry.message());

        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(new ClientErrorAcceptedResponse(true, reqId));
    }
}
