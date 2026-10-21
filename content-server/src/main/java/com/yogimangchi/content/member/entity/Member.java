package com.yogimangchi.content.member.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="member")
public class Member {
    public enum Status { ACTIVE, WITHDRAWN }
    public enum Role { MEMBER, ADMIN }
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false,length=12,unique=true) private String nickname;
    @Column(nullable=false,length=300) private String profileMessage;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private Status status;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private Role role;
    @Column(nullable=false,updatable=false) private Instant termsAgreedAt;
    @Column(nullable=false,updatable=false) private Instant privacyAgreedAt;
    @Column(nullable=false,updatable=false) private Instant createdAt;
    private Instant withdrawnAt;
    protected Member() { }
    public static Member signup(String nickname,String message,Instant now) {
        Member member=new Member(); member.nickname=nickname; member.profileMessage=message;
        member.status=Status.ACTIVE; member.role=Role.MEMBER;
        member.termsAgreedAt=now; member.privacyAgreedAt=now; member.createdAt=now;
        return member;
    }
    public Long getId() { return id; }
    public String getNickname() { return nickname; }
    public String getProfileMessage() { return profileMessage; }
    public Status getStatus() { return status; }
    public Role getRole() { return role; }
    public Instant getCreatedAt() { return createdAt; }
}
