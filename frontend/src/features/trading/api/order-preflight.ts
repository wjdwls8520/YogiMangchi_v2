import { comparePrices } from "../market/price-format";
import { belowMinimumOpenNotional, decimalUnits, estimatedOrder, estimatedOrderWithFee, MIN_OPEN_NOTIONAL, ratioQuantity, SERVER_MAX_LEVERAGE, unitsDecimal, validLimitPrice, validQuantity, validSizingPrice } from "./order-input";
import type { TradingCommand } from "./mutation-request";
import type { TradingOrder } from "./orders";

export type OpenForm = { symbolId: number | null; type: "MARKET" | "LIMIT"; side: "LONG" | "SHORT";
  leverage: number; quantity: string; limitPrice: string; ratio: number };
export type OrderIssue = { kind: "marketable" | "balance" | "minimum" | "input" | "unavailable"; message: string };
export function minimumOpenIssue(quantity: string, price: string): OrderIssue | null {
  return belowMinimumOpenNotional(quantity, price)
    ? { kind: "minimum", message: `최소 진입 주문 금액은 ${MIN_OPEN_NOTIONAL} USDT입니다. 수량을 늘려 주세요.` }
    : null;
}
export function formForSide(form: OpenForm, side: OpenForm["side"], leverage: number): OpenForm {
  return { ...form, side, leverage };
}
export function formForBookPrice(form: OpenForm, symbolId: number, price: string): OpenForm | null {
  return form.symbolId === symbolId && validLimitPrice(price) ? { ...form, type: "LIMIT", limitPrice: price, ratio: 0 } : null;
}
export function ratioInputQuantity(type: OpenForm["type"], balance: string | null | undefined, price: string, leverage: number, percent: number) {
  if (type === "LIMIT" && !validLimitPrice(price)) return "0";
  return percent === 0 ? "0" : ratioQuantity(balance,price,leverage,percent) || "0";
}
export function marketableLimitIssue(side: OpenForm["side"], limitPrice: string, mark: string | undefined): OrderIssue | null {
  if (!validLimitPrice(limitPrice) || !mark || !validSizingPrice(mark)) return null;
  const compared = comparePrices(limitPrice, mark);
  return (side === "LONG" ? compared >= 0 : compared <= 0) ? { kind: "marketable", message: side === "LONG"
    ? "롱 지정가는 현재 가격보다 낮아야 합니다." : "숏 지정가는 현재 가격보다 높아야 합니다." } : null;
}
export function balanceIssue(type: OpenForm["type"]): OrderIssue {
  return { kind: "balance", message: type === "MARKET" ? "현재 가격 기준으로 사용 가능한 잔액이 부족하여 주문할 수 없습니다."
    : "현재 지정가와 수량 기준으로 사용 가능한 잔액이 부족합니다." };
}
export function preflightOrder(form: OpenForm, side: OpenForm["side"], ready: boolean, mark: string | undefined, availableBalance: string | null | undefined): OrderIssue | null {
  if (!ready || !mark || !validSizingPrice(mark)) return { kind: "unavailable", message: "거래할 계정과 선택 종목의 최신 시세를 확인해 주세요." };
  const quantity = form.quantity.trim(), price = form.type === "LIMIT" ? form.limitPrice.trim() : mark;
  if (form.leverage > SERVER_MAX_LEVERAGE) return {kind:"input",message:`레버리지는 1~${SERVER_MAX_LEVERAGE}배 정수로 설정해 주세요.`};
  if (!validQuantity(quantity) || !Number.isInteger(form.leverage) || form.leverage < 1
    || (form.type === "LIMIT" && !validLimitPrice(price))) return { kind: "input", message: "주문 수량·지정가·레버리지를 확인해 주세요." };
  const relation = form.type === "LIMIT" ? marketableLimitIssue(side, price, mark) : null;
  if (relation) return relation;
  const minimum = minimumOpenIssue(quantity, price);
  if (minimum) return minimum;
  try {
    const estimate = estimatedOrder(quantity, price, form.leverage);
    if (availableBalance == null || !estimate) throw new Error("Unavailable balance");
    return decimalUnits(estimate.margin) > decimalUnits(availableBalance) ? balanceIssue(form.type) : null;
  } catch { return { kind: "unavailable", message: "사용 가능한 잔액을 확인할 수 없습니다. 계정 상태를 다시 확인해 주세요." }; }
}
export function orderRejection(code: string | undefined, command: TradingCommand): OrderIssue | null {
  if (command.kind !== "open") return null;
  if (code === "INSUFFICIENT_MARGIN") return balanceIssue(command.type);
  if (code === "MARKETABLE_LIMIT_NOT_ALLOWED") return { kind: "marketable", message: command.side === "LONG"
    ? "롱 지정가는 현재 가격보다 낮아야 합니다." : "숏 지정가는 현재 가격보다 높아야 합니다." };
  return null;
}
export function sizingUnavailable(type: OpenForm["type"], price: string, ready: boolean, availableBalance: string | null | undefined) {
  if (type==="LIMIT"&&!validLimitPrice(price)) return "지정가가 없거나 유효하지 않으면 비율을 선택해도 수량은 0입니다.";
  if (!ready) return "계정과 최신 Mark Price를 확인한 뒤 자산 비율을 사용할 수 있습니다.";
  if (availableBalance==null) return "사용 가능한 잔액을 조회한 뒤 자산 비율을 사용할 수 있습니다.";
  return null;
}
export function formForSymbol(form: OpenForm, symbolId: number | null): OpenForm {
  return form.symbolId === symbolId ? form : { ...form, symbolId, quantity: "", limitPrice: "", ratio: 0 };
}

export function passiveLimitIssueForAction(
  side: "LONG" | "SHORT",
  action: "OPEN" | "CLOSE",
  limitPrice: string,
  mark: string | undefined,
): OrderIssue | null {
  if (!validLimitPrice(limitPrice) || !mark || !validSizingPrice(mark)) return null;
  const compared = comparePrices(limitPrice, mark);
  const mustBeBelowMark = (side === "LONG") === (action === "OPEN");
  if (mustBeBelowMark ? compared >= 0 : compared <= 0) {
    if (action === "OPEN") {
      return {
        kind: "marketable",
        message: side === "LONG"
          ? "롱 진입 지정가는 현재 가격보다 낮아야 합니다."
          : "숏 진입 지정가는 현재 가격보다 높아야 합니다.",
      };
    }
    return {
      kind: "marketable",
      message: side === "LONG"
        ? "롱 청산 지정가는 현재 가격보다 높아야 합니다."
        : "숏 청산 지정가는 현재 가격보다 낮아야 합니다.",
    };
  }
  return null;
}

export function validatePendingOrderAmend(params: {
  order: Pick<TradingOrder, "action" | "side" | "leverage" | "quantity" | "limitPrice" | "reservedMargin">;
  draftQuantity: string;
  draftPrice: string;
  markPrice?: string;
  availableBalance?: string | null;
  positionFreeCloseQuantity?: string | null;
}): OrderIssue | null {
  const qty = params.draftQuantity.trim();
  const price = params.draftPrice.trim();
  if (!validQuantity(qty)) {
    return { kind: "input", message: "수량은 0보다 크고 소수점 8자리 이내여야 합니다." };
  }
  if (!validLimitPrice(price)) {
    return { kind: "input", message: "지정가는 0보다 크고 소수점 18자리 이내여야 합니다." };
  }
  const passive = passiveLimitIssueForAction(
    params.order.side as "LONG" | "SHORT",
    params.order.action as "OPEN" | "CLOSE",
    price,
    params.markPrice,
  );
  if (passive) return passive;

  if (params.order.action === "OPEN") {
    const minIssue = minimumOpenIssue(qty, price);
    if (minIssue) return minIssue;
    const est = estimatedOrderWithFee(qty, price, params.order.leverage, "LIMIT");
    if (!est) {
      return { kind: "input", message: "주문 금액 한도(최대 1,000,000 USDT)와 수량을 확인해 주세요." };
    }
    if (params.availableBalance != null) {
      try {
        const budgetUnits = decimalUnits(params.availableBalance) + decimalUnits(params.order.reservedMargin);
        if (decimalUnits(est.totalRequired) > budgetUnits) {
          return {
            kind: "balance",
            message: `증거금+수수료(${unitsDecimal(decimalUnits(est.totalRequired), 18)} USDT)가 수정 가능 자산(${unitsDecimal(budgetUnits, 18)} USDT)을 초과합니다.`,
          };
        }
      } catch {
        // Defer exact check to server AccountLock if local decimal string is unavailable
      }
    }
    return null;
  }

  if (params.order.action === "CLOSE" && params.positionFreeCloseQuantity != null) {
    try {
      const maxCloseUnits = decimalUnits(params.positionFreeCloseQuantity) + decimalUnits(params.order.quantity);
      if (decimalUnits(qty) > maxCloseUnits) {
        return {
          kind: "balance",
          message: `청산 가능 수량(${unitsDecimal(maxCloseUnits, 18)})을 초과했습니다.`,
        };
      }
    } catch {
      // Defer exact check to server AccountLock
    }
  }
  return null;
}
