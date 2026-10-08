package com.yogimangchi.trading.binance.subscription;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolProvider;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@Transactional
class BinanceSubscriptionTargetLoaderIntegrationTests {

    @Autowired private BinanceSubscriptionTargetLoader loader;
    @Autowired private EntityManager entityManager;

    @ParameterizedTest
    @CsvSource({"BTC, BTCUSDT", "PEPE, 1000PEPEUSDT", "SHIB, 1000SHIBUSDT"})
    void preservesInternalIdAndSeparateDomainAndProviderSymbols(String symbol, String providerSymbol) {
        Long id = findSymbol(symbol).getId();

        assertThat(loader.loadActiveTargets())
                .hasSize(12)
                .contains(new BinanceSubscriptionTarget(id, symbol, providerSymbol));
    }

    @Test
    void excludesInactiveSymbolAndKeepsOtherActiveTargets() {
        TradingSymbol bitcoin = findSymbol("BTC");
        Long id = bitcoin.getId();
        bitcoin.deactivate();
        entityManager.flush();
        entityManager.clear();

        assertThat(loader.loadActiveTargets())
                .hasSize(11)
                .extracting(BinanceSubscriptionTarget::tradingSymbolId)
                .doesNotContain(id)
                .contains(findSymbol("ETH").getId());
        assertThat(entityManager.find(TradingSymbol.class, id).getStatus())
                .isEqualTo(TradingSymbolStatus.INACTIVE);
    }

    @Test
    void reloadsDatabaseManagedTargetsAfterActivationAndInactivation() {
        assertThat(loader.loadActiveTargets()).hasSize(12);
        TradingSymbol symbol = TradingSymbol.register(
                "Test Coin", "TEST", "USDT", TradingSymbolProvider.BINANCE, "TESTUSDT");
        entityManager.persist(symbol);
        entityManager.flush();
        BinanceSubscriptionTarget target = new BinanceSubscriptionTarget(symbol.getId(), "TEST", "TESTUSDT");
        assertThat(loader.loadActiveTargets()).hasSize(12).doesNotContain(target);

        symbol.activate();
        entityManager.flush();
        assertThat(loader.loadActiveTargets()).hasSize(13).contains(target);

        symbol.deactivate();
        entityManager.flush();
        assertThat(loader.loadActiveTargets()).hasSize(12).doesNotContain(target);
    }

    @Test
    void reloadsProviderMappingWithoutChangingInternalIdentity() {
        TradingSymbol symbol = findSymbol("PEPE");
        Long id = symbol.getId();
        BinanceSubscriptionTarget original = new BinanceSubscriptionTarget(id, "PEPE", "1000PEPEUSDT");
        assertThat(loader.loadActiveTargets()).contains(original);

        symbol.changeProviderSymbol("TESTPEPEUSDT");
        entityManager.flush();
        entityManager.clear();

        assertThat(loader.loadActiveTargets())
                .hasSize(12)
                .doesNotContain(original)
                .contains(new BinanceSubscriptionTarget(id, "PEPE", "TESTPEPEUSDT"));
    }

    @Test
    void returnsEmptyListWhenNoSymbolIsActive() {
        entityManager.createQuery("from TradingSymbol", TradingSymbol.class)
                .getResultList().forEach(TradingSymbol::deactivate);
        entityManager.flush();
        entityManager.clear();

        assertThat(loader.loadActiveTargets()).isEmpty();
    }

    private TradingSymbol findSymbol(String symbol) {
        return entityManager.createQuery("from TradingSymbol where symbol = :symbol", TradingSymbol.class)
                .setParameter("symbol", symbol).getSingleResult();
    }
}
