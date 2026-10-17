import { comparePrices } from "../market/price-format";
import { decimalUnits, estimatedOrder, validLimitPrice, validQuantity, validSizingPrice } from "./order-input";
import type { TradingCommand } from "./mutation-request";

export type OpenForm = { symbolId: number | null; type: "MARKET" | "LIMIT"; side: "LONG" | "SHORT";
  leverage: number; quantity: string; limitPrice: string; ratio: number };
export type OrderIssue = { kind: "marketable" | "balance" | "input" | "unavailable"; message: string };
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
  if (!validQuantity(quantity) || !Number.isInteger(form.leverage) || form.leverage < 1 || form.leverage > 20
    || (form.type === "LIMIT" && !validLimitPrice(price))) return { kind: "input", message: "주문 수량·지정가·레버리지를 확인해 주세요." };
  const relation = form.type === "LIMIT" ? marketableLimitIssue(side, price, mark) : null;
  if (relation) return relation;
  try {
    const estimate = estimatedOrder(quantity, price, form.leverage);
    if (availableBalance == null || !estimate) throw new Error("Unavailable balance");
    return decimalUnits(estimate.margin) > decimalUnits(availableBalance) ? balanceIssue(form.type) : null;
  } catch { return { kind: "unavailable", message: "사용 가능한 잔액을 확인할 수 없습니다. 계정을 새로고침해 주세요." }; }
}
export function orderRejection(code: string | undefined, command: TradingCommand): OrderIssue | null {
  if (command.kind !== "open") return null;
  if (code === "INSUFFICIENT_MARGIN") return balanceIssue(command.type);
  if (code === "MARKETABLE_LIMIT_NOT_ALLOWED") return { kind: "marketable", message: command.side === "LONG"
    ? "롱 지정가는 현재 가격보다 낮아야 합니다." : "숏 지정가는 현재 가격보다 높아야 합니다." };
  return null;
}
export function sizingUnavailable(type: OpenForm["type"], price: string, ready: boolean, availableBalance: string | null | undefined) {
  if (type==="LIMIT"&&!validLimitPrice(price)) return "지정가를 입력하면 자산 비율을 사용할 수 있습니다.";
  if (!ready) return "계정과 최신 Mark Price를 확인한 뒤 자산 비율을 사용할 수 있습니다.";
  if (availableBalance==null) return "사용 가능한 잔액을 조회한 뒤 자산 비율을 사용할 수 있습니다.";
  return null;
}
export function formForSymbol(form: OpenForm, symbolId: number | null): OpenForm {
  return form.symbolId === symbolId ? form : { ...form, symbolId, quantity: "", limitPrice: "", ratio: 0 };
}
