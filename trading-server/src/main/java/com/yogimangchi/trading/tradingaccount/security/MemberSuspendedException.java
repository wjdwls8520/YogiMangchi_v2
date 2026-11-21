package com.yogimangchi.trading.tradingaccount.security;

/** Raised during credential verification when a member is suspended via trading.member_suspension. */
public class MemberSuspendedException extends RuntimeException {
    private final Long memberId;

    public MemberSuspendedException(Long memberId) {
        super("Member suspended: " + memberId);
        this.memberId = memberId;
    }

    public Long memberId() {
        return memberId;
    }
}
