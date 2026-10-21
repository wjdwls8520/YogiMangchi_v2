package com.yogimangchi.content.member.repository;

import com.yogimangchi.content.member.entity.OAuthIdentity;
import java.util.Optional;
import org.springframework.data.repository.Repository;

public interface OAuthIdentityRepository extends Repository<OAuthIdentity,Long> {
    OAuthIdentity save(OAuthIdentity identity);
    Optional<OAuthIdentity> findByProviderAndProviderSubject(OAuthIdentity.Provider provider,String subject);
}
