package com.yogimangchi.content.auth.oauth;

import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;

/** Only fixed public codes may leave the OAuth boundary. Never echo provider descriptions. */
final class OAuthErrors {
    private OAuthErrors() { }
    static String code(AuthenticationException failure) {
        if(!(failure instanceof OAuth2AuthenticationException oauth)) return "oauth_failed";
        return switch(oauth.getError().getErrorCode()) {
            case "access_denied" -> "oauth_cancelled";
            case "server_error", "temporarily_unavailable", "invalid_token_response", "invalid_user_info_response" -> "oauth_temporarily_unavailable";
            case "authorization_request_not_found", "invalid_state_parameter" -> "oauth_session_expired";
            case "invalid_id_token", "invalid_nonce" -> "oauth_invalid_response";
            default -> "oauth_failed";
        };
    }
}
