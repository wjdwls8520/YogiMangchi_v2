package com.yogimangchi.trading.tradingsymbol.service;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.ops.AdminAuditLogService;
import com.yogimangchi.trading.tradingsymbol.dto.AdminTradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class TradingSymbolService {
    private static final Logger log = LoggerFactory.getLogger(TradingSymbolService.class);

    private final TradingSymbolRepository repository;
    private final ObjectProvider<AdminAuditLogService> auditLogs;

    public TradingSymbolService(TradingSymbolRepository repository) {
        this(repository, null);
    }

    @Autowired
    public TradingSymbolService(TradingSymbolRepository repository, ObjectProvider<AdminAuditLogService> auditLogs) {
        this.repository = repository;
        this.auditLogs = auditLogs;
    }

    public List<TradingSymbolResponse> findActiveSymbols() {
        return repository.findAllByStatus(TradingSymbolStatus.ACTIVE);
    }

    public List<AdminTradingSymbolResponse> findAllForAdmin() {
        return repository.findAllOrdered().stream()
                .map(AdminTradingSymbolResponse::from)
                .toList();
    }

    @Transactional(timeout = 5)
    public AdminTradingSymbolResponse updateAdminStatus(Long symbolId, String targetStatus, Long adminMemberId) {
        if (targetStatus == null || targetStatus.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_SYMBOL_STATUS);
        }
        String normalized = targetStatus.strip().toUpperCase(Locale.ROOT);
        TradingSymbolStatus nextStatus = switch (normalized) {
            case "ACTIVE" -> TradingSymbolStatus.ACTIVE;
            case "HALTED" -> TradingSymbolStatus.HALTED;
            default -> throw new BusinessException(ErrorCode.INVALID_SYMBOL_STATUS);
        };
        if (symbolId == null || symbolId <= 0) {
            throw new BusinessException(ErrorCode.TRADING_SYMBOL_NOT_FOUND);
        }
        TradingSymbol symbol = repository.findById(symbolId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TRADING_SYMBOL_NOT_FOUND));
        TradingSymbolStatus previousStatus = symbol.getStatus();
        if (nextStatus == TradingSymbolStatus.ACTIVE) {
            symbol.activate();
        } else {
            symbol.halt();
        }
        log.info("[AdminAudit] action=SYMBOL_STATUS_UPDATE adminMemberId={} symbolId={} symbol={} previousStatus={} nextStatus={}",
                adminMemberId, symbol.getId(), symbol.getSymbol(), previousStatus, symbol.getStatus());
        AdminAuditLogService audit = auditLogs != null ? auditLogs.getIfAvailable() : null;
        if (audit != null) {
            audit.record(adminMemberId, "SYMBOL_STATUS_UPDATE", "TRADING_SYMBOL",
                    Long.toString(symbol.getId()),
                    "symbol=" + symbol.getSymbol() + " previousStatus=" + previousStatus + " nextStatus=" + symbol.getStatus());
        }
        return AdminTradingSymbolResponse.from(symbol);
    }
}
