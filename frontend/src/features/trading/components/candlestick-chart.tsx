"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { IChartApi, ISeriesApi, UTCTimestamp, Time, LogicalRange } from "lightweight-charts";
import type { TradingSymbol } from "../market/catalog";
import { CandleBook, type Candle, type CandleInterval } from "../market/candles";
import { freshMarkPrice, type SelectedMarket } from "../market/selected-market";
import { formatMarketPrice, marketChartPriceFormat } from "../market/price-format";
import { useCandleHistory, useOlderCandleHistory } from "../api/candles";
import { preserveCandleRange } from "../market/candle-history";
import { ChartState } from "./chart-state";

// Numeric OHLC exists only at the chart library boundary, never in orders/account data.
const plot = (candle: Candle) => ({ time: candle.openTime / 1000 as UTCTimestamp,
  open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) });

export function CandlestickChart({ symbol, market, interval }: { symbol: TradingSymbol; market: SelectedMarket; interval: CandleInterval }) {
  const query = useCandleHistory(symbol.id, interval);
  const { refetch } = query;
  const client = useQueryClient();
  const [book] = useState(() => new CandleBook(interval));
  const older = useOlderCandleHistory(book, symbol.id, interval);
  const { pager } = older;
  const candles = useSyncExternalStore(book.subscribe, book.getSnapshot, book.getSnapshot);
  const mount = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rendered = useRef<readonly Candle[]>([]);
  const historyVersion = useRef(-1);
  const drawing = useRef(false);
  const lastNavigation = useRef(-Infinity);
  const fetching = useRef(false);
  const recovery = useRef(0);
  const [rendererFailed, setRendererFailed] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const reference = candles.at(-1)?.close ?? freshMarkPrice(market)?.decimal;
  const initialFormat = useRef(marketChartPriceFormat(reference, symbol.priceTickSize));

  // Buffer marks only during latest reconciliation. Older pages leave live updates running.
  useEffect(() => {
    if (query.isFetching && !fetching.current) book.begin(freshMarkPrice(market));
    fetching.current = query.isFetching;
  }, [query.isFetching, market, book]);
  useEffect(() => {
    if (query.data && !query.isFetching && !query.isError) book.reconcile(query.data);
    else if (query.isError && !query.isFetching) book.resume();
  }, [query.data, query.dataUpdatedAt, query.isFetching, query.isError, book]);
  useEffect(() => {
    const price = freshMarkPrice(market);
    if (!price) return;
    const update = book.update(price);
    // Reconcile closed bars at rollover as well as after an outage. Never invent missing buckets.
    if (update?.appended && book.data.length > 1) void refetch({ cancelRefetch: false });
  }, [market, book, refetch]);
  useEffect(() => {
    if (market.state !== "READY" || market.recovery === recovery.current) return;
    let disposed = false;
    // Even an already pending request must not stand in for a history read after recovery.
    void client.cancelQueries({ queryKey: query.queryKey, exact: true }).then(() => {
      if (!disposed) { recovery.current = market.recovery; void refetch({ cancelRefetch: true }); }
    });
    return () => { disposed = true; };
  }, [market.state, market.recovery, client, query.queryKey, refetch]);

  const renderData = useCallback(() => {
    const current = series.current, data = book.data;
    if (!current) return;
    drawing.current = true;
    try {
      if (book.historyVersion !== historyVersion.current || !rendered.current.length || data[0]?.openTime !== rendered.current[0]?.openTime) {
        const scale = chart.current?.timeScale();
        const range = preserveCandleRange(rendered.current, data, scale?.getVisibleLogicalRange() ?? null);
        current.setData(data.map(plot));
        if (range) scale?.setVisibleLogicalRange(range as LogicalRange);
        else if (!rendered.current.length && data.length) scale?.fitContent();
      } else if (data.length) current.update(plot(data[data.length - 1]));
      rendered.current = data;
      historyVersion.current = book.historyVersion;
    } catch { queueMicrotask(() => { if (series.current === current) setRendererFailed(true); }); }
    finally { pager.resetRange(chart.current?.timeScale().getVisibleLogicalRange()?.from ?? null); drawing.current = false; }
  }, [book, pager]);
  useEffect(() => { renderData(); }, [candles, renderData]);
  useEffect(() => {
    initialFormat.current = marketChartPriceFormat(reference, symbol.priceTickSize);
    const current = series.current;
    try { current?.applyOptions({ priceFormat: initialFormat.current }); }
    catch { queueMicrotask(() => { if (series.current === current) setRendererFailed(true); }); }
  }, [reference, symbol.priceTickSize]);
  useEffect(() => {
    let disposed = false;
    let instance: IChartApi | undefined;
    async function start() {
      try {
        const { createChart, CandlestickSeries, ColorType, TickMarkType } = await import("lightweight-charts");
        if (disposed || !mount.current) return;
        instance = createChart(mount.current, {
          autoSize: true,
          layout: { background: { type: ColorType.Solid, color: "#101014" }, textColor: "#898e98", fontFamily: "Arial, sans-serif", fontSize: 11, attributionLogo: true },
          grid: { vertLines: { color: "#222329" }, horzLines: { color: "#222329" } },
          crosshair: { vertLine: { color: "#666b75", labelBackgroundColor: "#34363d" }, horzLine: { color: "#666b75", labelBackgroundColor: "#34363d" } },
          rightPriceScale: { borderColor: "#27282e" },
          timeScale: { borderColor: "#27282e", timeVisible: true, secondsVisible: false, rightOffset: 3,
            tickMarkFormatter: (time: Time, kind: import("lightweight-charts").TickMarkType) => typeof time !== "number" ? null : new Date(time * 1000).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul", hour12: false, ...(kind === TickMarkType.Time || kind === TickMarkType.TimeWithSeconds
                ? { hour: "2-digit", minute: "2-digit" } : kind === TickMarkType.Year ? { year: "numeric" } : { month: "numeric", day: "numeric" }),
            }),
          },
          localization: { locale: "ko-KR", timeFormatter: (time: number | object | string) => typeof time === "number"
            ? new Date(time * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : String(time) },
        });
        chart.current = instance;
        series.current = instance.addSeries(CandlestickSeries, { upColor: "#00c785", downColor: "#f6465d", wickUpColor: "#00c785",
          wickDownColor: "#f6465d", borderVisible: false, priceFormat: initialFormat.current });
        instance.subscribeCrosshairMove((event) => setHoverTime(typeof event.time === "number" ? event.time * 1000 : null));
        instance.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!drawing.current) pager.rangeChanged(range?.from ?? null, performance.now() - lastNavigation.current < 1000);
        });
        renderData();
      } catch { if (!disposed) setRendererFailed(true); }
    }
    void start();
    return () => { disposed = true; series.current = null; chart.current = null; rendered.current = []; historyVersion.current = -1; instance?.remove(); };
  }, [renderData, pager]);

  const selected = candles.find((candle) => candle.openTime === hoverTime) ?? candles.at(-1);
  const historyState = query.isError ? "unavailable" : query.isPending ? "loading" : candles.length ? "ready" : "empty";
  return <>
    <div className="candle-information">
      <span className="preview-label" data-candle-status>{rendererFailed ? "차트 표시 오류" : `과거 봉 · ${query.isError ? "조회 실패" : query.isPending ? "불러오는 중" : query.isFetching ? "동기화 중" : `${candles.length}개`}`}</span>
      {query.isError && <button type="button" className="account-refresh" disabled={query.isFetching} onClick={() => void refetch({ cancelRefetch: false })}>봉 다시 조회</button>}
      <div className="candle-history-status" aria-live="polite" aria-atomic="true" data-older-history={older.phase}>
        {older.phase === "loading" ? "이전 봉 불러오는 중…" : older.phase === "end" ? "가장 오래된 봉입니다." : older.phase === "limit" ? "최근 10,000개까지 탐색할 수 있습니다." : older.phase === "error" ? <>
          <span>이전 봉 조회 실패</span><button type="button" className="account-refresh" onClick={() => void pager.load()}>이전 봉 다시 조회</button>
        </> : null}
      </div>
      <dl className="candle-ohlc" aria-label="선택 봉 OHLC" data-open-time={selected?.openTime}>
        {(["open", "high", "low", "close"] as const).map((field) => <div key={field}><dt>{field.charAt(0).toUpperCase()}</dt><dd>{formatMarketPrice(selected?.[field], symbol.priceTickSize)}</dd></div>)}
      </dl>
      {selected && <time className="preview-label" dateTime={new Date(selected.openTime).toISOString()}>{new Date(selected.openTime).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })} KST</time>}
    </div>
    <figure aria-labelledby="chart-caption" className="market-chart-figure">
      <div data-market-chart-frame data-interval={interval} data-candle-count={candles.length} data-history={historyState} data-connection={market.state}
        data-view={rendererFailed ? "unavailable" : historyState} aria-busy={query.isPending} className="market-chart-frame">
        <div ref={mount} data-chart-mount aria-label={`${symbol.displaySymbol} ${interval} Mark Price 캔들 차트`} role="img" className="absolute inset-0 overflow-hidden"
          onPointerDownCapture={() => { lastNavigation.current = performance.now(); }}
          onPointerMoveCapture={(event) => { if (event.buttons) lastNavigation.current = performance.now(); }}
          onWheelCapture={() => { lastNavigation.current = performance.now(); }} />
        {rendererFailed ? <ChartState title="차트를 표시할 수 없습니다." /> : !candles.length && <ChartState title={query.isError ? "과거 봉을 불러올 수 없습니다." : query.isPending ? "과거 봉을 불러오는 중입니다." : "표시할 과거 봉이 없습니다."} />}
      </div>
      <figcaption id="chart-caption" className="market-chart-caption">
        <span>Historical Mark Price OHLC · UTC bucket · 진행 봉은 실시간 Mark로 갱신</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" title="Copyright (с) 2025 TradingView, Inc.">TradingView Lightweight Charts™</a>
      </figcaption>
    </figure>
  </>;
}
