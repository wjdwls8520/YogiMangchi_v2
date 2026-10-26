import { orderReason } from "./order-reason";
import { TradingApiError } from "./client";
import type { SessionSnapshot } from "./guest-session";
import type { TradingOrder } from "./orders";
import { SERVER_MAX_LEVERAGE, validLimitPrice, validQuantity } from "./order-input";

export type TradingCommand =
  | { kind: "open"; tradingSymbolId: number; type: "MARKET" | "LIMIT"; side: "LONG" | "SHORT"; quantity: string; leverage: number; limitPrice?: string }
  | { kind: "close"; positionId: number; quantity?: string }
  | { kind: "limitClose"; positionId: number; quantity?: string; limitPrice: string }
  | { kind: "cancel"; orderId: number };

export function mutationRequest(command: TradingCommand) {
  const targetId = command.kind === "open" ? command.tradingSymbolId : command.kind === "cancel" ? command.orderId : command.positionId;
  if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new TradingApiError(400, "거래 대상을 확인해 주세요.");
  if (command.kind === "cancel") return { path: `account/orders/${command.orderId}/cancel`, body: undefined, keyed: false };
  if (command.quantity !== undefined && !validQuantity(command.quantity)) throw new TradingApiError(400, "수량은 양수이며 소수점 8자리 이내여야 합니다.");
  if (command.kind === "open") {
    if (!validQuantity(command.quantity) || !Number.isInteger(command.leverage) || command.leverage < 1 || command.leverage > SERVER_MAX_LEVERAGE
      || !["MARKET", "LIMIT"].includes(command.type) || !["LONG", "SHORT"].includes(command.side)) throw new TradingApiError(400, "주문 수량·유형·방향·레버리지를 확인해 주세요.");
    if (command.type === "LIMIT" && !validLimitPrice(command.limitPrice ?? "")) throw new TradingApiError(400, "양수 지정가를 입력해 주세요. 소수점은 18자리까지 지원합니다.");
    return { path: "account/orders", body: { type: command.type, tradingSymbolId: command.tradingSymbolId, side: command.side,
      quantity: command.quantity, leverage: command.leverage, ...(command.type === "LIMIT" ? { limitPrice: command.limitPrice } : {}) }, keyed: true };
  }
  if (command.kind === "limitClose" && !validLimitPrice(command.limitPrice)) throw new TradingApiError(400, "양수 지정가를 입력해 주세요.");
  return { path: `account/positions/${command.positionId}/${command.kind === "close" ? "close" : "close-orders"}`,
    body: { ...(command.quantity === undefined ? {} : { quantity: command.quantity }), ...(command.kind === "limitClose" ? { limitPrice: command.limitPrice } : {}) }, keyed: true };
}
export function uncertainMutation(error: unknown) {
  if (error instanceof TradingApiError && error.outcome === "NOT_ACCEPTED" && error.status === 503
    && ["ACCOUNT_RISK_PENDING", "ACCOUNT_RECOVERY_HELD", "ENGINE_RECOVERING"].includes(error.code ?? "")) return false;
  return !(error instanceof TradingApiError) || error.status === 0 || error.status === 422 || error.status >= 500;
}
export type TradingIntent = { command: TradingCommand; session: SessionSnapshot; key: string };

export function createTradingIntent(send: (request: TradingIntent) => Promise<TradingOrder>, newKey: () => string = () => crypto.randomUUID()) {
  let flight: Promise<TradingOrder> | null = null;
  let unresolved: TradingIntent | null = null;
  return {
    execute(command: TradingCommand, session: SessionSnapshot) {
      if (flight) return flight;
      mutationRequest(command);
      if (unresolved && (unresolved.session.accountId !== session.accountId || unresolved.session.generation !== session.generation)) unresolved = null;
      if (unresolved && JSON.stringify(unresolved.command) !== JSON.stringify(command)) return Promise.reject(new TradingApiError(409, "이전 요청의 결과 확인을 먼저 완료해 주세요."));
      const request = unresolved ?? { command: { ...command }, session: { ...session }, key: newKey() };
      flight = send(request).then((order) => { unresolved = null; return order; }, (error: unknown) => {
        unresolved = uncertainMutation(error) ? request : null;
        throw error;
      }).finally(() => { flight = null; });
      return flight;
    },
  };
}

const businessMessages: Record<string, string> = {
  MARGIN_MIGRATION_REQUIRED:"담보 전환이 완료되지 않아 거래가 제한됩니다. Guest 재도전 또는 계정 상태 확인이 필요합니다.",
  GUEST_ACCOUNT_REQUIRED:"Guest 계정에서만 재도전할 수 있습니다.",
  GUEST_CREDENTIAL_EXPIRED:"Guest 인증이 만료되었습니다. 새 모의투자는 직접 시작해 주세요.",
  LEVERAGE_MISMATCH: "종목 레버리지가 변경되었습니다. 서버 설정을 다시 조회했습니다. 레버리지를 확인한 뒤 직접 주문해 주세요.",
  INVALID_LEVERAGE: "서버가 허용하는 범위의 정수 레버리지를 선택해 주세요.",
  POSITION_NOT_FOUND: "포지션을 찾을 수 없습니다. 최신 포지션 목록을 확인해 주세요.",
  MARKETABLE_LIMIT_NOT_ALLOWED: "현재 가격을 즉시 교차하는 지정가는 사용할 수 없습니다. 주문 방향과 지정가를 확인해 주세요.",
  TRADING_BUSY: "계정이 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.",
  INSUFFICIENT_MARGIN: "증거금과 수수료를 위한 잔액이 부족합니다.", ACCOUNT_AT_RISK: "계정 위험 처리 중입니다. 계정 상태를 확인해 주세요.",
  PRICE_NOT_FRESH: "보유 종목의 최신 시세가 필요합니다. 시세 복구 후 다시 시도해 주세요.", ENGINE_RECOVERING: "거래 서버가 복구 중입니다. 잠시 후 다시 시도해 주세요.",
  IDEMPOTENCY_CONFLICT: "이전 요청과 내용이 일치하지 않습니다. 주문 내역을 확인해 주세요.",
  POSITION_NOT_OPEN: "이미 종료된 포지션입니다.", CLOSE_QUANTITY_EXCEEDED: "예약된 청산 수량이 있습니다. 미체결 청산 주문을 취소하거나 청산 가능 수량을 줄여 주세요.",
  ORDER_NOT_PENDING: "이미 처리된 주문입니다. 최신 주문 내역을 확인해 주세요.", INVALID_ORDER: "주문 수량·가격·레버리지 또는 주문 금액 한도를 확인해 주세요.",
  ACCOUNT_NOT_ACTIVE: "현재 계정은 거래할 수 없습니다.", SYMBOL_NOT_AVAILABLE: "현재 거래할 수 없는 종목입니다.",
};
export function mutationMessage(error: unknown) {
  if (!(error instanceof TradingApiError)) return "요청 결과를 확인할 수 없습니다. 같은 요청으로 결과 확인을 다시 시도해 주세요.";
  if (error.code && ["ACCOUNT_RISK_PENDING", "ACCOUNT_RECOVERY_HELD", "ORDER_SIZE_LIMIT_EXCEEDED", "POSITION_LIMIT_REACHED", "PENDING_LIMIT_REACHED", "POSITION_LIQUIDATION"].includes(error.code)) return orderReason(error.code);
  if (error.code && businessMessages[error.code]) return businessMessages[error.code];
  if (error.status === 401 || error.status === 403) return "계정 인증을 확인할 수 없습니다. 계정 조회를 새로고침해 주세요. 주문은 새 계정으로 재전송하지 않습니다.";
  if (uncertainMutation(error)) return "요청 결과를 확인할 수 없습니다. 같은 요청으로 결과 확인을 다시 시도해 주세요.";
  return "요청을 처리하지 못했습니다. 입력과 최신 계정 상태를 확인해 주세요.";
}
