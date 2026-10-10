"use client";

import { useEffect, useRef, useState } from "react";
import type { TradingSymbol } from "../market/catalog";
import { PriceHistory } from "../market/history";
import { openMarketStream, type MarketState } from "../market/stream";
import { ChartState, type MarketChartView } from "./chart-state";

const statusLabels: Record<MarketState, string> = {
  CONNECTING: "연결 중", WAITING_FOR_FIRST_PRICE: "첫 시세 대기", READY: "실시간",
  UNAVAILABLE: "시세 이용 불가", RECONNECTING: "재연결 중",
};

const messages = {
  loading: "시세를 불러오는 중입니다.",
  unavailable: "현재 유효한 시세를 제공할 수 없습니다.",
  empty: "표시할 가격 데이터가 없습니다.",
} as const;

export function TradingChart({ symbol, socketUrl, catalogView }: {
  symbol: TradingSymbol | null; socketUrl: string; catalogView: "loading" | "ready" | "empty" | "unavailable";
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MarketState>("CONNECTING");
  const [rendererFailed, setRendererFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let chart: import("lightweight-charts").IChartApi | undefined;
    let stop: (() => void) | undefined;
    const history = new PriceHistory();
    async function start() {
      try {
        const { createChart, LineSeries, ColorType } = await import("lightweight-charts");
        if (disposed || !mount.current) return;
        chart = createChart(mount.current, {
          autoSize: true,
          layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#64748b", fontFamily: "Arial, sans-serif", fontSize: 11, attributionLogo: true },
          grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
          rightPriceScale: { borderColor: "#e2e8f0" },
          timeScale: { borderColor: "#e2e8f0", timeVisible: true, secondsVisible: true, rightOffset: 3 },
          localization: { locale: "ko-KR", timeFormatter: (time: number | object | string) => typeof time === "number" ? new Date(time * 1000).toLocaleTimeString("ko-KR", { hour12: false }) : String(time) },
        });
        const series = chart.addSeries(LineSeries, { color: "#4f46e5", lineWidth: 2, priceFormat: {
          type: "custom", minMove: 0.00000001,
          formatter: (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }),
        } });
        if (!symbol) return;
        stop = openMarketStream({ url: socketUrl, symbolId: symbol.id, onState: setState, onPrice: (price) => {
          if (disposed) return;
          try {
            const update = history.append(price.eventTime, price.value);
            if (!update) return;
            if (update.pruned) series.setData(update.points as import("lightweight-charts").LineData<import("lightweight-charts").UTCTimestamp>[]);
            else series.update(update.point as import("lightweight-charts").LineData<import("lightweight-charts").UTCTimestamp>);
          } catch { stop?.(); setRendererFailed(true); }
        } });
      } catch { if (!disposed) { stop?.(); setRendererFailed(true); } }
    }
    void start();
    return () => { disposed = true; stop?.(); chart?.remove(); };
  }, [symbol, socketUrl]);
  const view: MarketChartView = rendererFailed ? "unavailable"
    : !symbol ? catalogView === "ready" ? "empty" : catalogView
    : state === "READY" ? "ready" : state === "UNAVAILABLE" || state === "RECONNECTING" ? "unavailable" : "loading";
  const title = rendererFailed ? "차트를 표시할 수 없습니다." : state === "RECONNECTING" && symbol ? "시세 연결을 복구하는 중입니다." : messages[view as keyof typeof messages];
  const label = !symbol ? catalogView === "empty" ? "종목 없음" : catalogView === "unavailable" ? "서버 연결 불가" : "연결 중" : statusLabels[state];
  return (
    <section aria-labelledby="chart-heading" className="trading-section flex flex-col">
      <header className="section-heading">
        <h2 id="chart-heading" className="section-title">차트 <span className="ml-2 text-xs font-normal text-slate-500">{symbol?.displaySymbol ?? "BTC / USDT"}</span></h2>
        <span className="preview-label">{rendererFailed ? "차트 이용 불가" : label}</span>
      </header>
      <div role="group" aria-label="차트 주기 (현재 미지원)" className="flex min-h-12 flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-1">
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((timeframe) => (
          <button key={timeframe} type="button" disabled className="min-h-11 min-w-9 rounded-sm px-2 text-xs font-medium text-slate-500">
            {timeframe}
          </button>
        ))}
        <span className="px-2 text-xs text-slate-500">Timeframe 미지원</span>
      </div>
      <figure aria-labelledby="chart-caption" className="flex min-h-80 flex-1 flex-col sm:min-h-96">
        <div data-market-chart-frame data-view={view} data-connection={symbol ? state : catalogView} aria-busy={view === "loading"} className="relative min-h-80 flex-1 sm:min-h-96">
          <div ref={mount} data-chart-mount aria-label={`${symbol?.displaySymbol ?? "선택 종목"} Mark Price 선 그래프`} role="img" className="absolute inset-0 overflow-hidden" />
          {view !== "ready" && <ChartState title={title} detail={view === "unavailable" ? "이전 그래프는 수신 이력이며 현재 유효한 가격이 아닙니다." : undefined} />}
        </div>
        <figcaption id="chart-caption" className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>Mark Price · 접속 후 수신한 가격 흐름</span>
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.</a>
        </figcaption>
      </figure>
    </section>
  );
}
