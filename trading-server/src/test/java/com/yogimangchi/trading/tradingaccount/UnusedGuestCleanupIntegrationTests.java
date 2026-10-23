package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.fill.entity.Fill;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentialService;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import com.yogimangchi.trading.tradingaccount.service.UnusedGuestCleanupService;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties = {"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
class UnusedGuestCleanupIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired UnusedGuestCleanupService cleanup;
    @Autowired com.yogimangchi.trading.tradingaccount.service.MemberAccounts members;
    @Autowired GuestCredentialService credentials;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager em;
    @Autowired PlatformTransactionManager transactions;

    @Test void removesOnlyUnusedGuestAfterSevenDayGraceAndNeverRenewsCredentials() {
        var old = expiredGuest();
        var valid = accounts.createGuest();
        var grace = expiredGuest();
        jdbc.update("update trading.trading_account set credential_expires_at=now()-interval '6 days' where id=?", grace.accountId());
        var nonGuest = members.open(90000001L);
        assertThat(credentials.authenticate(old.accessToken())).isEmpty();
        assertThat(credentials.authenticate(valid.accessToken())).isPresent();
        assertThat(cleanup.cleanupBatch()).isEqualTo(1);
        assertThat(exists(old.accountId())).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from trading.wallet where account_id=?", Integer.class, old.accountId())).isZero();
        assertThat(exists(valid.accountId()) && exists(grace.accountId()) && exists(nonGuest.accountId())).isTrue();
        assertThat(cleanup.cleanupBatch()).isZero();
    }

    @Test void preservesPendingOpenPositionClosedHistoryFillsAndWalletEvenIfFinancialTimestampIsUntouched() {
        var pending = expiredGuest();
        var open = expiredGuest();
        var history = expiredGuest();
        var canceled = expiredGuest();
        transaction().executeWithoutResult(status -> {
            long symbol = jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'", Long.class);
            Instant now = Instant.now();
            var order = TradingOrder.limit(pending.accountId(), symbol, Position.Side.LONG, BigDecimal.ONE, 10,
                    new BigDecimal("900"), key(), "0".repeat(64), now);
            em.persist(order);
            em.find(Wallet.class, pending.accountId()).reserve(order.getReservedMargin());
            lotWithHistory(open.accountId(), symbol, false, now);
            lotWithHistory(history.accountId(), symbol, true, now);
            var canceledOrder = TradingOrder.limit(canceled.accountId(), symbol, Position.Side.SHORT, BigDecimal.ONE, 10,
                    new BigDecimal("1100"), key(), "0".repeat(64), now);
            canceledOrder.cancel(now); em.persist(canceledOrder);
        });
        List<Long> ids = List.of(pending.accountId(), open.accountId(), history.accountId(), canceled.accountId());
        var before = financialRows(ids);
        assertThat(cleanup.cleanupBatch()).isZero();
        assertThat(financialRows(ids)).isEqualTo(before);
        assertThat(ids).allMatch(this::exists);
        assertThat(jdbc.queryForObject("select count(*) from trading.fill f left join trading.trading_order o on o.id=f.order_id where o.id is null", Integer.class)).isZero();
    }

    @Test void walletOrFinancialChangesExcludeAnOtherwiseUnusedGuest() {
        var changed = expiredGuest(); var reserved = expiredGuest(); var touched = expiredGuest();
        jdbc.update("update trading.wallet set balance=10001 where account_id=?", changed.accountId());
        jdbc.update("update trading.wallet set reserved_margin=1 where account_id=?", reserved.accountId());
        jdbc.update("update trading.trading_account set last_financial_change_at=created_at+interval '1 second' where id=?", touched.accountId());
        assertThat(cleanup.cleanupBatch()).isZero();
        assertThat(exists(changed.accountId()) && exists(reserved.accountId()) && exists(touched.accountId())).isTrue();
    }

    @Test void batchIsBoundedAndConcurrentRunsCannotRemoveAnAccountTwice() throws Exception {
        var ids = new ArrayList<Long>();
        for (int i = 0; i < UnusedGuestCleanupService.BATCH_SIZE + 1; i++) ids.add(expiredGuest().accountId());
        var pool = Executors.newFixedThreadPool(2);
        try {
            var start = new CountDownLatch(1);
            var first = pool.submit(() -> { start.await(); return cleanup.cleanupBatch(); });
            var second = pool.submit(() -> { start.await(); return cleanup.cleanupBatch(); });
            start.countDown();
            int a = first.get(10, TimeUnit.SECONDS), b = second.get(10, TimeUnit.SECONDS);
            assertThat(a).isBetween(0, UnusedGuestCleanupService.BATCH_SIZE);
            assertThat(b).isBetween(0, UnusedGuestCleanupService.BATCH_SIZE);
            assertThat(a + b).isEqualTo(ids.size());
            assertThat(ids).noneMatch(this::exists);
        } finally { pool.shutdownNow(); }
    }

    @Test void tradingAccountLockIsSkippedAndCanBeCleanedAfterTheTransactionReleasesIt() throws Exception {
        var guest = expiredGuest();
        var pool = Executors.newSingleThreadExecutor();
        var locked = new CountDownLatch(1); var release = new CountDownLatch(1);
        var holder = pool.submit(() -> transaction().executeWithoutResult(status -> {
            jdbc.queryForObject("select id from trading.trading_account where id=? for update", Long.class, guest.accountId());
            locked.countDown();
            try { if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Test lock release timed out"); }
            catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new IllegalStateException(ex); }
        }));
        try {
            assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(cleanup.cleanupBatch()).isZero();
            assertThat(exists(guest.accountId())).isTrue();
        } finally { release.countDown(); holder.get(5, TimeUnit.SECONDS); pool.shutdownNow(); }
        assertThat(cleanup.cleanupBatch()).isEqualTo(1);
    }

    @Test void unexpectedForeignKeyRollsBackWalletDeletionAndKeepsAccountIntact() {
        var guest = expiredGuest();
        // Disposable Testcontainers DB only: emulate a future reference that cleanup must fail closed on.
        jdbc.execute("create table trading.guest_cleanup_test_reference(account_id bigint references trading.trading_account(id))");
        try {
            jdbc.update("insert into trading.guest_cleanup_test_reference values (?)", guest.accountId());
            assertThatThrownBy(cleanup::cleanupBatch).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(exists(guest.accountId())).isTrue();
            assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?", BigDecimal.class, guest.accountId())).isEqualByComparingTo("10000");
        } finally { jdbc.execute("drop table trading.guest_cleanup_test_reference"); }
        assertThat(cleanup.cleanupBatch()).isEqualTo(1);
    }

    private GuestAccountResponse expiredGuest() {
        var guest = accounts.createGuest();
        jdbc.update("""
                update trading.trading_account set created_at=now()-interval '15 days',
                    last_financial_change_at=now()-interval '15 days', credential_expires_at=now()-interval '8 days'
                where id=?
                """, guest.accountId());
        return guest;
    }
    private void lotWithHistory(long id, long symbol, boolean close, Instant now) {
        var position = Position.open(id, symbol, Position.Side.LONG, BigDecimal.ONE, new BigDecimal("1000"), 10, now);
        em.persist(position); em.flush();
        var wallet = em.find(Wallet.class, id); wallet.openMargin(position.getMargin());
        var order = TradingOrder.market(position, TradingOrder.Action.OPEN, BigDecimal.ONE, new BigDecimal("1000"), key(), "0".repeat(64), now);
        em.persist(order); em.flush();
        em.persist(Fill.execute(order.getId(), new BigDecimal("1000"), BigDecimal.ONE, now, now, BigDecimal.ZERO));
        if (close) {
            var settlement = position.close(BigDecimal.ONE, new BigDecimal("1100"), now, false);
            wallet.settle(settlement.releasedMargin(), settlement.realizedPnl());
            var closing = TradingOrder.market(position, TradingOrder.Action.CLOSE, BigDecimal.ONE, new BigDecimal("1100"), key(), "0".repeat(64), now);
            em.persist(closing); em.flush();
            em.persist(Fill.execute(closing.getId(), new BigDecimal("1100"), BigDecimal.ONE, now, now, settlement.realizedPnl()));
        }
    }
    private List<?> financialRows(List<Long> ids) {
        var result = new ArrayList<Object>();
        for (long id : ids) {
            result.add(jdbc.queryForList("select * from trading.wallet where account_id=?", id));
            result.add(jdbc.queryForList("select * from trading.position where account_id=? order by id", id));
            result.add(jdbc.queryForList("select * from trading.trading_order where account_id=? order by id", id));
            result.add(jdbc.queryForList("select f.* from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? order by f.id", id));
        }
        return result;
    }
    private boolean exists(long id) { return jdbc.queryForObject("select count(*) from trading.trading_account where id=?", Integer.class, id) == 1; }
    private TransactionTemplate transaction() { return new TransactionTemplate(transactions); }
    private static String key() { return UUID.randomUUID().toString(); }
}
