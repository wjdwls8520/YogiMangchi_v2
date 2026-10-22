package com.yogimangchi.content.member.service;

import com.yogimangchi.content.member.dto.*;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import com.yogimangchi.content.error.AuthFailure;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Relation changes are serialized by both Member rows in ascending ID order, also against withdrawal. */
@Service
public class MemberFollows {
    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    public MemberFollows(MemberRepository members,JdbcTemplate jdbc) { this.members=members; this.jdbc=jdbc; }
    public record Summary(Long memberId,long followerCount,long followingCount,boolean followed,boolean follower,boolean mine) { }
    @Transactional(timeout=5)
    public FollowResponse change(Long actorId,Long targetId,boolean follow) {
        if(actorId==null || actorId<=0) throw AuthFailure.unauthorized();
        if(targetId==null || targetId<=0 || actorId.equals(targetId)) throw invalid();
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var first=members.lockById(Math.min(actorId,targetId));
        var second=members.lockById(Math.max(actorId,targetId));
        var actor=actorId<targetId ? first : second;
        var target=actorId<targetId ? second : first;
        actor.filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(AuthFailure::unauthorized);
        target.filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(MemberFollows::notFound);
        if(follow) jdbc.update("insert into content.member_follow(follower_id,following_id,active,created_at) values (?,?,true,now()) on conflict(follower_id,following_id) where active do nothing",actorId,targetId);
        else jdbc.update("update content.member_follow set active=false,deactivated_at=now() where follower_id=? and following_id=? and active",actorId,targetId);
        return new FollowResponse(targetId,counts(targetId)[0],follow);
    }
    @Transactional(readOnly=true,timeout=3)
    public Summary summary(Long memberId,Long viewerId) {
        active(memberId);
        if(viewerId!=null) members.findById(viewerId).filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(AuthFailure::unauthorized);
        long[] counts=counts(memberId);
        boolean followed=viewerId!=null && relation(viewerId,memberId);
        boolean follower=viewerId!=null && relation(memberId,viewerId);
        return new Summary(memberId,counts[0],counts[1],followed,follower,memberId.equals(viewerId));
    }
    @Transactional(readOnly=true,timeout=3)
    public FollowPage list(Long memberId,boolean followers,Long cursorId,Integer size,String keyword) {
        int limit=size==null ? 10 : size;
        if(limit<1 || limit>10 || cursorId!=null && cursorId<=0 || keyword!=null && (keyword.codePointCount(0,keyword.length())>12 || keyword.indexOf('\0')>=0)) throw invalid();
        active(memberId);
        String owner=followers ? "following_id" : "follower_id",other=followers ? "follower_id" : "following_id";
        String search=keyword==null ? "" : keyword.strip();
        var rows=jdbc.query("select f.id,m.id member_id,m.nickname,m.profile_message,f.created_at from content.member_follow f join content.member m on m.id=f."+other
                +" where f."+owner+"=? and f.active and m.status='ACTIVE' and f.id<? and position(lower(?) in lower(m.nickname))>0 order by f.id desc limit ?",
                (r,n) -> new Row(r.getLong("id"),new FollowPage.Entry(r.getLong("member_id"),r.getString("nickname"),r.getString("profile_message"),r.getTimestamp("created_at").toInstant())),
                memberId,cursorId==null ? Long.MAX_VALUE : cursorId,search,limit+1);
        boolean hasNext=rows.size()>limit; var page=rows.subList(0,Math.min(limit,rows.size()));
        Long next=hasNext ? page.get(page.size()-1).id() : null;
        return new FollowPage(page.stream().map(Row::entry).toList(),next,hasNext);
    }
    private record Row(Long id,FollowPage.Entry entry) { }
    private long[] counts(Long id) {
        return jdbc.queryForObject("select count(*) filter(where f.following_id=?) followers,count(*) filter(where f.follower_id=?) followings from content.member_follow f join content.member a on a.id=f.follower_id join content.member b on b.id=f.following_id where f.active and a.status='ACTIVE' and b.status='ACTIVE' and (f.following_id=? or f.follower_id=?)",
                (r,n) -> new long[]{r.getLong("followers"),r.getLong("followings")},id,id,id,id);
    }
    private boolean relation(Long from,Long to) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from content.member_follow where follower_id=? and following_id=? and active)",Boolean.class,from,to));
    }
    private void active(Long id) {
        if(id==null || id<=0) throw notFound();
        members.findById(id).filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(MemberFollows::notFound);
    }
    private static AuthFailure invalid() { return new AuthFailure("INVALID_FOLLOW_REQUEST",HttpStatus.BAD_REQUEST); }
    private static AuthFailure notFound() { return new AuthFailure("MEMBER_NOT_FOUND",HttpStatus.NOT_FOUND); }
}
