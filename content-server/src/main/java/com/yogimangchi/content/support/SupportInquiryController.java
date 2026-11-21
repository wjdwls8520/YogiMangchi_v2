package com.yogimangchi.content.support;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@SecurityRequirement(name = "memberBearer")
public class SupportInquiryController {

    private final SupportInquiryService supportInquiries;

    public SupportInquiryController(SupportInquiryService supportInquiries) {
        this.supportInquiries = supportInquiries;
    }

    @PostMapping(value = "/api/v1/support/inquiries", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Submit a 1:1 customer support inquiry",
            description = "Active member Bearer required. Recommended categories: ACCOUNT, TRADING, CONTEST, COMMUNITY, BUG, GENERAL, ETC."
    )
    public ResponseEntity<SupportInquiryService.SupportInquiryResponse> createInquiry(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) SupportInquiryService.CreateInquiryRequest body) {
        Long memberId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.createInquiry(memberId, body));
    }

    @GetMapping(value = "/api/v1/support/inquiries/me", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List own 1:1 support inquiries and admin replies (cursor-paginated)")
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
    @Operation(summary = "List all 1:1 support inquiries for admin triage (optional status=OPEN|ANSWERED)")
    public ResponseEntity<SupportInquiryService.AdminSupportInquiryPageResponse> listAllInquiries(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String status,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "20") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(supportInquiries.listAllInquiries(adminId, status, category, cursorId, size));
    }

    @PostMapping(value = "/api/v1/admin/support/inquiries/{id:[0-9]+}/reply", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Answer a 1:1 support inquiry as admin, mark ANSWERED, and notify the member")
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
