package com.yogimangchi.content.auth.controller;

import com.yogimangchi.content.auth.dto.*;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.error.AuthFailure;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.time.*;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/auth",produces="application/json")
public class AuthController {
    public static final String REFRESH_COOKIE="CONTENT_REFRESH";

    public record SessionProbeResponse(boolean authenticated, boolean hasRefreshCookie) { }

    private final AuthService auth;
    private final boolean secure;
    private final JwtDecoder jwtDecoder;
    private final ContentEndpointRateLimiter rateLimiter;

    public AuthController(AuthService auth, boolean secure) {
        this(auth, secure, null, null);
    }

    @Autowired
    public AuthController(
            AuthService auth,
            @Value("${content.auth.secure-cookies}") boolean secure,
            @Autowired(required = false) JwtDecoder jwtDecoder,
            @Autowired(required = false) ContentEndpointRateLimiter rateLimiter) {
        this.auth = auth;
        this.secure = secure;
        this.jwtDecoder = jwtDecoder;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping("/session-probe")
    @Operation(summary="Zero-401 anonymous-safe session probe",
            description="Public. Always returns HTTP 200 OK with {authenticated, hasRefreshCookie} so anonymous cold visits never trigger 401 console noise.")
    public ResponseEntity<SessionProbeResponse> sessionProbe(
            @CookieValue(name=REFRESH_COOKIE,required=false) String refreshToken,
            HttpServletRequest request) {
        boolean hasRefreshCookie = refreshToken != null && !refreshToken.isBlank();
        boolean authenticated = false;

        if (request != null && jwtDecoder != null) {
            String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);
            if (authHeader != null && authHeader.startsWith("Bearer ") && authHeader.length() <= 8199) {
                try {
                    Jwt decoded = jwtDecoder.decode(authHeader.substring(7));
                    Long memberId = Long.valueOf(decoded.getSubject());
                    authenticated = auth.isMemberSessionEligible(memberId);
                } catch (RuntimeException ignored) {
                    authenticated = false;
                }
            }
        }
        if (!authenticated && hasRefreshCookie) {
            try {
                authenticated = auth.hasActiveRefreshSession(refreshToken);
            } catch (RuntimeException ignored) {
                authenticated = false;
            }
        }

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new SessionProbeResponse(authenticated, hasRefreshCookie));
    }

    @GetMapping("/csrf")
    @Operation(summary="Get a session-bound CSRF header value before cookie-authenticated operations",
            description="Use credentials:include. Send returned token using headerName on signup/login completion/refresh/logout. This is not an authentication credential.")
    public ResponseEntity<Map<String,String>> csrf(CsrfToken token, HttpServletRequest request) {
        if (rateLimiter != null) {
            rateLimiter.checkCsrf(remoteAddr(request));
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("headerName",token.getHeaderName(),"token",token.getToken()));
    }

    @GetMapping("/flow")
    @Operation(summary="Read the short-lived verified Google/Kakao login flow",
            description="After OAuth redirects to the fixed Frontend callback without tokens, read this using the temporary session cookie. Returns SIGNUP_REQUIRED, LOGIN_READY or WITHDRAWAL_PENDING. 401 absent/expired proof; 400 provider email unavailable. Does not issue tokens or create a member.")
    public ResponseEntity<AuthService.Flow> flow(HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(auth.flow(identity(request)));
    }

    @PostMapping("/signup")
    @Operation(summary="Complete OAuth signup with nickname and both versioned required consents",
            description="Verified server session + CSRF required. No caller-provided provider subject, role, memberId or signup token is trusted. Returns 15-minute Access JWT JSON and sets a fixed-lifetime 7-day HttpOnly Refresh cookie. 400 validation/missing versions, 401 proof, 409 identity/nickname/policy-version conflict. termsVersion/privacyVersion must match GET /api/v1/policies/current; consent history and provisioning outbox commit atomically.")
    public ResponseEntity<AccessResponse> signup(HttpServletRequest request, @Valid @RequestBody SignupRequest body) {
        checkAuthWrite(request);
        return useProof(request, identity -> auth.signup(identity, body));
    }

    @PostMapping("/login/complete")
    @Operation(summary="Exchange an existing member's verified OAuth session for own JWTs",
            description="CSRF required. Uses provider+subject, never email auto-linking. Consumes proof; no provider tokens are returned. 401 absent/expired proof or inactive member.")
    public ResponseEntity<AccessResponse> complete(HttpServletRequest request) {
        checkAuthWrite(request);
        return useProof(request, auth::completeLogin);
    }

    @PostMapping("/refresh")
    @Operation(summary="Rotate the HttpOnly refresh cookie and return a new 15-minute Access JWT",
            description="Session CSRF header required. Token hashes retained in PostgreSQL. Reuse revokes the token family; concurrent refresh calls must be serialized by the client. Rotation does not extend the original 7-day expiry. 401 invalid/expired/reused; failed refresh never changes the Refresh cookie, so a delayed failure cannot erase a newer login cookie. This does not make an already revoked family usable. Do not blindly retry an ambiguous lost rotation response.")
    public ResponseEntity<AccessResponse> refresh(
            @CookieValue(name=REFRESH_COOKIE,required=false) String token,
            HttpServletRequest request) {
        checkAuthWrite(request);
        // A response cannot conditionally delete only the cookie carried by its request.
        // Logout owns explicit cookie removal; replay detection still commits in AuthService.
        return issued(auth.refresh(token));
    }

    @PostMapping("/logout")
    @Operation(summary="Revoke the refresh family and clear the cookie",
            description="CSRF required; idempotent even if refresh is absent/invalid. Existing Access JWTs can remain valid until expiry (up to15 minutes); immediate Access revocation is not promised.")
    public ResponseEntity<Void> logout(@CookieValue(name=REFRESH_COOKIE,required=false) String token, HttpServletRequest request) {
        checkAuthWrite(request);
        auth.logout(token);
        if (request.getSession(false) != null) request.getSession(false).invalidate();
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Instant.EPOCH).toString()).cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/logout-all")
    @SecurityRequirement(name="memberBearer")
    @Operation(summary="Revoke all refresh sessions across all devices for the authenticated member and clear the refresh cookie",
            description="Active or suspended member Bearer required. Revokes every refresh session belonging to the member and clears the refresh cookie.")
    public ResponseEntity<Void> logoutAll(@AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
        checkAuthWrite(request);
        if (jwt == null || jwt.getSubject() == null) throw AuthFailure.unauthorized();
        auth.logoutAll(Long.valueOf(jwt.getSubject()));
        if (request.getSession(false) != null) request.getSession(false).invalidate();
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Instant.EPOCH).toString()).cacheControl(CacheControl.noStore()).build();
    }

    private void checkAuthWrite(HttpServletRequest request) {
        if (rateLimiter != null) {
            rateLimiter.checkAuthWrite(remoteAddr(request));
        }
    }

    private static String remoteAddr(HttpServletRequest request) {
        return request == null ? "unknown" : request.getRemoteAddr();
    }

    private VerifiedIdentity identity(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null || !(session.getAttribute(VerifiedIdentity.SESSION_KEY) instanceof VerifiedIdentity identity)) throw new AuthFailure("LOGIN_PROOF_REQUIRED", HttpStatus.UNAUTHORIZED);
        identity.requireFresh();
        return identity;
    }

    private void clearProof(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(VerifiedIdentity.SESSION_KEY);
            request.changeSessionId();
        }
    }

    private ResponseEntity<AccessResponse> useProof(HttpServletRequest request, java.util.function.Function<VerifiedIdentity, AuthService.Issued> action) {
        var session = request.getSession(false);
        if (session == null) throw new AuthFailure("LOGIN_PROOF_REQUIRED", HttpStatus.UNAUTHORIZED);
        // The current single Content instance uses servlet sessions for the temporary login flow.
        synchronized (session) {
            var tokens = action.apply(identity(request));
            clearProof(request);
            return issued(tokens);
        }
    }

    private ResponseEntity<AccessResponse> issued(AuthService.Issued issued) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE, cookie(issued.refresh(), issued.refreshExpiresAt()).toString()).body(issued.access());
    }

    private ResponseCookie cookie(String value, Instant expires) {
        long seconds = Math.max(0, Duration.between(Instant.now(), expires).getSeconds());
        return ResponseCookie.from(REFRESH_COOKIE, value).path("/api/v1/auth").httpOnly(true).secure(secure).sameSite("Lax").maxAge(seconds).build();
    }
}
