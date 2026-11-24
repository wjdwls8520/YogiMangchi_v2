package com.yogimangchi.content.member.entity;

import com.yogimangchi.content.member.validation.NicknamePolicy;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="member")
public class Member {
    public enum Status { ACTIVE, WITHDRAWING, WITHDRAWN, SUSPENDED, BANNED }
    public enum Role { MEMBER, ADMIN }
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(length=12,unique=true) private String nickname;
    @Column(nullable=false,length=300) private String profileMessage;
    @Column(name="profile_img_url",length=1000) private String profileImgUrl;
    @Column(name="profile_img_s3_key",length=512) private String profileImgS3Key;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private Status status;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private Role role;
    private Instant termsAgreedAt;
    private Instant privacyAgreedAt;
    @Column(nullable=false,updatable=false) private Instant createdAt;
    private Instant withdrawnAt;
    @Column(name="suspended_at") private Instant suspendedAt;
    @Column(name="suspended_reason",length=500) private String suspendedReason;
    protected Member() { }
    public static Member signup(String nickname,String message,Instant now) {
        if(!NicknamePolicy.isValid(nickname)) throw new IllegalArgumentException("Invalid member nickname");
        Member member=new Member(); member.nickname=nickname; member.profileMessage=message;
        member.status=Status.ACTIVE; member.role=Role.MEMBER;
        member.termsAgreedAt=now; member.privacyAgreedAt=now; member.createdAt=now;
        return member;
    }
    public Long getId() { return id; }
    public void beginWithdrawal() {
        if(status==Status.ACTIVE || status==Status.SUSPENDED) status=Status.WITHDRAWING;
    }
    public void suspend(Instant now,String reason) {
        if(status!=Status.ACTIVE && status!=Status.SUSPENDED)
            throw new IllegalStateException("Only ACTIVE or SUSPENDED members can be suspended");
        this.status=Status.SUSPENDED;
        this.suspendedAt=java.util.Objects.requireNonNull(now);
        this.suspendedReason=reason;
    }
    public void ban(Instant now,String reason) {
        if(status==Status.WITHDRAWN)
            throw new IllegalStateException("Withdrawn members cannot be banned");
        this.status=Status.BANNED;
        this.suspendedAt=java.util.Objects.requireNonNull(now);
        this.suspendedReason=reason;
    }
    public void unsuspend() {
        if(status!=Status.SUSPENDED)
            throw new IllegalStateException("Only SUSPENDED members can be unsuspended");
        this.status=Status.ACTIVE;
        this.suspendedAt=null;
        this.suspendedReason=null;
    }
    public void withdraw(Instant now) {
        if(status==Status.WITHDRAWN) return;
        status=Status.WITHDRAWN; nickname=null; withdrawnAt=java.util.Objects.requireNonNull(now);
        profileMessage="";profileImgUrl=null;profileImgS3Key=null;termsAgreedAt=null;privacyAgreedAt=null;
        suspendedAt=null;suspendedReason=null;
    }
    public void changeBasicProfile(String nickname,String message) {
        if(status!=Status.ACTIVE || nickname!=null && !NicknamePolicy.isValid(nickname) || message==null || message.length()>255 || message.indexOf('\0')>=0)
            throw new IllegalArgumentException("Invalid member profile");
        // Omitted nickname preserves old data without revalidating or rewriting it.
        if(nickname!=null) this.nickname=nickname;
        this.profileMessage=message;
    }
    public void changeProfileImage(String profileImgUrl,String profileImgS3Key) {
        if(status!=Status.ACTIVE) throw new IllegalArgumentException("Inactive member cannot change profile image");
        this.profileImgUrl=profileImgUrl;
        this.profileImgS3Key=profileImgS3Key;
    }
    public String getNickname() { return nickname; }
    public String getProfileMessage() { return profileMessage; }
    public String getProfileImgUrl() { return profileImgUrl; }
    public String getProfileImgS3Key() { return profileImgS3Key; }
    public Status getStatus() { return status; }
    public Role getRole() { return role; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getWithdrawnAt() { return withdrawnAt; }
    public Instant getSuspendedAt() { return suspendedAt; }
    public String getSuspendedReason() { return suspendedReason; }
}
