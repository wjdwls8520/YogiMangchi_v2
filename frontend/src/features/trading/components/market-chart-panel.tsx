"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { marketEndpoints, parseSymbols, type TradingSymbol } from "../market/catalog";
import { retryDelay } from "../market/stream";
import { previewSymbols } from "../preview-data";
import { SymbolSelector } from "./symbol-selector";
import { TradingChart } from "./trading-chart";

export function MarketChartPanel({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<{ symbols: TradingSymbol[]; state: "loading" | "unavailable" | "empty" | "ready"; socket: string }>({ symbols: [], state: "loading", socket: "" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const unavailableIds = useRef(new Set<number>());
  const [catalogRevision, setCatalogRevision] = useState(0);
  const refreshAfterSymbolError = useCallback((id: number) => {
    if (unavailableIds.current.has(id)) return;
    unavailableIds.current.add(id);
    setCatalogRevision((revision) => revision + 1);
  }, []);
  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function load() {
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const endpoints = marketEndpoints(process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081");
        const response = await fetch(endpoints.symbols, { signal: controller.signal, credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("Symbol catalog unavailable");
        // A refreshed catalog can briefly still advertise the rejected ID.
        // Exclude it for this mounted screen instead of resubscribing in a loop.
        const symbols = parseSymbols(await response.json()).filter((entry) => !unavailableIds.current.has(entry.id)
          && entry.quoteAsset === "USDT" && previewSymbols.some((item) => item.symbol === entry.symbol));
        if (!disposed) setCatalog({ symbols, socket: endpoints.socket, state: symbols.length ? "ready" : "empty" });
      } catch {
        if (!disposed) {
          setCatalog({ symbols: [], socket: "", state: "unavailable" });
          retry = setTimeout(load, retryDelay(attempt++));
        }
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { disposed = true; controller?.abort(); clearTimeout(timeout); clearTimeout(retry); };
  }, [catalogRevision]);
  const selected = catalog.symbols.find((entry) => entry.id === selectedId)
    ?? catalog.symbols.find((entry) => entry.symbol === "BTC") ?? catalog.symbols[0] ?? null;
  return (
    <>
      <SymbolSelector symbols={catalog.symbols} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <TradingChart key={selected?.id ?? "catalog"} symbol={selected} socketUrl={catalog.socket} catalogView={catalog.state} onSymbolUnavailable={refreshAfterSymbolError} />
        {children}
      </div>
    </>
  );
}
