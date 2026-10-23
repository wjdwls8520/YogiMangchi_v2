package com.yogimangchi.content.member.service;

import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.repository.MemberRepository;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberWithdrawals {
    public record Result(String status) { }
    private final MemberRepository members;
    private final RefreshSessionRepository refresh;
    private final JdbcTemplate jdbc;
    public MemberWithdrawals(MemberRepository members,RefreshSessionRepository refresh,JdbcTemplate jdbc) {
        this.members=members; this.refresh=refresh; this.jdbc=jdbc;
    }
    @Transactional(timeout=5)
    public Result request(Long memberId,com.yogimangchi.content.member.dto.WithdrawalRequest body,com.yogimangchi.content.auth.oauth.VerifiedIdentity proof) {
        if(body==null) throw new AuthFailure("WITHDRAWAL_CONFIRMATION_REQUIRED",org.springframework.http.HttpStatus.BAD_REQUEST);
        body.validate();
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var member=members.lockById(memberId).orElseThrow(AuthFailure::unauthorized);
        Instant now=Instant.now();
        if(member.getStatus()==com.yogimangchi.content.member.entity.Member.Status.ACTIVE) {
            if(proof==null) throw AuthFailure.unauthorized();
            proof.requireFresh();
            if(!Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from content.oauth_identity where member_id=? and provider=? and provider_subject=?)",Boolean.class,memberId,proof.provider().name(),proof.subject()))) throw AuthFailure.unauthorized();
            member.beginWithdrawal();
        }
        jdbc.update("update content.member_follow set active=false,deactivated_at=now() where active and (follower_id=? or following_id=?)",memberId,memberId);
        refresh.revokeMember(memberId,now);
        jdbc.update("update content.member_trading_provision set status='CANCELED' where member_id=? and status='PENDING'",memberId);
        jdbc.update("insert into content.member_withdrawal(member_id,status,requested_at,next_attempt_at,confirmation_version,confirmed_at) values (?,'PENDING',?,?,?,?) on conflict(member_id) do nothing",
                memberId,java.sql.Timestamp.from(now),java.sql.Timestamp.from(now),body.policyVersion(),java.sql.Timestamp.from(now));
        return new Result(jdbc.queryForObject("select status from content.member_withdrawal where member_id=?",String.class,memberId));
    }
    @Transactional(readOnly=true,timeout=3)
    public Result status(Long memberId) {
        var rows=jdbc.queryForList("select status from content.member_withdrawal where member_id=?",String.class,memberId);
        return new Result(rows.isEmpty()?"NOT_REQUESTED":rows.get(0));
    }
    @Transactional(readOnly=true,timeout=3)
    public List<Long> pending() {
        return jdbc.queryForList("select member_id from content.member_withdrawal where status='PENDING' and next_attempt_at<=now() order by next_attempt_at,member_id limit 10",Long.class);
    }
    @Transactional(timeout=3)
    public void delivered(Long memberId) {
        var member=members.lockById(memberId).orElseThrow();
        if(jdbc.queryForObject("select count(*) from content.member_withdrawal where member_id=?",Long.class,memberId)==0) return;
        // Privacy/security destruction only; business IDs and financial histories remain intact.
        jdbc.update("delete from content.oauth_identity where member_id=?",memberId);
        jdbc.update("delete from content.refresh_session where member_id=?",memberId);
        jdbc.update("delete from content.member_consent_history where member_id=?",memberId);
        member.withdraw(Instant.now());
        jdbc.update("update content.member_withdrawal set status='COMPLETED',completed_at=now() where member_id=? and status='PENDING'",memberId);
    }
    @Transactional(timeout=3)
    public void failed(Long memberId) {
        // Bounded delay, no tokens/error bodies/PII persisted. A restart resumes from the same row.
        jdbc.update("update content.member_withdrawal set attempts=least(attempts+1,1000000),next_attempt_at=now()+make_interval(secs => least(300,5*power(2,least(attempts,6)))::int) where member_id=? and status='PENDING'",memberId);
    }
}
