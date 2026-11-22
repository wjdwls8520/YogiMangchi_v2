"use client";

import { useSearchParams } from "next/navigation";
import { TradingWorkspace } from "./trading-workspace";
import type { AccountView } from "./trading-account-tabs";

export function parseTradingSearchParams(params: {
  get(name: string): string | null;
}): {
  urlSymbol: string | null;
  urlTab: AccountView | null;
  urlSide: "LONG" | "SHORT" | null;
  urlLeverage: number | null;
} {
  const rawSym = params.get("symbol")?.trim().toUpperCase();
  const urlSymbol = rawSym ? rawSym.replace(/USDT$/i, "") : null;

  const rawTab = params.get("tab")?.trim().toLowerCase();
  const urlTab: AccountView | null =
    rawTab === "orders" || rawTab === "history" || rawTab === "fills" || rawTab === "positions"
      ? rawTab
      : null;

  const rawSide = params.get("side")?.trim().toUpperCase();
  const urlSide: "LONG" | "SHORT" | null =
    rawSide === "LONG" || rawSide === "SHORT" ? rawSide : null;

  const rawLev = params.get("leverage")?.trim();
  let urlLeverage: number | null = null;
  if (rawLev && /^\d{1,3}$/.test(rawLev)) {
    const parsed = Number.parseInt(rawLev, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
      urlLeverage = parsed;
    }
  }

  return { urlSymbol, urlTab, urlSide, urlLeverage };
}

export function TradingPageClient() {
  const searchParams = useSearchParams();
  const parsed = parseTradingSearchParams(searchParams);
  return <TradingWorkspace {...parsed} />;
}
