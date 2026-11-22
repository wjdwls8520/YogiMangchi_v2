package com.yogimangchi.content.support;

import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "memberBearer")
public class SupportInquiryController {

    private final SupportInquiryService supportInquiries;
    private final ContentEndpointRateLimiter rateLimiter;

    public SupportInquiryController(SupportInquiryService supportInquiries) {
        this(supportInquiries, null);
    }

    @Autowired
    public SupportInquiryController(
            SupportInquiryService supportInquiries,
            @Autowired(required = false) ContentEndpointRateLimiter rateLimiter) {
        this.supportInquiries = supportInquiries;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping(value = "/api/v1/support/inquiries", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Submit a 1:1 customer support inquiry",
            description = "ACTIVE or SUSPENDED member Bearer required (allows suspension appeals). Recommended categories: ACCOUNT, TRADING, CONTEST, COMMUNITY, BUG, GENERAL, ETC."
    )
    public ResponseEntity<SupportInquiryService.SupportInquiryResponse> createInquiry(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) SupportInquiryService.CreateInquiryRequest body,
            HttpServletRequest request) {
        Long memberId = Long.valueOf(jwt.getSubject());
        if (rateLimiter != null) {
            rateLimiter.checkSupportWrite(memberId, request != null ? request.getRemoteAddr() : "unknown");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.createInquiry(memberId, body));
    }

    @PatchMapping(value = "/api/v1/support/inquiries/{id:[0-9]+}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Edit own OPEN 1:1 support inquiry",
            description = "ACTIVE or SUSPENDED member Bearer required. Only allowed while inquiry status is OPEN; returns 409 INQUIRY_STATUS_CONFLICT otherwise."
    )
    public ResponseEntity<SupportInquiryService.SupportInquiryResponse> updateInquiry(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id,
            @RequestBody(required = false) SupportInquiryService.UpdateInquiryRequest body) {
        Long memberId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.updateInquiry(memberId, id, body));
    }

    @DeleteMapping(value = "/api/v1/support/inquiries/{id:[0-9]+}")
    @Operation(
            summary = "Cancel/delete own OPEN 1:1 support inquiry",
            description = "ACTIVE or SUSPENDED member Bearer required. Only allowed while inquiry status is OPEN; returns 409 INQUIRY_STATUS_CONFLICT otherwise."
    )
    public ResponseEntity<Void> deleteInquiry(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id) {
        Long memberId = Long.valueOf(jwt.getSubject());
        supportInquiries.deleteInquiry(memberId, id);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }

    @PostMapping(value = "/api/v1/support/inquiries/{id:[0-9]+}/close", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Close own 1:1 support inquiry (marks status CLOSED)",
            description = "ACTIVE or SUSPENDED member Bearer required. Allowed when status is OPEN or ANSWERED (idempotent if already CLOSED)."
    )
    public ResponseEntity<SupportInquiryService.SupportInquiryResponse> closeInquiry(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id) {
        Long memberId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.closeInquiry(memberId, id));
    }

    @GetMapping(value = "/api/v1/support/inquiries/me", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List own 1:1 support inquiries and admin replies (cursor-paginated, optional status=ALL|OPEN|ANSWERED|CLOSED)")
    public ResponseEntity<SupportInquiryService.SupportInquiryPageResponse> listMyInquiries(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String status,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "20") Integer size) {
        Long memberId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.listMyInquiries(memberId, status, cursorId, size));
    }

    @GetMapping(value = "/api/v1/admin/support/inquiries", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List all 1:1 support inquiries for admin triage (optional status=ALL|OPEN|ANSWERED|CLOSED, category, keyword, cursorId, size)")
    public ResponseEntity<SupportInquiryService.AdminSupportInquiryPageResponse> listAllInquiries(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String status,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "20") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.listAllInquiries(adminId, status, category, keyword, cursorId, size));
    }

    @PostMapping(value = "/api/v1/admin/support/inquiries/{id:[0-9]+}/reply", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Answer a 1:1 support inquiry as admin, mark ANSWERED, record audit log, and notify the member")
    public ResponseEntity<SupportInquiryService.SupportInquiryResponse> replyInquiry(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id,
            @RequestBody(required = false) SupportInquiryService.ReplyInquiryRequest body) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.replyInquiry(adminId, id, body));
    }
}
