package com.yogimangchi.content.auth.repository;

import com.yogimangchi.content.auth.entity.RefreshSession;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.*;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.Repository;

public interface RefreshSessionRepository extends Repository<RefreshSession,Long> {
    RefreshSession save(RefreshSession session);
    @Query("select r.memberId from RefreshSession r where r.tokenHash=:hash")
    Optional<Long> memberByHash(String hash);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from RefreshSession r where r.tokenHash=:hash")
    Optional<RefreshSession> lockByHash(String hash);
    @Modifying
    @Query("update RefreshSession r set r.status=com.yogimangchi.content.auth.entity.RefreshSession.Status.REVOKED,r.consumedAt=:now where r.familyId=:family and r.status<>com.yogimangchi.content.auth.entity.RefreshSession.Status.REVOKED")
    int revokeFamily(UUID family,Instant now);
    @Modifying
    @Query("update RefreshSession r set r.status=com.yogimangchi.content.auth.entity.RefreshSession.Status.REVOKED,r.consumedAt=:now where r.memberId=:memberId and r.status<>com.yogimangchi.content.auth.entity.RefreshSession.Status.REVOKED")
    int revokeMember(Long memberId,Instant now);
}
