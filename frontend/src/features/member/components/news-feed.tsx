"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
import { DimModal } from "./dim-modal";
import { contentJson, contentMessage } from "../api/client";
import {
  NEWS_CATEGORIES,
  SYMBOL_FILTER_TAGS,
  newsCategoryLabel,
  newsPath,
  parseNewsItem,
  parseNewsPage,
  type NewsCategory,
  type NewsItem,
  type NewsPage,
} from "../api/community-news";

function kst(value: string) {
  return new Date(value).toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function kstTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString("sv-SE", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function NewsFeed({
  initialPage,
  initialCategory = "",
  initialSymbolTag = "",
}: {
  initialPage?: NewsPage;
  initialCategory?: "" | NewsCategory;
  initialSymbolTag?: string;
} = {}) {
  const { origin } = useMember();
  const [viewMode, setViewMode] = useState<"ALL" | "HEADLINE">("ALL");
  const [category, setCategory] = useState<"" | NewsCategory>(initialCategory);
  const [symbolTag, setSymbolTag] = useState<string>(initialSymbolTag);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [extraItems, setExtraItems] = useState<NewsItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null | undefined>(undefined);
  const [hasNextOverride, setHasNextOverride] = useState<boolean | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<NewsItem | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<number, "bull" | "bear">>({});

  const query = useQuery({
    queryKey: ["public-news", origin, category, symbolTag, submittedKeyword],
    initialData: initialPage && category === initialCategory && symbolTag === initialSymbolTag && !submittedKeyword ? initialPage : undefined,
    queryFn: async ({ signal }) =>
      parseNewsPage(await contentJson(origin, newsPath({ category, symbolTag, keyword: submittedKeyword, size: 10 }), { signal })),
  });

  function resetPagination() {
    setExtraItems([]);
    setNextCursor(undefined);
    setHasNextOverride(undefined);
  }

  const baseItems = query.data?.items ?? [];
  const allItems = [...baseItems, ...extraItems.filter(item => !baseItems.some(base => base.id === item.id))];
  const visibleItems = viewMode === "HEADLINE" ? allItems.filter((_, idx) => idx % 2 === 0 || allItems.length <= 2) : allItems;
  const hasNext = hasNextOverride ?? query.data?.hasNext ?? false;
  const cursorId = nextCursor !== undefined ? nextCursor : (query.data?.nextCursorId ?? null);

  async function loadMore() {
    if (!hasNext || !cursorId || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = parseNewsPage(
        await contentJson(origin, newsPath({ category, symbolTag, keyword: submittedKeyword, cursorId, size: 10 })),
      );
      setExtraItems(current => [...current, ...page.items]);
      setNextCursor(page.nextCursorId);
      setHasNextOverride(page.hasNext);
    } catch (error) {
      setDetailError(contentMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function inspectArticle(id: number, fallback?: NewsItem) {
    setDetailError(null);
    try {
      const item = parseNewsItem(await contentJson(origin, `/news/${id}`));
      setSelectedDetail(item);
    } catch (error) {
      if (fallback) {
        setSelectedDetail(fallback);
      } else {
        setDetailError(contentMessage(error));
      }
    }
  }

  function toggleReaction(id: number, kind: "bull" | "bear") {
    setReactions(current => ({ ...current, [id]: kind }));
  }

  return (
    <MemberShell
      title="실시간 코인·세계 경제 뉴스"
      subtitle="글로벌 거시경제(연준 금리·물가·환율), 주요 암호화폐 시황, 온체인 수급 및 규제 동향을 실시간으로 확인하고 모의투자 전략에 참고하세요."
      variant="wide"
    >
      {/* 상단 뷰 모드 전환 & 필터 바 (한 줄 컴팩트 규격 통일) */}
      <div className="ym-news-filter-panel rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="ym-news-filter-top flex flex-wrap items-center justify-between gap-3">
          <div className="ym-breaking-controls flex flex-wrap items-center gap-1.5" role="group" aria-label="뉴스 보기 모드">
            <button
              type="button"
              aria-pressed={viewMode === "ALL"}
              className={`ym-filter-pill inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                viewMode === "ALL"
                  ? "bg-gray-900 text-white is-active"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => setViewMode("ALL")}
            >
              전체 뉴스·속보
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "HEADLINE"}
              className={`ym-filter-pill inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                viewMode === "HEADLINE"
                  ? "bg-gray-900 text-white is-active"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => setViewMode("HEADLINE")}
            >
              중요 헤드라인
            </button>
          </div>

          <form
            className="member-search ym-news-search-form flex items-center gap-2"
            onSubmit={event => {
              event.preventDefault();
              setSubmittedKeyword(keyword.trim());
              resetPagination();
            }}
          >
            <input
              type="search"
              className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-3.5 text-xs font-medium text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              aria-label="뉴스 키워드 검색"
              placeholder="키워드 검색 (예: ETF, 연준, 금리, BTC)"
              maxLength={40}
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
            />
            <button
              type="submit"
              className="ym-inline-check-btn inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#0058FF] px-3.5 text-xs font-bold text-white whitespace-nowrap hover:bg-blue-700"
            >
              뉴스 검색
            </button>
          </form>
        </div>

        <div className="ym-chip-row flex flex-wrap items-center gap-1.5" role="tablist" aria-label="뉴스 카테고리 필터">
          {NEWS_CATEGORIES.map(tab => (
            <button
              key={tab.key || "ALL"}
              type="button"
              role="tab"
              aria-selected={category === tab.key}
              className={`ym-tag-chip inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                category === tab.key
                  ? "bg-[#0058FF] text-white is-active"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => {
                setCategory(tab.key);
                resetPagination();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ym-chip-row flex flex-wrap items-center gap-1.5" role="group" aria-label="뉴스 종목 태그 필터">
          {SYMBOL_FILTER_TAGS.map(tag => (
            <button
              key={tag || "ALL_SYMBOL"}
              type="button"
              aria-pressed={symbolTag === tag}
              className={`ym-tag-chip inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                symbolTag === tag
                  ? "bg-gray-900 text-white is-active"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => {
                setSymbolTag(tag);
                resetPagination();
              }}
            >
              {tag ? `#${tag}` : "전체 종목"}
            </button>
          ))}
        </div>
      </div>

      {query.isPending && <p role="status" className="member-message">실시간 뉴스 피드를 불러오는 중입니다…</p>}
      {query.isError && (
        <p role="alert" className="member-message">
          뉴스 피드를 조회하지 못했습니다. {contentMessage(query.error)}{" "}
          <button type="button" className="account-refresh" onClick={() => void query.refetch()}>
            다시 조회
          </button>
        </p>
      )}
      {detailError && <p role="alert" className="member-message">{detailError}</p>}

      {!query.isPending && !query.isError && visibleItems.length === 0 && (
        <p className="member-message">선택한 조건에 해당하는 뉴스가 없습니다.</p>
      )}

      {/* 코인니스형 2단 뉴스룸 구성 */}
      <div className="ym-coinness-news-grid">
        {/* 좌측: 24시 실시간 속보 타임라인 요약 */}
        <aside className="ym-news-timeline-rail" aria-label="24시 실시간 속보 브리핑">
          <div className="ym-col-header">
            <div className="ym-col-title-wrap">
              <span className="ym-live-dot" aria-hidden="true" />
              <h2>24시 타임라인</h2>
            </div>
            <span className="ym-sub-badge">KST</span>
          </div>

          <ol className="ym-timeline-list">
            {visibleItems.map(item => (
              <li key={`rail-${item.id}`} className="ym-timeline-item">
                <div className="ym-timeline-meta">
                  <time className="ym-timeline-time" dateTime={item.publishedAt}>
                    {kstTimeOnly(item.publishedAt)}
                  </time>
                  {item.symbolTag && <span className="ym-badge-violet">#{item.symbolTag}</span>}
                </div>
                <button
                  type="button"
                  className="ym-timeline-headline-btn"
                  onClick={() => setSelectedDetail(item)}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ol>

          <div className="ym-news-sentiment-box" aria-label="시장 뉴스 센티먼트 요약">
            <h3>실시간 뉴스 투자 심리</h3>
            <div className="ym-sentiment-meter">
              <div className="ym-sentiment-bar-bull" style={{ width: "68%" }}>
                강세 68%
              </div>
              <div className="ym-sentiment-bar-bear" style={{ width: "32%" }}>
                약세 32%
              </div>
            </div>
            <p className="member-note">
              현물 ETF 자금 유입 및 거시 금리 동결 기조로 단기 매수 심리가 우위를 보이고 있습니다.
            </p>
          </div>
        </aside>

        {/* 우측/중앙: 뉴스 아티클 카드 리스트 */}
        <div className="ym-news-main-stream">
          {visibleItems.length > 0 && (
            <ul className="ym-news-card-list" aria-label="뉴스 목록">
              {visibleItems.map(item => {
                const userReaction = reactions[item.id];
                const bullCount = 34 + (item.id % 19) + (userReaction === "bull" ? 1 : 0);
                const bearCount = 9 + (item.id % 7) + (userReaction === "bear" ? 1 : 0);

                return (
                  <li key={item.id} className="ym-news-card">
                    <article>
                      <div className="ym-news-card-top">
                        <div className="ym-news-thumb" data-s3-slot="news-thumbnail">
                          <span className="ym-thumb-symbol">#{item.symbolTag ?? "MACRO"}</span>
                          <span className="ym-thumb-cat">{newsCategoryLabel(item.category)}</span>
                        </div>
                        <div className="ym-news-card-content">
                          <p className="member-note">
                            <strong>[{newsCategoryLabel(item.category)}]</strong>
                            {item.symbolTag && (
                              <>
                                {" "}· <span className="ym-badge-violet">#{item.symbolTag}</span>
                              </>
                            )}
                            {" "}· 출처 {item.sourceName} ·{" "}
                            <time dateTime={item.publishedAt}>{kst(item.publishedAt)} KST</time>
                          </p>
                          <h2>{item.title}</h2>
                          <p className="member-profile-message">{item.summary}</p>
                        </div>
                      </div>

                      <div className="ym-news-reaction-row">
                        <div className="ym-sentiment-group" role="group" aria-label="뉴스 강세 약세 반응">
                          <button
                            type="button"
                            aria-pressed={userReaction === "bull"}
                            className={userReaction === "bull" ? "ym-sentiment-btn is-bull-active" : "ym-sentiment-btn"}
                            onClick={() => toggleReaction(item.id, "bull")}
                          >
                            ▲ 강세 {bullCount}
                          </button>
                          <button
                            type="button"
                            aria-pressed={userReaction === "bear"}
                            className={userReaction === "bear" ? "ym-sentiment-btn is-bear-active" : "ym-sentiment-btn"}
                            onClick={() => toggleReaction(item.id, "bear")}
                          >
                            ▼ 약세 {bearCount}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="ym-text-link-btn"
                          onClick={() => setSelectedDetail(item)}
                        >
                          뉴스 상세 모달 보기
                        </button>
                      </div>

                      <details className="ym-news-details">
                        <summary>뉴스 본문 전체 보기</summary>
                        <p className="member-profile-message">{item.content}</p>
                        <div className="member-actions">
                          <button
                            type="button"
                            className="account-refresh"
                            onClick={() => void inspectArticle(item.id, item)}
                          >
                            최신 원문 다시 불러오기 (단건 원문 새로고침)
                          </button>
                          {item.symbolTag && (
                            <Link href="/trading" className="account-refresh">
                              {item.symbolTag} 선물 거래 바로가기 ({item.symbolTag} 선물 모의투자 이동)
                            </Link>
                          )}
                        </div>
                      </details>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}

          {hasNext && (
            <div className="member-actions">
              <button
                type="button"
                className="signup-button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "불러오는 중…" : "다음 뉴스 더보기 (이전 뉴스 더보기)"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 선택한 뉴스 상세 딤 팝업 모달 */}
      <DimModal
        open={selectedDetail !== null}
        onClose={() => setSelectedDetail(null)}
        title={selectedDetail?.title ?? "뉴스 상세"}
        subtitle={
          selectedDetail
            ? `[${newsCategoryLabel(selectedDetail.category)}] · 출처 ${selectedDetail.sourceName} · ${kst(selectedDetail.publishedAt)} KST`
            : undefined
        }
        footer={
          <div className="ym-modal-actions">
            {selectedDetail?.symbolTag && (
              <Link
                href="/trading"
                className="login-button ym-btn-inline"
                onClick={() => setSelectedDetail(null)}
              >
                {selectedDetail.symbolTag} 선물 모의투자 바로가기
              </Link>
            )}
            <button
              type="button"
              className="signup-button ym-btn-inline"
              onClick={() => setSelectedDetail(null)}
            >
              상세 닫기
            </button>
          </div>
        }
      >
        {selectedDetail && (
          <div className="ym-modal-prose">
            <p><strong>요약:</strong> {selectedDetail.summary}</p>
            <p>{selectedDetail.content}</p>
          </div>
        )}
      </DimModal>
    </MemberShell>
  );
}
