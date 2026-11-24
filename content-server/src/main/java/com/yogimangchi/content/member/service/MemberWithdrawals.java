package com.yogimangchi.content.member.service;

import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberWithdrawals {
    public record Result(String status) { }

    public static final String ANONYMIZED_INQUIRY_TITLE = "탈퇴한 회원의 문의입니다.";
    public static final String ANONYMIZED_INQUIRY_CONTENT = "회원 탈퇴로 인해 문의 내용이 삭제되었습니다.";
    public static final String ANONYMIZED_INQUIRY_REPLY = "회원 탈퇴로 인해 답변 내용이 삭제되었습니다.";

    private final MemberRepository members;
    private final RefreshSessionRepository refresh;
    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;
    private final com.yogimangchi.content.notification.ContentNotificationSseService notificationSse;

    public MemberWithdrawals(MemberRepository members, RefreshSessionRepository refresh, JdbcTemplate jdbc, CommunityS3Service s3) {
        this(members, refresh, jdbc, s3, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public MemberWithdrawals(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3,
            com.yogimangchi.content.notification.ContentNotificationSseService notificationSse) {
        this.members = members;
        this.refresh = refresh;
        this.jdbc = jdbc;
        this.s3 = s3;
        this.notificationSse = notificationSse;
    }

    @Transactional(timeout = 5)
    public Result request(
            Long memberId,
            com.yogimangchi.content.member.dto.WithdrawalRequest body,
            com.yogimangchi.content.auth.oauth.VerifiedIdentity proof) {
        if (body == null) {
            throw new AuthFailure("WITHDRAWAL_CONFIRMATION_REQUIRED", org.springframework.http.HttpStatus.BAD_REQUEST);
        }
        body.validate();
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var member = members.lockById(memberId).orElseThrow(AuthFailure::unauthorized);
        Instant now = Instant.now();
        if (member.getStatus() == Member.Status.ACTIVE || member.getStatus() == Member.Status.SUSPENDED) {
            if (proof == null) {
                throw AuthFailure.unauthorized();
            }
            proof.requireFresh();
            if (!Boolean.TRUE.equals(jdbc.queryForObject(
                    "select exists(select 1 from content.oauth_identity where member_id=? and provider=? and provider_subject=?)",
                    Boolean.class, memberId, proof.provider().name(), proof.subject()))) {
                throw AuthFailure.unauthorized();
            }
            member.beginWithdrawal();
        }
        jdbc.update("update content.member_follow set active=false,deactivated_at=now() where active and (follower_id=? or following_id=?)",
                memberId, memberId);
        refresh.revokeMember(memberId, now);
        jdbc.update("update content.member_trading_provision set status='CANCELED' where member_id=? and status='PENDING'", memberId);
        jdbc.update(
                "insert into content.member_withdrawal(member_id,status,requested_at,next_attempt_at,confirmation_version,confirmed_at) values (?,'PENDING',?,?,?,?) on conflict(member_id) do nothing",
                memberId, java.sql.Timestamp.from(now), java.sql.Timestamp.from(now), body.policyVersion(), java.sql.Timestamp.from(now));
        if (notificationSse != null && org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            notificationSse.disconnectMember(memberId);
                        }
                    });
        }
        return new Result(jdbc.queryForObject("select status from content.member_withdrawal where member_id=?", String.class, memberId));
    }

    @Transactional(readOnly = true, timeout = 3)
    public Result status(Long memberId) {
        var rows = jdbc.queryForList("select status from content.member_withdrawal where member_id=?", String.class, memberId);
        return new Result(rows.isEmpty() ? "NOT_REQUESTED" : rows.get(0));
    }

    @Transactional(readOnly = true, timeout = 3)
    public List<Long> pending() {
        return jdbc.queryForList(
                "select member_id from content.member_withdrawal where status='PENDING' and next_attempt_at<=now() order by next_attempt_at,member_id limit 10",
                Long.class);
    }

    @Transactional(timeout = 5)
    public void delivered(Long memberId) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var member = members.lockById(memberId).orElseThrow();
        if (jdbc.queryForObject("select count(*) from content.member_withdrawal where member_id=?", Long.class, memberId) == 0) {
            return;
        }
        // Privacy/security destruction + counter reconciliation; business IDs and financial histories remain intact.
        cleanupMemberPiiAndInteractions(jdbc, memberId);
        if (member.getProfileImgS3Key() != null && !member.getProfileImgS3Key().isBlank()) {
            s3.registerAfterCommitDelete(List.of(member.getProfileImgS3Key()), "MEMBER_WITHDRAWN");
        }
        member.withdraw(Instant.now());
        jdbc.update("update content.member_withdrawal set status='COMPLETED',completed_at=now() where member_id=? and status='PENDING'",
                memberId);
        if (notificationSse != null && org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            notificationSse.disconnectMember(memberId);
                        }
                    });
        }
    }

    @Transactional(timeout = 3)
    public int failed(Long memberId) {
        // Bounded delay, no tokens/error bodies/PII persisted. A restart resumes from the same row.
        var rows = jdbc.queryForList(
                "update content.member_withdrawal set attempts=least(attempts+1,1000000),next_attempt_at=now()+make_interval(secs => least(300,5*power(2,least(attempts,6)))::int) where member_id=? and status='PENDING' returning attempts",
                Integer.class, memberId);
        return rows.isEmpty() ? 0 : rows.get(0);
    }

    /**
     * Shared transactional PII scrubbing and like/reaction counter reconciliation used by both
     * voluntary withdrawal completion and admin force-withdrawal.
     */
    public static void cleanupMemberPiiAndInteractions(JdbcTemplate jdbc, Long memberId) {
        jdbc.update("delete from content.oauth_identity where member_id=?", memberId);
        jdbc.update("delete from content.refresh_session where member_id=?", memberId);
        jdbc.update("delete from content.member_consent_history where member_id=?", memberId);
        jdbc.update("delete from content.notification_group_state where receiver_member_id=?", memberId);
        jdbc.update("delete from content.notification_dedupe_state where receiver_member_id=? or actor_member_id=?", memberId, memberId);
        jdbc.update("delete from content.notification_state where member_id=?", memberId);
        jdbc.update("delete from content.notification where receiver_member_id=?", memberId);

        // Anonymize 1:1 support inquiry PII while keeping ticket referential integrity
        jdbc.update("""
                update content.support_inquiry
                set title = ?,
                    content = ?,
                    admin_reply = case when admin_reply is not null then ? else null end,
                    status = 'CLOSED',
                    closed_at = coalesce(closed_at, now()),
                    updated_at = now()
                where member_id = ?
                """, ANONYMIZED_INQUIRY_TITLE, ANONYMIZED_INQUIRY_CONTENT, ANONYMIZED_INQUIRY_REPLY, memberId);

        // Delete member's news reactions and reconcile cached bull_count / bear_count atomically
        String reactionActorKey = "member:" + memberId;
        jdbc.update("""
                with removed as (
                    delete from content.news_article_reaction
                    where actor_key = ?
                    returning article_id, reaction_type
                ),
                deltas as (
                    select article_id,
                           count(*) filter (where reaction_type = 'BULL') as bull_removed,
                           count(*) filter (where reaction_type = 'BEAR') as bear_removed
                    from removed
                    group by article_id
                )
                update content.news_article a
                set bull_count = greatest(0, a.bull_count - d.bull_removed),
                    bear_count = greatest(0, a.bear_count - d.bear_removed)
                from deltas d
                where a.id = d.article_id
                """, reactionActorKey);

        // Delete member's news view history & daily community view dedupe entries
        jdbc.update("delete from content.news_article_member_view where member_id = ?", memberId);
        jdbc.update("delete from content.community_post_viewer_daily where viewer_key = ?", "m:" + memberId);

        // Delete member's community post & comment likes and reconcile like_count atomically.
        // Note: PostgreSQL CTEs share a single MVCC snapshot with the outer UPDATE, so we MUST
        // subtract deleted counts from RETURNING rows rather than re-counting the deleted table.
        jdbc.update("""
                with removed as (
                    delete from content.community_post_like
                    where member_id = ?
                    returning post_id
                ),
                deltas as (
                    select post_id, count(*) as removed_count
                    from removed
                    group by post_id
                )
                update content.community_post p
                set like_count = greatest(0, p.like_count - d.removed_count)
                from deltas d
                where p.id = d.post_id
                """, memberId);

        jdbc.update("""
                with removed as (
                    delete from content.community_comment_like
                    where member_id = ?
                    returning comment_id
                ),
                deltas as (
                    select comment_id, count(*) as removed_count
                    from removed
                    group by comment_id
                )
                update content.community_comment c
                set like_count = greatest(0, c.like_count - d.removed_count)
                from deltas d
                where c.id = d.comment_id
                """, memberId);
    }
}
