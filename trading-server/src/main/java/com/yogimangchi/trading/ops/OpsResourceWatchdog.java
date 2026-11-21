package com.yogimangchi.trading.ops;

import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Lightweight 60-second JVM heap and HikariCP pool starvation watchdog.
 * Emits rate-limited OpsAlertService alerts when JVM heap > 85% or Hikari threadsAwaitingConnection > 0.
 */
@Component
public class OpsResourceWatchdog {
    private static final Logger log = LoggerFactory.getLogger(OpsResourceWatchdog.class);
    static final double HEAP_ALERT_THRESHOLD_PERCENT = 85.0;

    private final OpsAlertService alerts;
    private final ObjectProvider<DataSource> dataSourceProvider;
    private final MemoryMXBean memoryBean;
    private final boolean enabled;

    @Autowired
    public OpsResourceWatchdog(
            OpsAlertService alerts,
            ObjectProvider<DataSource> dataSourceProvider,
            @Value("${trading.ops.resource-watchdog-enabled:true}") boolean enabled) {
        this(alerts, dataSourceProvider, ManagementFactory.getMemoryMXBean(), enabled);
    }

    OpsResourceWatchdog(
            OpsAlertService alerts,
            ObjectProvider<DataSource> dataSourceProvider,
            MemoryMXBean memoryBean,
            boolean enabled) {
        this.alerts = alerts;
        this.dataSourceProvider = dataSourceProvider;
        this.memoryBean = memoryBean;
        this.enabled = enabled;
    }

    @Scheduled(
            fixedDelayString = "${trading.ops.resource-watchdog-interval-ms:60000}",
            initialDelayString = "${trading.ops.resource-watchdog-initial-delay-ms:60000}")
    public void scheduledCheck() {
        if (!enabled) {
            return;
        }
        checkNow();
    }

    public void checkNow() {
        checkHeapUsage();
        checkHikariPool();
    }

    private void checkHeapUsage() {
        try {
            MemoryUsage heap = memoryBean.getHeapMemoryUsage();
            long used = Math.max(0L, heap.getUsed());
            long max = heap.getMax() > 0 ? heap.getMax() : Runtime.getRuntime().maxMemory();
            if (max <= 0) {
                return;
            }
            double pct = Math.round((used * 1000.0) / max) / 10.0;
            if (pct > HEAP_ALERT_THRESHOLD_PERCENT) {
                long usedMb = used / (1024L * 1024L);
                long maxMb = max / (1024L * 1024L);
                log.warn("[OpsWatchdog] JVM heap usage high usedMb={} maxMb={} usagePct={}", usedMb, maxMb, pct);
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("heapUsedMb", usedMb);
                details.put("heapMaxMb", maxMb);
                details.put("heapUsagePercent", pct);
                alerts.alert("jvm-heap-high", "WARN", "Trading Server JVM heap usage exceeded 85%", details);
            }
        } catch (RuntimeException ex) {
            log.debug("[OpsWatchdog] heap check skipped cause={}", ex.getClass().getSimpleName());
        }
    }

    private void checkHikariPool() {
        DataSource dataSource = dataSourceProvider != null ? dataSourceProvider.getIfAvailable() : null;
        if (dataSource == null) {
            return;
        }
        try {
            HikariDataSource hikari = unwrapHikari(dataSource);
            if (hikari == null) {
                return;
            }
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            if (pool == null) {
                return;
            }
            int awaiting = pool.getThreadsAwaitingConnection();
            if (awaiting > 0) {
                int active = pool.getActiveConnections();
                int idle = pool.getIdleConnections();
                int total = pool.getTotalConnections();
                int max = hikari.getMaximumPoolSize();
                log.warn("[OpsWatchdog] HikariCP pool starvation awaiting={} active={} idle={} total={} max={}",
                        awaiting, active, idle, total, max);
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("pending", awaiting);
                details.put("active", active);
                details.put("idle", idle);
                details.put("total", total);
                details.put("max", max);
                alerts.alert("hikari-pool-starvation", "CRITICAL", "HikariCP threads awaiting DB connection", details);
            }
        } catch (RuntimeException ex) {
            log.debug("[OpsWatchdog] hikari check skipped cause={}", ex.getClass().getSimpleName());
        }
    }

    static HikariDataSource unwrapHikari(DataSource dataSource) {
        if (dataSource instanceof HikariDataSource hikari) {
            return hikari;
        }
        try {
            if (dataSource.isWrapperFor(HikariDataSource.class)) {
                return dataSource.unwrap(HikariDataSource.class);
            }
        } catch (SQLException ignored) {
            // Non-Hikari datasource
        }
        return null;
    }
}
