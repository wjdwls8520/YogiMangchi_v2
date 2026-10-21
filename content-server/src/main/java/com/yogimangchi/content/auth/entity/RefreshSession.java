package com.yogimangchi.content.auth.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name="refresh_session")
public class RefreshSession {
    public enum Status { ACTIVE, ROTATED, REVOKED }
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false,updatable=false) private UUID familyId;
    @Column(nullable=false,updatable=false) private Long memberId;
    @Column(nullable=false,length=64,unique=true,updatable=false) private String tokenHash;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private Status status;
    @Column(nullable=false,updatable=false) private Instant createdAt;
    @Column(nullable=false,updatable=false) private Instant expiresAt;
    private Instant consumedAt;
    protected RefreshSession() { }
    public static RefreshSession issue(UUID family,Long member,String hash,Instant now,Instant expires) {
        var session=new RefreshSession(); session.familyId=family; session.memberId=member; session.tokenHash=hash;
        session.status=Status.ACTIVE; session.createdAt=now; session.expiresAt=expires; return session;
    }
    public void rotate(Instant now) {
        if(status!=Status.ACTIVE) throw new IllegalStateException("Refresh session is not active");
        status=Status.ROTATED; consumedAt=now;
    }
    public UUID getFamilyId() { return familyId; }
    public Long getMemberId() { return memberId; }
    public Status getStatus() { return status; }
    public Instant getExpiresAt() { return expiresAt; }
}
