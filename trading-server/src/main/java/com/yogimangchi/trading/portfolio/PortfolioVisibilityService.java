package com.yogimangchi.trading.portfolio;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PortfolioVisibilityService {
    private final JdbcTemplate jdbc;
    private final TradingAccountRepository accounts;

    public PortfolioVisibilityService(JdbcTemplate jdbc, TradingAccountRepository accounts) {
        this.jdbc = jdbc;
        this.accounts = accounts;
    }

    @Transactional(readOnly = true, timeout = 3)
    public PortfolioVisibilityResponse get(Long memberId) {
        requireActiveMember(memberId);
        var rows = jdbc.queryForList(
                "SELECT portfolio_public, updated_at FROM trading.member_portfolio_preference WHERE member_id = ?",
                memberId);
        if (rows.isEmpty()) {
            return new PortfolioVisibilityResponse(memberId, true, null);
        }
        var row = rows.get(0);
        boolean isPublic = Boolean.TRUE.equals(row.get("portfolio_public"));
        Timestamp ts = (Timestamp) row.get("updated_at");
        return new PortfolioVisibilityResponse(memberId, isPublic, ts != null ? ts.toInstant() : null);
    }

    @Transactional(timeout = 3)
    public PortfolioVisibilityResponse update(Long memberId, PortfolioVisibilityRequest request) {
        requireActiveMember(memberId);
        if (request == null || request.portfolioPublic() == null) {
            throw new BusinessException(ErrorCode.INVALID_PORTFOLIO_PREFERENCE);
        }
        boolean portfolioPublic = request.portfolioPublic();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        OffsetDateTime tsNow = now.atOffset(ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO trading.member_portfolio_preference (member_id, portfolio_public, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT (member_id)
                DO UPDATE SET portfolio_public = EXCLUDED.portfolio_public,
                              updated_at = EXCLUDED.updated_at
                """, memberId, portfolioPublic, tsNow);
        return new PortfolioVisibilityResponse(memberId, portfolioPublic, now);
    }

    @Transactional(readOnly = true, timeout = 3)
    public boolean isPortfolioPublic(Long memberId) {
        if (memberId == null || memberId <= 0) {
            return true;
        }
        var rows = jdbc.queryForList(
                "SELECT portfolio_public FROM trading.member_portfolio_preference WHERE member_id = ?",
                Boolean.class, memberId);
        return rows.isEmpty() || Boolean.TRUE.equals(rows.get(0));
    }

    private void requireActiveMember(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        }
        if (accounts.existsByMemberIdAndStatus(memberId, TradingAccount.Status.WITHDRAWN)) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
    }
}
