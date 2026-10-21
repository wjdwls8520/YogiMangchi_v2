package com.yogimangchi.content.auth.controller;

import com.yogimangchi.content.auth.dto.*;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.error.AuthFailure;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.time.*;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/auth",produces="application/json")
public class AuthController {
    public static final String REFRESH_COOKIE="CONTENT_REFRESH";
    private final AuthService auth;
    private final boolean secure;
    public AuthController(AuthService auth,@Value("${content.auth.secure-cookies}") boolean secure) { this.auth=auth; this.secure=secure; }

    @GetMapping("/csrf")
    @Operation(summary="Get a session-bound CSRF header value before cookie-authenticated operations",
            description="Use credentials:include. Send returned token using headerName on signup/login completion/refresh/logout. This is not an authentication credential.")
    public ResponseEntity<Map<String,String>> csrf(CsrfToken token) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("headerName",token.getHeaderName(),"token",token.getToken())); }
    @GetMapping("/flow")
    @Operation(summary="Read the short-lived verified Google/Kakao login flow",
            description="After OAuth redirects to the fixed Frontend callback without tokens, read this using the temporary session cookie. Returns SIGNUP_REQUIRED or LOGIN_READY. 401 absent/expired proof; 400 provider email unavailable. Does not issue tokens or create a member.")
    public ResponseEntity<AuthService.Flow> flow(HttpServletRequest request) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(auth.flow(identity(request))); }
    @PostMapping("/signup")
    @Operation(summary="Complete OAuth signup with nickname and both required consents",
            description="Verified server session + CSRF required. No caller-provided provider subject, role, memberId or signup token is trusted. Returns 15-minute Access JWT JSON and sets a fixed-lifetime 7-day HttpOnly Refresh cookie. 400 validation, 401 proof, 409 identity/nickname conflict.")
    public ResponseEntity<AccessResponse> signup(HttpServletRequest request,@Valid @RequestBody SignupRequest body) {
        return useProof(request,identity -> auth.signup(identity,body));
    }
    @PostMapping("/login/complete")
    @Operation(summary="Exchange an existing member's verified OAuth session for own JWTs",
            description="CSRF required. Uses provider+subject, never email auto-linking. Consumes proof; no provider tokens are returned. 401 absent/expired proof or inactive member.")
    public ResponseEntity<AccessResponse> complete(HttpServletRequest request) {
        return useProof(request,auth::completeLogin);
    }
    @PostMapping("/refresh")
    @Operation(summary="Rotate the HttpOnly refresh cookie and return a new 15-minute Access JWT",
            description="Session CSRF header required. Token hashes retained in PostgreSQL. Reuse revokes the token family; concurrent refresh calls must be serialized by the client. Rotation does not extend the original 7-day expiry. 401 invalid/expired/reused.")
    public ResponseEntity<AccessResponse> refresh(@CookieValue(name=REFRESH_COOKIE,required=false) String token,HttpServletResponse response) {
        try { return issued(auth.refresh(token)); }
        catch(AuthFailure failure) { response.addHeader(HttpHeaders.SET_COOKIE,cookie("",Instant.EPOCH).toString()); throw failure; }
    }
    @PostMapping("/logout")
    @Operation(summary="Revoke the refresh family and clear the cookie",
            description="CSRF required; idempotent even if refresh is absent/invalid. Existing Access JWTs can remain valid until expiry (up to15 minutes); immediate Access revocation is not promised.")
    public ResponseEntity<Void> logout(@CookieValue(name=REFRESH_COOKIE,required=false) String token,HttpServletRequest request) {
        auth.logout(token); if(request.getSession(false)!=null) request.getSession(false).invalidate();
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE,cookie("",Instant.EPOCH).toString()).cacheControl(CacheControl.noStore()).build();
    }
    private VerifiedIdentity identity(HttpServletRequest request) {
        HttpSession session=request.getSession(false);
        if(session==null || !(session.getAttribute(VerifiedIdentity.SESSION_KEY) instanceof VerifiedIdentity identity)) throw AuthFailure.unauthorized();
        identity.requireFresh(); return identity;
    }
    private void clearProof(HttpServletRequest request) {
        var session=request.getSession(false);
        if(session!=null) { session.removeAttribute(VerifiedIdentity.SESSION_KEY); request.changeSessionId(); }
    }
    private ResponseEntity<AccessResponse> useProof(HttpServletRequest request,java.util.function.Function<VerifiedIdentity,AuthService.Issued> action) {
        var session=request.getSession(false);
        if(session==null) throw AuthFailure.unauthorized();
        // The current single Content instance uses servlet sessions for the temporary login flow.
        synchronized(session) {
            var tokens=action.apply(identity(request)); clearProof(request); return issued(tokens);
        }
    }
    private ResponseEntity<AccessResponse> issued(AuthService.Issued issued) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE,cookie(issued.refresh(),issued.refreshExpiresAt()).toString()).body(issued.access());
    }
    private ResponseCookie cookie(String value,Instant expires) {
        long seconds=Math.max(0,Duration.between(Instant.now(),expires).getSeconds());
        return ResponseCookie.from(REFRESH_COOKIE,value).path("/api/v1/auth").httpOnly(true).secure(secure).sameSite("Lax").maxAge(seconds).build();
    }
}
