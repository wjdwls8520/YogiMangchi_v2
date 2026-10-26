"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { marketEndpoints, parseSymbols, type TradingSymbol } from "../market/catalog";
import { retryDelay } from "../market/stream";
import { useMarketTickers, useTradingSummary } from "../api/queries";
import { SymbolSelector } from "./symbol-selector";
import { TradingChart } from "./trading-chart";
import { MarketHeader } from "./market-header";
import { TradingAccountTabs, type AccountView } from "./trading-account-tabs";
import { TradingNavigation } from "./trading-navigation";
import { LiveMarketProvider, useSelectedMarket, useSelectedBook, type BookSelection } from "./selected-market-provider";
import type { CandleInterval } from "../market/candles";
import { OrderBookPanel } from "./order-book-panel";
import { freshMarkPrice } from "../market/selected-market";
import { useGuestSession } from "./trading-data-provider";

export function MarketChartPanel({ children }: { children: ReactNode }) {
  const account = useTradingSummary();
  const {snapshot:guest} = useGuestSession();
  const [mainView, setMainView] = useState<"chart" | "order" | "portfolio">("chart");
  const [analysisView, setAnalysisView] = useState<"chart" | "book">("chart");
  const [bookSelection, setBookSelection] = useState<BookSelection>();
  const [symbolSearch,setSymbolSearch]=useState("");
  const searchInput=useRef<HTMLInputElement>(null);
  const [accountView, setAccountView] = useState<AccountView>("positions");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const sheetTrigger = useRef<HTMLButtonElement>(null);
  const [catalog, setCatalog] = useState<{ symbols: TradingSymbol[]; allSymbols: TradingSymbol[]; state: "loading" | "unavailable" | "empty" | "ready"; socket: string }>({ symbols: [], allSymbols: [], state: "loading", socket: "" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [interval, setInterval] = useState<CandleInterval>("1m");
  const unavailableIds = useRef(new Set<number>());
  const [catalogRevision, setCatalogRevision] = useState(0);
  const refreshSubscriptionCatalog=useCallback(()=>setCatalogRevision(revision=>revision+1),[]);
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
        const allSymbols = parseSymbols(await response.json());
        const symbols = allSymbols.filter((entry) => !unavailableIds.current.has(entry.id)
          && entry.quoteAsset === "USDT");
        if (!disposed) setCatalog({ symbols, allSymbols, socket: endpoints.socket, state: symbols.length ? "ready" : "empty" });
      } catch {
        if (!disposed) {
          setCatalog({ symbols: [], allSymbols: [], socket: "", state: "unavailable" });
          retry = setTimeout(load, retryDelay(attempt++));
        }
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { disposed = true; controller?.abort(); clearTimeout(timeout); clearTimeout(retry); };
  }, [catalogRevision]);
  const selected = catalog.symbols.find((entry) => entry.id === selectedId)
    ?? catalog.symbols.find((entry) => entry.symbol === "BTC") ?? catalog.symbols[0] ?? null;
  const positionIds = JSON.stringify([...new Set((account.data?.positions??[]).map(position=>position.tradingSymbolId).filter(id=>id!==selected?.id && catalog.symbols.some(symbol=>symbol.id===id)))].sort((a,b)=>a-b));
  function openSheet() {
    if (!sheet.current || sheet.current.open) return;
    sheet.current.showModal();
    setSymbolSearch("");
    searchInput.current?.focus();
    setSheetOpen(true);
  }
  function closeSheet() {
    sheet.current?.close();
    setSheetOpen(false);
    sheetTrigger.current?.focus({ preventScroll: true });
  }
  function selectFromSheet(id: number) {
    setSelectedId(id);
    closeSheet();
  }
  function selectMainView(id: string) {
    if (id === "chart" || id === "order" || id === "portfolio") setMainView(id);
  }
  return (
    <LiveMarketProvider symbol={selected} symbols={catalog.allSymbols} socketUrl={catalog.socket} onSymbolUnavailable={refreshAfterSymbolError} positionIds={positionIds} identity={`${guest.accountId}:${guest.generation}`} onSubscriptionUnavailable={refreshSubscriptionCatalog} bookSelection={bookSelection}><div className="trading-grid" data-main-view={mainView}>
      <div className="market-overview"><header className="market-contract-header">
        <button ref={sheetTrigger} type="button" onClick={openSheet} aria-haspopup="dialog" aria-controls="market-symbol-sheet" aria-expanded={sheetOpen} className="market-sheet-trigger">
          <span className="market-coin-mark" aria-hidden="true">{selected?.symbol.charAt(0) ?? "·"}</span>
          <span className="market-selected-label"><strong>{selected ? `${selected.symbol}USDT` : "종목 선택"}</strong><span>{selected?.name ?? "거래 가능 종목 확인 중"}</span></span>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="preview-label">무기한 선물</span>
      </header>
        <LiveHeader />
      </div>
      <TradingNavigation label="모바일 거래 화면" prefix="main" activeId={mainView} onSelect={selectMainView} className="main-navigation" tabs={[
        { id: "chart", label: "차트·호가", controls: "chart-view" },
        { id: "order", label: "주문", controls: "order-view trading-account" },
        { id: "portfolio", label: "거래 내역", controls: "trading-account" },
      ]} />
      <section id="chart-view" role="tabpanel" aria-labelledby="chart-heading" tabIndex={0} className="chart-view">
        <div className="analysis-navigation" role="group" aria-label="시장 정보 보기"><button type="button" aria-pressed={analysisView === "chart"} onClick={()=>setAnalysisView("chart")}>차트</button><button type="button" aria-pressed={analysisView === "book"} onClick={()=>setAnalysisView("book")}>호가</button></div>
        <div className="market-analysis" data-analysis-view={analysisView}>
          <LiveChart interval={interval} onIntervalChange={setInterval} catalogView={catalog.state} />
          <LiveBook onSelectPrice={guest.phase === "ready" && selected ? price => {
            setBookSelection({symbolId:selected.id,price,identity:`${guest.accountId}:${guest.generation}`});
            setMainView("order");
          } : undefined} />
        </div>
      </section>
      <div id="order-view" role="tabpanel" aria-labelledby="order-heading" tabIndex={0} className="order-view">{children}</div>
      <TradingAccountTabs activeTab={accountView} onSelect={setAccountView} symbols={catalog.allSymbols} />
      <dialog ref={sheet} id="market-symbol-sheet" aria-modal="true" aria-labelledby="sheet-heading" className="market-symbol-sheet"
        onClick={(event) => {
          // A second trigger click lands on the newly opened overlay.
          if (event.target === event.currentTarget && event.detail < 2) closeSheet();
        }}
        onCancel={(event) => { event.preventDefault(); closeSheet(); }}
        onClose={() => { setSheetOpen(false); sheetTrigger.current?.focus({ preventScroll: true }); }}>
        <div className="market-sheet-content">
          <header className="section-heading"><h2 id="sheet-heading" className="section-title">Markets</h2><button type="button" onClick={closeSheet} aria-label="종목 선택 닫기" className="market-sheet-close">닫기</button></header>
          <div className="market-list-note"><label className="field-label" htmlFor="market-search">종목 검색</label><input ref={searchInput} id="market-search" className="market-search" type="search" placeholder="BTC, ETH 또는 종목명" value={symbolSearch} onChange={event=>setSymbolSearch(event.target.value)}/></div>
          {sheetOpen && <SymbolList symbols={catalog.symbols} search={symbolSearch} selectedId={selected?.id??null} onSelect={selectFromSheet} />}
          <p className="market-list-note">Mark Price · 24h 변동률 · 최근 조회 기준</p>
        </div>
      </dialog>
    </div></LiveMarketProvider>
  );
}

function LiveHeader() {
  const {symbol,market}=useSelectedMarket(), query=useMarketTickers();
  return <MarketHeader symbol={symbol} market={market} ticker={query.tickers.find(ticker=>ticker.tradingSymbolId===symbol?.id&&ticker.symbol===symbol.symbol&&ticker.quoteAsset===symbol.quoteAsset)} />;
}
function LiveChart(props: Omit<Parameters<typeof TradingChart>[0],"symbol"|"market">) {
  const {symbol,market}=useSelectedMarket();
  return <TradingChart {...props} symbol={symbol} market={market} />;
}
function LiveBook({onSelectPrice}:{onSelectPrice?: (price:string)=>void}) {
  const {symbol,market}=useSelectedMarket(), book=useSelectedBook();
  return book && <OrderBookPanel symbol={symbol} book={book} mark={freshMarkPrice(market)?.decimal} onSelectPrice={onSelectPrice} />;
}
function SymbolList({symbols,search,selectedId,onSelect}:{symbols:readonly TradingSymbol[];search:string;selectedId:number|null;onSelect:(id:number)=>void}) {
  const query=useMarketTickers();
  return <><SymbolSelector symbols={symbols.filter(symbol=>`${symbol.symbol} ${symbol.name} ${symbol.quoteAsset}`.toLowerCase().includes(search.trim().toLowerCase()))} tickers={query.tickers} selectedId={selectedId} onSelect={onSelect}/>
    {query.isError && <button type="button" className="account-refresh" disabled={query.isFetching} onClick={()=>void query.refetch({cancelRefetch:false})}>통계 다시 조회</button>}</>;
}
