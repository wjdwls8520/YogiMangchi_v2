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
    public Result request(Long memberId) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var member=members.lockById(memberId).orElseThrow(AuthFailure::unauthorized);
        Instant now=Instant.now();
        member.withdraw(now);
        jdbc.update("update content.member_follow set active=false,deactivated_at=now() where active and (follower_id=? or following_id=?)",memberId,memberId);
        refresh.revokeMember(memberId,now);
        jdbc.update("insert into content.member_withdrawal(member_id,status,requested_at,next_attempt_at) values (?,'PENDING',?,?) on conflict(member_id) do nothing",
                memberId,java.sql.Timestamp.from(now),java.sql.Timestamp.from(now));
        return new Result(jdbc.queryForObject("select status from content.member_withdrawal where member_id=?",String.class,memberId));
    }
    @Transactional(readOnly=true,timeout=3)
    public List<Long> pending() {
        return jdbc.queryForList("select member_id from content.member_withdrawal where status='PENDING' and next_attempt_at<=now() order by next_attempt_at,member_id limit 10",Long.class);
    }
    @Transactional(timeout=3)
    public void delivered(Long memberId) {
        jdbc.update("update content.member_withdrawal set status='COMPLETED',completed_at=now() where member_id=? and status='PENDING'",memberId);
    }
    @Transactional(timeout=3)
    public void failed(Long memberId) {
        // Bounded delay, no tokens/error bodies/PII persisted. A restart resumes from the same row.
        jdbc.update("update content.member_withdrawal set attempts=least(attempts+1,1000000),next_attempt_at=now()+make_interval(secs => least(300,5*power(2,least(attempts,6)))::int) where member_id=? and status='PENDING'",memberId);
    }
}
