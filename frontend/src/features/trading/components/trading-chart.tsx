"use client";

import type { TradingSymbol } from "../market/catalog";
import type { MarketState } from "../market/stream";
import type { SelectedMarket } from "../market/selected-market";
import { CANDLE_INTERVALS, type CandleInterval } from "../market/candles";
import { CandlestickChart } from "./candlestick-chart";
import { ChartState } from "./chart-state";

const statusLabels: Record<MarketState, string> = {
  CONNECTING: "연결 중", WAITING_FOR_FIRST_PRICE: "첫 시세 대기", READY: "READY",
  UNAVAILABLE: "시세 이용 불가", RECONNECTING: "재연결 중",
};

export function TradingChart({ symbol, market, catalogView, interval, onIntervalChange }: {
  symbol: TradingSymbol | null; market: SelectedMarket; catalogView: "loading" | "ready" | "empty" | "unavailable";
  interval: CandleInterval; onIntervalChange: (interval: CandleInterval) => void;
}) {
  return <section aria-labelledby="chart-heading" className="market-chart trading-section">
    <header className="section-heading">
      <h2 id="chart-heading" className="section-title">차트 <span className="ml-2 text-trade-meta font-normal text-slate-500">{symbol?.displaySymbol ?? "종목 선택"}</span></h2>
      <span className="preview-label">실시간 · {statusLabels[market.state]}</span>
    </header>
    <div role="group" aria-label="차트 주기" className="chart-timeframes">
      {CANDLE_INTERVALS.map((value) => <button key={value} type="button" aria-pressed={interval === value}
        onClick={() => onIntervalChange(value)} className="chart-timeframe">{value}</button>)}
    </div>
    {symbol ? <CandlestickChart key={`${symbol.id}:${interval}`} symbol={symbol} market={market} interval={interval} />
      : <div data-market-chart-frame data-view={catalogView} className="market-chart-frame"><ChartState title={catalogView === "unavailable" ? "거래 종목을 불러올 수 없습니다." : catalogView === "empty" ? "거래 가능한 종목이 없습니다." : "거래 종목을 불러오는 중입니다."} /></div>}
  </section>;
}
