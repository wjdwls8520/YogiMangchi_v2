package com.yogimangchi.content.member.service;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class MemberProvisioning {
    private final JdbcTemplate jdbc;
    public MemberProvisioning(JdbcTemplate jdbc){this.jdbc=jdbc;}
    @Transactional(propagation=Propagation.MANDATORY)
    public void enqueue(Long member){jdbc.update("insert into content.member_trading_provision(member_id,status) values (?,'PENDING') on conflict(member_id) do nothing",member);}
    @Transactional(readOnly=true,timeout=3)
    public List<Long> pending(){return jdbc.queryForList("select p.member_id from content.member_trading_provision p join content.member m on m.id=p.member_id where p.status='PENDING' and m.status='ACTIVE' and p.next_attempt_at<=now() order by p.next_attempt_at,p.member_id limit 10",Long.class);}
    @Transactional(timeout=3)
    public void acknowledged(Long id){jdbc.update("update content.member_trading_provision set status='COMPLETED' where member_id=? and status='PENDING'",id);}
    @Transactional(timeout=3)
    public void failed(Long id){jdbc.update("update content.member_trading_provision set attempts=least(attempts+1,1000000),next_attempt_at=now()+make_interval(secs=>least(300,5*power(2,least(attempts,6)))::int) where member_id=? and status='PENDING'",id);}
}
