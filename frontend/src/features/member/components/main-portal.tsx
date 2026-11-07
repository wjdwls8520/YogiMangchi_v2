"use client";

import { useState } from "react";
import Link from "next/link";
import { MemberShell } from "./member-views";
import { DimModal } from "./dim-modal";
import type { NewsCategory } from "../api/community-news";

interface BreakingNewsFlash {
  id: number;
  time: string;
  category: NewsCategory;
  symbol: "BTC" | "ETH" | "SOL" | "XRP" | null;
  important: boolean;
  headline: string;
  body: string;
  source: string;
  bullCount: number;
  bearCount: number;
}

const INITIAL_BREAKING_FLASHES: BreakingNewsFlash[] = [
  {
    id: 101,
    time: "14:32",
    category: "CRYPTO",
    symbol: "BTC",
    important: true,
    headline: "[속보] 미국 현물 비트코인 ETF 일간 순유입 4.2억 달러 돌파…기관 매수세 강화",
    body: "블랙록 IBIT 및 피델리티 FBTC를 중심으로 기관 자금 순유입이 5거래일 연속 이어지며 CME 비트코인 선물 미결제약정(OI)이 사상 최고권에 근접했습니다.",
    source: "CoinNess · Yogimangchi Desk",
    bullCount: 148,
    bearCount: 24,
  },
  {
    id: 102,
    time: "14:15",
    category: "MACRO",
    symbol: null,
    important: true,
    headline: "[속보] 미 연준 위원 “근원 인플레이션 둔화 추세 지속…금리 경로 데이터 의존적”",
    body: "미국 국채 10년물 금리가 소폭 안정세를 보이면서 나스닥 선물과 주요 디지털 자산 선물 시장의 위험선호 심리가 회복되고 있습니다.",
    source: "Global Macro Wire",
    bullCount: 92,
    bearCount: 31,
  },
  {
    id: 103,
    time: "13:48",
    category: "ONCHAIN",
    symbol: "ETH",
    important: false,
    headline: "이더리움 거래소 보유량 최근 3년래 최저치 경신…스테이킹 예치 비중 확대",
    body: "주요 중앙화 거래소(CEX) 내 ETH 순유출이 지속되며 유통 물량 잠김 현상이 심화되고 있습니다. 파생상품 시장 펀딩비는 +0.0095%로 중립 강세를 유지 중입니다.",
    source: "Onchain Analytics",
    bullCount: 84,
    bearCount: 19,
  },
  {
    id: 104,
    time: "13:10",
    category: "CRYPTO",
    symbol: "SOL",
    important: true,
    headline: "[중요] 솔라나 네트워크 주간 DEX 거래량 1위 유지…무기한 선물 거래대금 급증",
    body: "솔라나 생태계 탈중앙화 거래소와 글로벌 무기한 선물 시장에서 SOL/USDT 거래대금이 전일 대비 28% 증가했습니다.",
    source: "Yogimangchi Market Desk",
    bullCount: 116,
    bearCount: 27,
  },
  {
    id: 105,
    time: "12:40",
    category: "REGULATION",
    symbol: "XRP",
    important: false,
    headline: "주요국 가상자산 파생상품 공시 및 투자자 보호 가이드라인 정비 가속",
    body: "글로벌 금융당국이 기관 및 개인 투자자 대상 디지털자산 공시 투명성 기준을 구체화하면서 시장 제도권 편입 기대감이 높아지고 있습니다.",
    source: "Policy Watch",
    bullCount: 63,
    bearCount: 22,
  },
];

interface DeepDiveArticle {
  id: number;
  category: NewsCategory;
  categoryLabel: string;
  symbol: "BTC" | "ETH" | "SOL" | "XRP";
  title: string;
  summary: string;
  content: string;
  author: string;
  publishedAt: string;
  readMinutes: number;
}

const DEEP_DIVE_ARTICLES: DeepDiveArticle[] = [
  {
    id: 201,
    category: "CRYPTO",
    categoryLabel: "코인 시황",
    symbol: "BTC",
    title: "BTC 선물 미결제약정과 펀딩비로 본 단기 변동성 구간 점검",
    summary: "현물 ETF 유입과 무기한 선물 레버리지 포지션 비중을 교차 분석해 주요 지지·저항 구간과 청산 매물대를 짚어봅니다.",
    content: "최근 BTC 무기한 선물 시장에서는 10배 이상 고배율 포지션 진입보다 3~5배 중저배율 격리마진 포지션의 유지 비율이 높아졌습니다. 상단 숏 청산 클러스터 돌파 시 단기 변동성이 확대될 수 있으므로 손절가 설정이 필수적입니다.",
    author: "요기망치 리서치팀",
    publishedAt: "2026-11-08 13:30 KST",
    readMinutes: 3,
  },
  {
    id: 202,
    category: "MACRO",
    categoryLabel: "거시·세계 경제",
    symbol: "ETH",
    title: "미 국채 금리 안정과 달러 인덱스 흐름이 암호화폐 선물 시장에 미치는 영향",
    summary: "FOMC 이후 글로벌 유동성 지표와 테더(USDT) 시가총액 증감 추이를 통해 위험자산 수급 방향성을 진단합니다.",
    content: "스테이블코인 총 발행량이 완만한 우상향 흐름을 유지하며 선물 시장의 증거금 유동성을 뒷받침하고 있습니다. 거시 지표 발표 직후에는 호가 스프레드가 일시 확대될 수 있어 지정가 분할 진입 전략이 유리합니다.",
    author: "글로벌 매크로 데스크",
    publishedAt: "2026-11-08 11:45 KST",
    readMinutes: 4,
  },
  {
    id: 203,
    category: "ONCHAIN",
    categoryLabel: "온체인·수급",
    symbol: "SOL",
    title: "고래 지갑 온체인 이동과 파생상품 롱/숏 비율 괴리 분석",
    summary: "온체인 대형 지갑의 현물 매집 구간과 개인 트레이더의 선물 포지션 쏠림 현상을 비교했습니다.",
    content: "특정 가격대에서 개인 롱 비율이 65%를 상회할 경우 단기 롱 스퀴즈(강제청산) 위험이 커집니다. 요기망치 모의투자에서도 격리마진과 손절 계산기를 함께 활용해 리스크를 통제할 수 있습니다.",
    author: "온체인 랩",
    publishedAt: "2026-11-08 10:15 KST",
    readMinutes: 3,
  },
  {
    id: 204,
    category: "REGULATION",
    categoryLabel: "규제·정책",
    symbol: "XRP",
    title: "글로벌 디지털자산 제도화 로드맵과 기관 커스터디 시장 전망",
    summary: "유럽 MiCA 시행 이후 아시아·북미 주요국의 스테이블코인 및 가상자산 규율 체계를 정리했습니다.",
    content: "명확한 규제 프레임워크 도입은 장기적으로 기관 자금의 시장 진입 장벽을 낮추는 요인으로 작용하고 있습니다.",
    author: "정책 분석팀",
    publishedAt: "2026-11-08 09:20 KST",
    readMinutes: 5,
  },
];

const SIMULATOR_PRICES: Record<"BTC" | "ETH" | "SOL" | "XRP", { price: number; change: string; up: boolean }> = {
  BTC: { price: 96420, change: "+3.42%", up: true },
  ETH: { price: 3185, change: "+2.18%", up: true },
  SOL: { price: 214.5, change: "+5.64%", up: true },
  XRP: { price: 0.684, change: "-0.85%", up: false },
};

const HOT_COMMUNITY_POSTS = [
  { id: 21, symbol: "BTC", category: "포지션 공유", title: "BTC 10배 격리 롱 진입 근거 및 손절가 공유", likes: 42, comments: 18 },
  { id: 22, symbol: "SOL", category: "차트 분석", title: "SOL 4시간봉 추세선 돌파 관점과 목표 구간", likes: 35, comments: 14 },
  { id: 23, symbol: "ETH", category: "시황·관점", title: "ETH/BTC 상대강도 반등 시점 체크리스트", likes: 29, comments: 11 },
  { id: 24, symbol: "BTC", category: "포지션 공유", title: "10,000 USDT 모의투자 1회차 복기 (손절 원칙 준수)", likes: 24, comments: 9 },
  { id: 25, symbol: "XRP", category: "자유", title: "변동성 장세에서 레버리지 5배 이하로 운용해야 하는 이유", likes: 19, comments: 7 },
];

export function MainPortal() {
  const [importantOnly, setImportantOnly] = useState(false);
  const [flashKeyword, setFlashKeyword] = useState("");
  const [articleCategory, setArticleCategory] = useState<"" | NewsCategory>("");
  const [votes, setVotes] = useState<Record<number, "bull" | "bear">>({});
  const [activeFlash, setActiveFlash] = useState<BreakingNewsFlash | null>(null);
  const [activeArticle, setActiveArticle] = useState<DeepDiveArticle | null>(null);

  const [simSymbol, setSimSymbol] = useState<"BTC" | "ETH" | "SOL" | "XRP">("BTC");
  const [simSide, setSimSide] = useState<"LONG" | "SHORT">("LONG");
  const [simLeverage, setSimLeverage] = useState<1 | 5 | 10 | 25>(10);
  const [simMargin, setSimMargin] = useState<number>(1000);

  const filteredFlashes = INITIAL_BREAKING_FLASHES.filter(item => {
    if (importantOnly && !item.important) return false;
    if (flashKeyword.trim()) {
      const q = flashKeyword.trim().toLowerCase();
      return (
        item.headline.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        (item.symbol?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const filteredArticles = DEEP_DIVE_ARTICLES.filter(item =>
    articleCategory ? item.category === articleCategory : true,
  );

  const refPrice = SIMULATOR_PRICES[simSymbol].price;
  const notionalUsdt = simMargin * simLeverage;
  const estimatedQty = (notionalUsdt / refPrice).toFixed(simSymbol === "BTC" ? 4 : simSymbol === "ETH" ? 3 : 2);
  const liqPrice =
    simSide === "LONG"
      ? refPrice * Math.max(0.02, 1 - 0.95 / simLeverage)
      : refPrice * (1 + 0.95 / simLeverage);

  function castVote(id: number, kind: "bull" | "bear") {
    setVotes(current => ({ ...current, [id]: kind }));
  }

  return (
    <MemberShell
      title="실시간 코인·경제 속보 & 선물 모의투자 포털"
      subtitle="코인니스 스타일 24시간 실시간 마켓 속보와 요기망치 10,000 USDT 가상 선물 모의투자를 한 화면에서 확인하세요."
      variant="portal"
    >
      {/* 상단 마켓 지표 바 */}
      <section className="ym-market-ticker-bar" aria-label="글로벌 암호화폐 및 선물 시장 핵심 지표">
        <div className="ym-ticker-coins">
          {(["BTC", "ETH", "SOL", "XRP"] as const).map(sym => {
            const info = SIMULATOR_PRICES[sym];
            return (
              <Link key={sym} href="/trading" className="ym-ticker-coin-item">
                <span className="ym-ticker-sym">{sym}/USDT</span>
                <strong className="ym-ticker-price">${info.price.toLocaleString("en-US")}</strong>
                <span className={info.up ? "ym-rate-up" : "ym-rate-down"}>{info.change}</span>
              </Link>
            );
          })}
        </div>
        <dl className="ym-ticker-metrics">
          <div>
            <dt>BTC 도미넌스</dt>
            <dd>56.4%</dd>
          </div>
          <div>
            <dt>글로벌 선물 펀딩비</dt>
            <dd className="ym-text-violet">+0.0100%</dd>
          </div>
          <div>
            <dt>롱/숏 포지션 비율</dt>
            <dd>LONG 52.8% / SHORT 47.2%</dd>
          </div>
          <div>
            <dt>공포·탐욕 지수</dt>
            <dd className="ym-rate-up">64 (탐욕)</dd>
          </div>
        </dl>
      </section>

      {/* 코인니스형 3단 메인 그리드 */}
      <div className="ym-portal-grid">
        {/* 1열: 24시간 실시간 속보 타임라인 */}
        <section className="ym-portal-col ym-col-breaking" aria-label="24시간 실시간 속보 타임라인">
          <header className="ym-col-header">
            <div className="ym-col-title-wrap">
              <span className="ym-live-dot" aria-hidden="true" />
              <h2>24시 실시간 속보</h2>
              <span className="ym-sub-badge">LIVE</span>
            </div>
            <div className="ym-breaking-controls">
              <button
                type="button"
                aria-pressed={!importantOnly}
                className={!importantOnly ? "ym-filter-pill is-active" : "ym-filter-pill"}
                onClick={() => setImportantOnly(false)}
              >
                전체 속보
              </button>
              <button
                type="button"
                aria-pressed={importantOnly}
                className={importantOnly ? "ym-filter-pill is-active" : "ym-filter-pill"}
                onClick={() => setImportantOnly(true)}
              >
                중요 속보만
              </button>
            </div>
          </header>

          <div className="ym-breaking-search">
            <input
              type="search"
              className="myInput ym-input-compact"
              aria-label="실시간 속보 키워드 필터"
              placeholder="속보 즉시 필터 (예: ETF, 연준, BTC, SOL)"
              value={flashKeyword}
              onChange={event => setFlashKeyword(event.target.value)}
            />
          </div>

          <ol className="ym-timeline-list">
            {filteredFlashes.map(flash => {
              const userVote = votes[flash.id];
              const bullTotal = flash.bullCount + (userVote === "bull" ? 1 : 0);
              const bearTotal = flash.bearCount + (userVote === "bear" ? 1 : 0);

              return (
                <li key={flash.id} className={`ym-timeline-item ${flash.important ? "is-important" : ""}`}>
                  <div className="ym-timeline-meta">
                    <time className="ym-timeline-time">{flash.time}</time>
                    {flash.important && <span className="ym-badge-violet">중요</span>}
                    {flash.symbol && <span className="ym-badge-outline">#{flash.symbol}</span>}
                    <span className="ym-timeline-source">{flash.source}</span>
                  </div>
                  <button
                    type="button"
                    className="ym-timeline-headline-btn"
                    onClick={() => setActiveFlash(flash)}
                  >
                    {flash.headline}
                  </button>
                  <p className="ym-timeline-summary">{flash.body}</p>
                  <div className="ym-timeline-footer">
                    <div className="ym-sentiment-group" role="group" aria-label="속보 투자 심리 투표">
                      <button
                        type="button"
                        aria-pressed={userVote === "bull"}
                        className={userVote === "bull" ? "ym-sentiment-btn is-bull-active" : "ym-sentiment-btn"}
                        onClick={() => castVote(flash.id, "bull")}
                      >
                        ▲ 강세 {bullTotal}
                      </button>
                      <button
                        type="button"
                        aria-pressed={userVote === "bear"}
                        className={userVote === "bear" ? "ym-sentiment-btn is-bear-active" : "ym-sentiment-btn"}
                        onClick={() => castVote(flash.id, "bear")}
                      >
                        ▼ 약세 {bearTotal}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ym-text-link-btn"
                      onClick={() => setActiveFlash(flash)}
                    >
                      상세 모달 보기
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="ym-col-more">
            <Link href="/news" className="signup-button">
              실시간 뉴스·속보 전체 보기
            </Link>
          </div>
        </section>

        {/* 2열: 주요 심층 뉴스 아티클 */}
        <section className="ym-portal-col ym-col-articles" aria-label="주요 심층 뉴스 및 리서치">
          <header className="ym-col-header">
            <h2>주요 심층 뉴스</h2>
            <Link href="/news" className="ym-text-link-btn">
              뉴스룸 이동 →
            </Link>
          </header>

          <div className="ym-chip-row ym-mb-12" role="tablist" aria-label="심층 뉴스 카테고리">
            {(
              [
                { key: "", label: "전체" },
                { key: "CRYPTO", label: "코인 시황" },
                { key: "MACRO", label: "거시·세계 경제" },
                { key: "ONCHAIN", label: "온체인·수급" },
                { key: "REGULATION", label: "규제·정책" },
              ] as const
            ).map(tab => (
              <button
                key={tab.key || "ALL"}
                type="button"
                role="tab"
                aria-selected={articleCategory === tab.key}
                className={articleCategory === tab.key ? "ym-tag-chip is-active" : "ym-tag-chip"}
                onClick={() => setArticleCategory(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="ym-article-card-list">
            {filteredArticles.map(article => (
              <article key={article.id} className="ym-article-card">
                <div className="ym-article-thumb" data-s3-slot="news-thumbnail" aria-label={`${article.symbol} 뉴스 썸네일 슬롯`}>
                  <span className="ym-thumb-symbol">#{article.symbol}</span>
                  <span className="ym-thumb-cat">{article.categoryLabel}</span>
                </div>
                <div className="ym-article-body">
                  <div className="ym-article-meta">
                    <span className="ym-badge-outline">{article.categoryLabel}</span>
                    <span className="ym-badge-violet">#{article.symbol}</span>
                    <span>{article.publishedAt}</span>
                  </div>
                  <h3>
                    <button
                      type="button"
                      className="ym-article-title-btn"
                      onClick={() => setActiveArticle(article)}
                    >
                      {article.title}
                    </button>
                  </h3>
                  <p>{article.summary}</p>
                  <div className="ym-article-actions">
                    <button
                      type="button"
                      className="ym-text-link-btn"
                      onClick={() => setActiveArticle(article)}
                    >
                      전문 읽기 ({article.readMinutes}분)
                    </button>
                    <Link href="/trading" className="ym-text-link-violet">
                      #{article.symbol} 선물 모의투자 →
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 3열: 요기망치 선물 모의투자 퀵 위젯 & 커뮤니티 HOT 랭킹 */}
        <aside className="ym-portal-col ym-col-sidebar" aria-label="선물 모의투자 퀵 시뮬레이터 및 커뮤니티 인기글">
          <div className="ym-sim-widget-card">
            <div className="ym-sim-widget-head">
              <span className="ym-badge-violet">YOGIMANGCHI FUTURES</span>
              <h2>선물 모의투자 퀵 시뮬레이터</h2>
              <p>회원·게스트 모두 10,000 USDT 가상 증거금으로 리스크 없이 격리마진 선물 거래를 체험할 수 있습니다.</p>
            </div>

            <div className="ym-sim-controls">
              <div>
                <span className="ym-field-title">종목 선택</span>
                <div className="ym-sim-btn-grid">
                  {(["BTC", "ETH", "SOL", "XRP"] as const).map(sym => (
                    <button
                      key={sym}
                      type="button"
                      aria-pressed={simSymbol === sym}
                      className={simSymbol === sym ? "ym-sim-chip is-active" : "ym-sim-chip"}
                      onClick={() => setSimSymbol(sym)}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="ym-field-title">포지션 방향</span>
                <div className="ym-sim-side-grid">
                  <button
                    type="button"
                    aria-pressed={simSide === "LONG"}
                    className={simSide === "LONG" ? "ym-sim-side is-long" : "ym-sim-side"}
                    onClick={() => setSimSide("LONG")}
                  >
                    LONG (매수·상승)
                  </button>
                  <button
                    type="button"
                    aria-pressed={simSide === "SHORT"}
                    className={simSide === "SHORT" ? "ym-sim-side is-short" : "ym-sim-side"}
                    onClick={() => setSimSide("SHORT")}
                  >
                    SHORT (매도·하락)
                  </button>
                </div>
              </div>

              <div>
                <span className="ym-field-title">레버리지 배율 (격리마진)</span>
                <div className="ym-sim-btn-grid">
                  {([1, 5, 10, 25] as const).map(lev => (
                    <button
                      key={lev}
                      type="button"
                      aria-pressed={simLeverage === lev}
                      className={simLeverage === lev ? "ym-sim-chip is-active" : "ym-sim-chip"}
                      onClick={() => setSimLeverage(lev)}
                    >
                      {lev}x
                    </button>
                  ))}
                </div>
              </div>

              <label className="ym-label-block">
                <span className="ym-field-title">투입 증거금 (USDT)</span>
                <input
                  type="number"
                  className="myInput ym-input-compact"
                  min={100}
                  max={10000}
                  step={100}
                  value={simMargin}
                  onChange={event => setSimMargin(Math.min(10000, Math.max(100, Number(event.target.value) || 100)))}
                />
              </label>
            </div>

            <dl className="ym-sim-preview-box">
              <div>
                <dt>기준 시세 ({simSymbol})</dt>
                <dd>${refPrice.toLocaleString("en-US")} USDT</dd>
              </div>
              <div>
                <dt>예상 포지션 규모 ({simLeverage}x)</dt>
                <dd>{notionalUsdt.toLocaleString("en-US")} USDT ({estimatedQty} {simSymbol})</dd>
              </div>
              <div>
                <dt>예상 강제청산가 (격리)</dt>
                <dd className="ym-text-violet">
                  ${liqPrice.toLocaleString("en-US", { maximumFractionDigits: simSymbol === "XRP" ? 4 : 1 })} USDT
                </dd>
              </div>
            </dl>

            <Link href="/trading" className="login-button">
              선물 모의투자 시작하기
            </Link>
          </div>

          <div className="ym-hot-community-card">
            <header className="ym-col-header">
              <h2>실시간 커뮤니티 HOT</h2>
              <Link href="/community" className="ym-text-link-btn">
                전체 피드 →
              </Link>
            </header>
            <ol className="ym-hot-rank-list">
              {HOT_COMMUNITY_POSTS.map((post, idx) => (
                <li key={post.id} className="ym-hot-rank-item">
                  <span className="ym-rank-num">{idx + 1}</span>
                  <div className="ym-rank-body">
                    <div className="ym-rank-badges">
                      <span className="ym-badge-outline">{post.category}</span>
                      <span className="ym-text-violet">#{post.symbol}</span>
                    </div>
                    <Link href="/community" className="ym-rank-title">
                      {post.title}
                    </Link>
                    <span className="ym-rank-meta">
                      좋아요 {post.likes} · 댓글 {post.comments}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>

      {/* 속보 상세 딤 팝업 모달 */}
      <DimModal
        open={activeFlash !== null}
        onClose={() => setActiveFlash(null)}
        title={activeFlash?.headline ?? "실시간 속보 상세"}
        subtitle={activeFlash ? `${activeFlash.time} KST · ${activeFlash.source}` : undefined}
        footer={
          <div className="ym-modal-actions">
            <Link href="/trading" className="login-button ym-btn-inline" onClick={() => setActiveFlash(null)}>
              {activeFlash?.symbol ? `${activeFlash.symbol} 선물 모의투자 이동` : "선물 모의투자 이동"}
            </Link>
            <button type="button" className="signup-button ym-btn-inline" onClick={() => setActiveFlash(null)}>
              닫기
            </button>
          </div>
        }
      >
        {activeFlash && (
          <div className="ym-modal-prose">
            <p>{activeFlash.body}</p>
            <p className="member-note">
              실시간 속보는 시장 참고용 정보이며, 모의투자 주문 체결 및 증거금 정산의 최종 기준은 Trading Server 시세를 따릅니다.
            </p>
          </div>
        )}
      </DimModal>

      {/* 심층 뉴스 상세 딤 팝업 모달 */}
      <DimModal
        open={activeArticle !== null}
        onClose={() => setActiveArticle(null)}
        title={activeArticle?.title ?? "심층 뉴스 아티클"}
        subtitle={activeArticle ? `${activeArticle.categoryLabel} · ${activeArticle.author} · ${activeArticle.publishedAt}` : undefined}
        footer={
          <div className="ym-modal-actions">
            <Link href="/news" className="signup-button ym-btn-inline" onClick={() => setActiveArticle(null)}>
              뉴스 페이지에서 더보기
            </Link>
            <Link href="/trading" className="login-button ym-btn-inline" onClick={() => setActiveArticle(null)}>
              #{activeArticle?.symbol ?? "BTC"} 선물 거래 바로가기
            </Link>
          </div>
        }
      >
        {activeArticle && (
          <div className="ym-modal-prose">
            <p><strong>요약:</strong> {activeArticle.summary}</p>
            <p>{activeArticle.content}</p>
          </div>
        )}
      </DimModal>
    </MemberShell>
  );
}
