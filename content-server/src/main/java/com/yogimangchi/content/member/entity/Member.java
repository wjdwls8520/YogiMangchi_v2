package com.yogimangchi.content.member.entity;

import jakarta.persistence.*;
import java.time.Instant;
import com.yogimangchi.content.member.validation.NicknamePolicy;

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
        if(!NicknamePolicy.isValid(nickname)) throw new IllegalArgumentException("Invalid member nickname");
        Member member=new Member(); member.nickname=nickname; member.profileMessage=message;
        member.status=Status.ACTIVE; member.role=Role.MEMBER;
        member.termsAgreedAt=now; member.privacyAgreedAt=now; member.createdAt=now;
        return member;
    }
    public Long getId() { return id; }
    public void withdraw(Instant now) {
        if(status==Status.WITHDRAWN) return;
        status=Status.WITHDRAWN; withdrawnAt=java.util.Objects.requireNonNull(now);
        profileMessage="";
    }
    public void changeBasicProfile(String nickname,String message) {
        if(nickname!=null && !NicknamePolicy.isValid(nickname) || message==null || message.length()>255 || message.indexOf('\0')>=0)
            throw new IllegalArgumentException("Invalid member profile");
        // Omitted nickname preserves old data without revalidating or rewriting it.
        if(nickname!=null) this.nickname=nickname;
        this.profileMessage=message;
    }
    public String getNickname() { return nickname; }
    public String getProfileMessage() { return profileMessage; }
    public Status getStatus() { return status; }
    public Role getRole() { return role; }
    public Instant getCreatedAt() { return createdAt; }
}
