package com.yogimangchi.content.consent;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class ConsentController {
    private final PolicyConsents consents;
    public ConsentController(PolicyConsents consents) {this.consents=consents;}
    @GetMapping("/api/v1/policies/current")
    @Operation(summary="Current TERMS/PRIVACY versions",description="Public version metadata; no fabricated historical consent. Follow documentUrl for the immutable versioned development draft and SHA-256; publication requires operator/contact confirmation.")
    public PolicyConsents.State current() {return consents.current(null);}
    @GetMapping("/api/v1/policies/{type:TERMS|PRIVACY}/{version}")
    @Operation(summary="Read an immutable policy version",description="Public text and SHA-256. Current documents are DEVELOPMENT_DRAFT; not a claim of legal/publication readiness. Missing404.")
    public ResponseEntity<PolicyConsents.Document> document(@PathVariable String type,@PathVariable String version) {return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(consents.document(type,version));}
    @GetMapping("/api/v1/members/me/consents")
    @Operation(summary="Own required reconsent status",description="Member Bearer. Existing unversioned timestamps do not constitute agreement to current versions.")
    public ResponseEntity<PolicyConsents.State> mine(@AuthenticationPrincipal Jwt jwt) {return response(consents.current(Long.valueOf(jwt.getSubject())));}
    @PostMapping("/api/v1/members/me/consents")
    @Operation(summary="Accept current policy versions",description="Member Bearer. Both booleans true and exact termsVersion/privacyVersion required; stale/declined409. Server timestamps, duplicate version acceptance returns original history without overwriting. New versions are activated by a reviewed migration, not an Admin API.")
    public ResponseEntity<PolicyConsents.State> accept(@AuthenticationPrincipal Jwt jwt,@RequestBody PolicyConsents.Acceptance body) {return response(consents.accept(Long.valueOf(jwt.getSubject()),body));}
    private static ResponseEntity<PolicyConsents.State> response(PolicyConsents.State state) {return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(state);}
}
