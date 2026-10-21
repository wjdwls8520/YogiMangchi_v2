package com.yogimangchi.content.member.repository;

import com.yogimangchi.content.member.entity.Member;
import java.util.Optional;
import org.springframework.data.repository.Repository;

public interface MemberRepository extends Repository<Member,Long> {
    Member save(Member member);
    Optional<Member> findById(Long id);
    boolean existsByNickname(String nickname);
}
