package com.yogimangchi.trading.tradingaccount.security;

import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

/** Legacy Guest and Content member credentials converge only after independently verifying ownership. */
@Service
public class TradingCredentials {
    private final GuestCredentialService guests;
    private final ObjectProvider<MemberCredentials> members;
    public TradingCredentials(GuestCredentialService guests,ObjectProvider<MemberCredentials> members) { this.guests=guests; this.members=members; }
    public Optional<TradingPrincipal> authenticate(String token) {
        if(token==null || token.length()>8192) return Optional.empty();
        if(GuestCredentials.isValidFormat(token)) return guests.authenticate(token);
        MemberCredentials member=members.getIfAvailable();
        return member!=null && token.contains(".") ? member.authenticate(token) : Optional.empty();
    }
}
