"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
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

  async function inspectArticle(id: number) {
    setDetailError(null);
    try {
      const item = parseNewsItem(await contentJson(origin, `/news/${id}`));
      setSelectedDetail(item);
    } catch (error) {
      setDetailError(contentMessage(error));
    }
  }

  return (
    <MemberShell title="실시간 코인·세계 경제 뉴스">
      <p className="member-note">
        글로벌 거시경제(연준 금리·물가·환율), 주요 암호화폐 시황, 온체인 수급 및 규제 동향을 실시간으로 확인하고 모의투자 전략에 참고하세요.
      </p>

      <div className="member-actions" role="tablist" aria-label="뉴스 카테고리 필터">
        {NEWS_CATEGORIES.map(tab => (
          <button
            key={tab.key || "ALL"}
            type="button"
            role="tab"
            aria-selected={category === tab.key}
            className={category === tab.key ? "member-primary" : "member-secondary"}
            onClick={() => {
              setCategory(tab.key);
              resetPagination();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="member-actions" role="group" aria-label="뉴스 종목 태그 필터">
        {SYMBOL_FILTER_TAGS.map(tag => (
          <button
            key={tag || "ALL_SYMBOL"}
            type="button"
            aria-pressed={symbolTag === tag}
            className={symbolTag === tag ? "member-primary" : "member-secondary"}
            onClick={() => {
              setSymbolTag(tag);
              resetPagination();
            }}
          >
            {tag ? `#${tag}` : "전체 종목"}
          </button>
        ))}
      </div>

      <form
        className="member-search"
        onSubmit={event => {
          event.preventDefault();
          setSubmittedKeyword(keyword.trim());
          resetPagination();
        }}
      >
        <input
          type="search"
          aria-label="뉴스 키워드 검색"
          placeholder="키워드 검색 (예: ETF, 연준, 금리, BTC)"
          maxLength={40}
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
        <button type="submit" className="member-secondary">검색</button>
      </form>

      {query.isPending && <p role="status" className="member-message">실시간 뉴스 피드를 불러오는 중입니다…</p>}
      {query.isError && (
        <p role="alert" className="member-message">
          뉴스 피드를 조회하지 못했습니다. {contentMessage(query.error)}{" "}
          <button type="button" className="account-refresh" onClick={() => void query.refetch()}>다시 조회</button>
        </p>
      )}
      {detailError && <p role="alert" className="member-message">{detailError}</p>}

      {selectedDetail && (
        <aside className="member-simulation" aria-label="선택한 뉴스 상세">
          <h2>{selectedDetail.title}</h2>
          <p className="member-note">
            [{newsCategoryLabel(selectedDetail.category)}] · 출처 {selectedDetail.sourceName} · {kst(selectedDetail.publishedAt)} KST
            {selectedDetail.symbolTag ? ` · #${selectedDetail.symbolTag}` : ""}
          </p>
          <p className="member-profile-message">{selectedDetail.content}</p>
          <div className="member-actions">
            {selectedDetail.symbolTag && (
              <Link href="/trading" className="member-primary">
                {selectedDetail.symbolTag} 선물 모의투자 바로가기
              </Link>
            )}
            <button type="button" className="member-secondary" onClick={() => setSelectedDetail(null)}>상세 닫기</button>
          </div>
        </aside>
      )}

      {!query.isPending && !query.isError && allItems.length === 0 && (
        <p className="member-message">선택한 조건에 해당하는 뉴스가 없습니다.</p>
      )}

      {allItems.length > 0 && (
        <ul className="member-follow-list" aria-label="뉴스 목록">
          {allItems.map(item => (
            <li key={item.id}>
              <article>
                <p className="member-note">
                  <strong>[{newsCategoryLabel(item.category)}]</strong>
                  {item.symbolTag && <> · <span>#{item.symbolTag}</span></>}
                  {" "}· 출처 {item.sourceName} · <time dateTime={item.publishedAt}>{kst(item.publishedAt)} KST</time>
                </p>
                <h2>{item.title}</h2>
                <p className="member-profile-message">{item.summary}</p>
                <details>
                  <summary>뉴스 본문 전체 보기</summary>
                  <p className="member-profile-message">{item.content}</p>
                  <div className="member-actions">
                    <button type="button" className="account-refresh" onClick={() => void inspectArticle(item.id)}>
                      단건 원문 새로고침
                    </button>
                    {item.symbolTag && (
                      <Link href="/trading" className="account-refresh">
                        {item.symbolTag} 선물 모의투자 이동
                      </Link>
                    )}
                  </div>
                </details>
              </article>
            </li>
          ))}
        </ul>
      )}

      {hasNext && (
        <div className="member-actions">
          <button type="button" className="member-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "불러오는 중…" : "이전 뉴스 더보기"}
          </button>
        </div>
      )}
    </MemberShell>
  );
}
