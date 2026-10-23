package com.yogimangchi.content.member.repository;

import com.yogimangchi.content.member.entity.Member;
import java.util.Optional;
import org.springframework.data.repository.Repository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;

public interface MemberRepository extends Repository<Member,Long> {
    Member save(Member member);
    Optional<Member> findById(Long id);
    boolean existsByNickname(String nickname);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from Member m where m.id=:id")
    Optional<Member> lockById(Long id);
}
