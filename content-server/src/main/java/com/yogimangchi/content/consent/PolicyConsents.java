package com.yogimangchi.content.consent;

import com.yogimangchi.content.error.AuthFailure;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PolicyConsents {
    public record Acceptance(boolean termAgree,boolean privateAgree,String termsVersion,String privacyVersion) { }
    public record Policy(String type,String version,boolean required,boolean accepted,String lastAcceptedVersion,Instant lastAgreedAt,String documentUrl) { }
    public record State(List<Policy> policies,boolean reconsentRequired) { }
    private final JdbcTemplate jdbc;
    public PolicyConsents(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    @Transactional(readOnly=true,timeout=3)
    public State current(Long memberId) {
        var rows=jdbc.query("select p.policy_type,p.version,p.required,exists(select 1 from content.member_consent_history h where h.member_id=? and h.policy_type=p.policy_type and h.policy_version=p.version) accepted,(select h.policy_version from content.member_consent_history h where h.member_id=? and h.policy_type=p.policy_type order by h.agreed_at desc,h.id desc limit 1) last_version,(select h.agreed_at from content.member_consent_history h where h.member_id=? and h.policy_type=p.policy_type order by h.agreed_at desc,h.id desc limit 1) last_agreed_at from content.policy_version p where p.current order by p.policy_type",
            (r,n)->new Policy(r.getString(1),r.getString(2),r.getBoolean(3),r.getBoolean(4),r.getString(5),r.getTimestamp(6)==null?null:r.getTimestamp(6).toInstant(),"/api/v1/policies/"+r.getString(1)+"/"+r.getString(2)),memberId,memberId,memberId);
        return new State(rows,rows.stream().anyMatch(p->p.required()&&!p.accepted()));
    }
    public record Document(String type,String version,String documentStatus,String sha256,String text) { }
    @Transactional(readOnly=true,timeout=3)
    public Document document(String type,String version) {
        var docs=jdbc.query("select document_text,document_sha256 from content.policy_version where policy_type=? and version=?",(r,n)->new Document(type,version,"DEVELOPMENT_DRAFT",r.getString(2),r.getString(1)),type,version);
        if(docs.isEmpty())throw new AuthFailure("POLICY_NOT_FOUND",HttpStatus.NOT_FOUND);return docs.get(0);
    }
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void validate(Acceptance body) {
        // Keep policy activation from racing signup/reconsent. Policy versions are append-only.
        var current=jdbc.queryForList("select policy_type,version,required from content.policy_version where current order by policy_type for share");
        if(body==null || !body.termAgree() || !body.privateAgree() || current.size()!=2
            || current.stream().anyMatch(p->!p.get("version").equals(p.get("policy_type").equals("TERMS")?body.termsVersion():body.privacyVersion())))
            throw new AuthFailure("POLICY_VERSION_OR_CONSENT_INVALID",HttpStatus.CONFLICT);
    }
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void record(Long memberId,Acceptance body,Instant now) {
        validate(body);
        for(var entry:Map.of("TERMS",body.termsVersion(),"PRIVACY",body.privacyVersion()).entrySet())
            jdbc.update("insert into content.member_consent_history(member_id,policy_type,policy_version,accepted,agreed_at) values (?,?,?,true,?) on conflict(member_id,policy_type,policy_version) do nothing",memberId,entry.getKey(),entry.getValue(),now.atOffset(ZoneOffset.UTC));
    }
    @Transactional(timeout=5)
    public State accept(Long memberId,Acceptance body) {
        var status=jdbc.queryForList("select status from content.member where id=? for update",String.class,memberId);
        if(status.isEmpty() || !status.get(0).equals("ACTIVE")) throw AuthFailure.unauthorized();
        record(memberId,body,Instant.now());return current(memberId);
    }
}
