package com.yogimangchi.content.member.entity;

import jakarta.persistence.*;

@Entity
@Table(name="oauth_identity")
public class OAuthIdentity {
    public enum Provider { GOOGLE, KAKAO }
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false,updatable=false) private Long memberId;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16,updatable=false) private Provider provider;
    @Column(nullable=false,length=255,updatable=false) private String providerSubject;
    @Column(nullable=false,length=320,updatable=false) private String email;
    protected OAuthIdentity() { }
    public static OAuthIdentity link(Long memberId,Provider provider,String subject,String email) {
        var identity=new OAuthIdentity(); identity.memberId=memberId; identity.provider=provider;
        identity.providerSubject=subject; identity.email=email; return identity;
    }
    public Long getMemberId() { return memberId; }
}
