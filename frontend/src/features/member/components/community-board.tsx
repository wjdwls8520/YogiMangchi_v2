"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
import { DimModal } from "./dim-modal";
import { CommunityImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";
import { contentMessage } from "../api/client";
import {
  COMMUNITY_CATEGORIES,
  SYMBOL_FILTER_TAGS,
  communityCategoryLabel,
  communityPostsPath,
  parseCommunityComment,
  parseCommunityComments,
  parseCommunityLike,
  parseCommunityPost,
  parseCommunityPostPage,
  readCommunityOrPublic,
  type CommunityCategory,
  type CommunityComment,
  type CommunityPost,
  type CommunityPostPage,
  type CommunitySort,
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

function AuthorBadge({ memberId, nickname, withdrawn }: { memberId: number; nickname: string; withdrawn: boolean }) {
  if (withdrawn) {
    return <span className="member-note" data-withdrawn="true">탈퇴한회원</span>;
  }
  return <Link href={`/members/${memberId}`}>{nickname}</Link>;
}

const TRENDING_TOPICS = [
  { rank: 1, tag: "BTC", label: "비트코인 현물 ETF 유입 & 96K 공방", posts: 128 },
  { rank: 2, tag: "SOL", label: "솔라나 무기한 선물 거래량 급증", posts: 84 },
  { rank: 3, tag: "ETH", label: "이더리움 펀딩비 및 상대강도 반등", posts: 67 },
  { rank: 4, tag: "XRP", label: "글로벌 파생상품 규제 가이드라인", posts: 41 },
];

export function CommunityBoard({
  initialPage,
  initialComments = {},
}: {
  initialPage?: CommunityPostPage;
  initialComments?: Record<number, CommunityComment[]>;
} = {}) {
  const { origin, session, snapshot } = useMember();
  const client = useQueryClient();

  const [sort, setSort] = useState<CommunitySort>("LATEST");
  const [category, setCategory] = useState<"" | CommunityCategory>("");
  const [symbolTag, setSymbolTag] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [extraPosts, setExtraPosts] = useState<CommunityPost[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null | undefined>(undefined);
  const [hasNextOverride, setHasNextOverride] = useState<boolean | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const [newCategory, setNewCategory] = useState<CommunityCategory>("MARKET");
  const [newSymbolTag, setNewSymbolTag] = useState<string>("BTC");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [attachPositionBadge, setAttachPositionBadge] = useState(true);
  const [postImages, setPostImages] = useState<SelectedS3File[]>([]);
  const [submittingPost, setSubmittingPost] = useState(false);

  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState<CommunityCategory>("MARKET");
  const [editSymbolTag, setEditSymbolTag] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [commentsByPost, setCommentsByPost] = useState<Record<number, CommunityComment[]>>(initialComments);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [replyTargetByPost, setReplyTargetByPost] = useState<Record<number, number | null>>({});
  const [busyAction, setBusyAction] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const [lightboxState, setLightboxState] = useState<{
    title: string;
    subtitle: string;
    previewUrl?: string;
    symbol?: string | null;
  } | null>(null);

  const queryKey = ["community-posts", origin, snapshot.memberId, snapshot.generation, sort, category, symbolTag, submittedKeyword] as const;

  const query = useQuery({
    queryKey,
    initialData: initialPage && sort === "LATEST" && !category && !symbolTag && !submittedKeyword ? initialPage : undefined,
    queryFn: async ({ signal }) =>
      parseCommunityPostPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          communityPostsPath({ category, sort, symbolTag, keyword: submittedKeyword, size: 10 }),
          signal,
        ),
      ),
  });

  function resetPagination() {
    setExtraPosts([]);
    setNextCursor(undefined);
    setHasNextOverride(undefined);
  }

  const basePosts = query.data?.items ?? [];
  const allPosts = [...basePosts, ...extraPosts.filter(item => !basePosts.some(base => base.id === item.id))];
  const hasNext = hasNextOverride ?? query.data?.hasNext ?? false;
  const cursorId = nextCursor !== undefined ? nextCursor : (query.data?.nextCursorId ?? null);

  async function refreshPosts() {
    resetPagination();
    await client.invalidateQueries({ queryKey: ["community-posts", origin] });
  }

  async function createPost(event: React.FormEvent) {
    event.preventDefault();
    if (submittingPost || snapshot.phase !== "ready") return;
    const title = newTitle.trim();
    const content = newContent.trim();
    if (title.length < 2 || content.length < 2) {
      setFeedback({ kind: "error", text: "제목과 본문은 모두 2자 이상 입력해 주세요." });
      return;
    }
    setSubmittingPost(true);
    setFeedback(null);
    try {
      const created = parseCommunityPost(
        await session.request("/community/posts", {
          method: "POST",
          body: {
            category: newCategory,
            symbolTag: newSymbolTag || null,
            title,
            content,
          },
        }),
      );
      setNewTitle("");
      setNewContent("");
      setPostImages([]);
      setFeedback({ kind: "info", text: `게시글 #${created.id}이(가) 등록되었습니다.` });
      await refreshPosts();
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setSubmittingPost(false);
    }
  }

  function startEdit(post: CommunityPost) {
    setEditingPostId(post.id);
    setEditCategory(post.category);
    setEditSymbolTag(post.symbolTag ?? "");
    setEditTitle(post.title);
    setEditContent(post.content);
    setFeedback(null);
  }

  async function submitEdit(postId: number) {
    if (savingEdit || snapshot.phase !== "ready") return;
    setSavingEdit(true);
    setFeedback(null);
    try {
      await session.request(`/community/posts/${postId}`, {
        method: "PATCH",
        body: {
          category: editCategory,
          symbolTag: editSymbolTag || null,
          title: editTitle.trim(),
          content: editContent.trim(),
        },
      });
      setEditingPostId(null);
      setFeedback({ kind: "info", text: "게시글이 수정되었습니다." });
      await refreshPosts();
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setSavingEdit(false);
    }
  }

  async function deletePost(postId: number) {
    if (busyAction || snapshot.phase !== "ready") return;
    setBusyAction(true);
    setFeedback(null);
    try {
      await session.request(`/community/posts/${postId}`, { method: "DELETE" });
      setFeedback({ kind: "info", text: "게시글이 삭제되었습니다." });
      await refreshPosts();
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setBusyAction(false);
    }
  }

  async function toggleLike(post: CommunityPost) {
    if (busyAction || snapshot.phase !== "ready") return;
    setBusyAction(true);
    setFeedback(null);
    try {
      parseCommunityLike(
        await session.request(`/community/posts/${post.id}/likes`, {
          method: post.likedByMe ? "DELETE" : "PUT",
        }),
      );
      await refreshPosts();
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setBusyAction(false);
    }
  }

  async function loadComments(postId: number) {
    try {
      const list = parseCommunityComments(
        await readCommunityOrPublic(origin, session, snapshot, `/community/posts/${postId}/comments`),
      );
      setCommentsByPost(current => ({ ...current, [postId]: list.items }));
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    }
  }

  async function submitComment(postId: number) {
    const content = (commentDrafts[postId] ?? "").trim();
    if (!content || busyAction || snapshot.phase !== "ready") return;
    const parentCommentId = replyTargetByPost[postId] ?? null;
    setBusyAction(true);
    setFeedback(null);
    try {
      const created = parseCommunityComment(
        await session.request(`/community/posts/${postId}/comments`, {
          method: "POST",
          body: { content, parentCommentId },
        }),
      );
      setCommentsByPost(current => ({
        ...current,
        [postId]: [...(current[postId] ?? []), created],
      }));
      setCommentDrafts(current => ({ ...current, [postId]: "" }));
      setReplyTargetByPost(current => ({ ...current, [postId]: null }));
      await refreshPosts();
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setBusyAction(false);
    }
  }

  async function removeComment(postId: number, commentId: number) {
    if (busyAction || snapshot.phase !== "ready") return;
    setBusyAction(true);
    setFeedback(null);
    try {
      await session.request(`/community/comments/${commentId}`, { method: "DELETE" });
      await loadComments(postId);
      await refreshPosts();
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setBusyAction(false);
    }
  }

  async function loadMore() {
    if (!hasNext || !cursorId || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = parseCommunityPostPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          communityPostsPath({ category, sort, symbolTag, keyword: submittedKeyword, cursorId, size: 10 }),
        ),
      );
      setExtraPosts(current => [...current, ...page.items]);
      setNextCursor(page.nextCursorId);
      setHasNextOverride(page.hasNext);
    } catch (error) {
      setFeedback({ kind: "error", text: contentMessage(error) });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <MemberShell
      title="트레이더 커뮤니티"
      subtitle="토스증권 피드 감성으로 선물 모의투자 시황 관점, 차트 분석, 포지션 수익률을 공유하고 실시간으로 소통하세요."
      variant="wide"
    >
      <div className="ym-toss-feed-layout">
        {/* 좌측 토스증권형 피드 탐색 사이드바 */}
        <aside className="ym-toss-left-nav" aria-label="커뮤니티 피드 탐색">
          <div className="ym-toss-nav-box">
            <span className="ym-toss-nav-title">피드 스트림</span>
            <div className="ym-toss-tab-stack" role="tablist" aria-label="커뮤니티 정렬">
              <button
                type="button"
                role="tab"
                aria-selected={sort === "LATEST"}
                className={sort === "LATEST" ? "member-primary ym-toss-nav-btn is-active" : "member-secondary ym-toss-nav-btn"}
                onClick={() => {
                  setSort("LATEST");
                  resetPagination();
                }}
              >
                최신글 (LATEST)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sort === "POPULAR"}
                className={sort === "POPULAR" ? "member-primary ym-toss-nav-btn is-active" : "member-secondary ym-toss-nav-btn"}
                onClick={() => {
                  setSort("POPULAR");
                  resetPagination();
                }}
              >
                인기글 (POPULAR)
              </button>
            </div>
          </div>

          <div className="ym-toss-nav-box">
            <span className="ym-toss-nav-title">주제별 피드</span>
            <div className="ym-toss-tab-stack" role="tablist" aria-label="커뮤니티 카테고리 필터">
              {COMMUNITY_CATEGORIES.map(tab => (
                <button
                  key={tab.key || "ALL"}
                  type="button"
                  role="tab"
                  aria-selected={category === tab.key}
                  className={category === tab.key ? "member-primary ym-toss-nav-btn is-active" : "member-secondary ym-toss-nav-btn"}
                  onClick={() => {
                    setCategory(tab.key);
                    resetPagination();
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ym-toss-nav-box">
            <span className="ym-toss-nav-title">종목 라운지</span>
            <div className="ym-chip-row" role="group" aria-label="커뮤니티 종목 태그 필터">
              {SYMBOL_FILTER_TAGS.map(tag => (
                <button
                  key={tag || "ALL_SYMBOL"}
                  type="button"
                  aria-pressed={symbolTag === tag}
                  className={symbolTag === tag ? "ym-tag-chip is-active" : "ym-tag-chip"}
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
        </aside>

        {/* 중앙 메인 피드 스트림 */}
        <div className="ym-toss-center-stream">
          <form
            className="member-search ym-toss-search-bar"
            onSubmit={event => {
              event.preventDefault();
              setSubmittedKeyword(keyword.trim());
              resetPagination();
            }}
          >
            <input
              type="search"
              className="myInput"
              aria-label="커뮤니티 게시글 검색"
              placeholder="제목·본문 키워드 검색 (예: 돌파, 손절가, 펀딩비)"
              maxLength={40}
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
            />
            <button type="submit" className="member-secondary ym-inline-check-btn">
              검색
            </button>
          </form>

          {snapshot.phase === "ready" ? (
            <section className="ym-toss-composer-card" aria-label="새 게시글 작성">
              <div className="ym-composer-header">
                <h2>새 글 작성</h2>
                <button
                  type="button"
                  aria-pressed={attachPositionBadge}
                  className={attachPositionBadge ? "ym-tag-chip is-active" : "ym-tag-chip"}
                  onClick={() => setAttachPositionBadge(v => !v)}
                >
                  {attachPositionBadge ? "✓ 모의투자 수익률·포지션 배지 표시" : "+ 모의투자 수익률 배지 첨부"}
                </button>
              </div>

              {attachPositionBadge && (
                <div className="ym-verified-position-banner">
                  <span className="ym-badge-violet">모의투자 인증</span>
                  <span>
                    요기망치 선물 모의투자 · <strong>#{newSymbolTag || "BTC"} LONG 10x (격리)</strong> 포지션 공유 태그가 함께 표시됩니다.
                  </span>
                </div>
              )}

              <form className="member-fields" onSubmit={event => void createPost(event)}>
                <fieldset disabled={submittingPost}>
                  <div className="ym-composer-select-row">
                    <label>
                      카테고리
                      <select
                        className="myInput"
                        value={newCategory}
                        onChange={event => setNewCategory(event.target.value as CommunityCategory)}
                      >
                        <option value="MARKET">시황·관점 (MARKET)</option>
                        <option value="ANALYSIS">차트 분석 (ANALYSIS)</option>
                        <option value="POSITION">포지션 공유 (POSITION)</option>
                        <option value="FREE">자유 (FREE)</option>
                      </select>
                    </label>
                    <label>
                      종목 태그 (선택)
                      <select
                        className="myInput"
                        value={newSymbolTag}
                        onChange={event => setNewSymbolTag(event.target.value)}
                      >
                        <option value="">종목 미지정</option>
                        <option value="BTC">BTC</option>
                        <option value="ETH">ETH</option>
                        <option value="SOL">SOL</option>
                        <option value="XRP">XRP</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    제목
                    <input
                      type="text"
                      name="title"
                      className="myInput"
                      minLength={2}
                      maxLength={120}
                      required
                      placeholder="제목을 입력하세요 (2~120자)"
                      value={newTitle}
                      onChange={event => setNewTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    본문
                    <textarea
                      name="content"
                      className="myTextarea"
                      rows={4}
                      minLength={2}
                      maxLength={4000}
                      required
                      placeholder="시황 관점, 진입 근거, 손절/익절 계획을 자유롭게 공유하세요 (2~4000자)"
                      value={newContent}
                      onChange={event => setNewContent(event.target.value)}
                    />
                  </label>

                  <CommunityImageUploadSlot
                    files={postImages}
                    onChange={setPostImages}
                    onInspectImage={file =>
                      setLightboxState({
                        title: file.name,
                        subtitle: "첨부 차트·포지션 이미지 미리보기",
                        previewUrl: file.previewUrl,
                        symbol: newSymbolTag || "BTC",
                      })
                    }
                  />

                  <button type="submit" className="member-primary login-button">
                    {submittingPost ? "등록 중…" : "게시글 등록"}
                  </button>
                </fieldset>
              </form>
            </section>
          ) : (
            <section className="ym-toss-composer-card">
              <p className="member-message">
                게시글 작성·좋아요·댓글 참여는 회원 로그인 후 이용할 수 있습니다.{" "}
                <Link href="/login" className="account-refresh">
                  로그인하러 가기
                </Link>
              </p>
              <CommunityImageUploadSlot
                files={postImages}
                onChange={setPostImages}
                onInspectImage={file =>
                  setLightboxState({
                    title: file.name,
                    subtitle: "첨부 이미지 미리보기",
                    previewUrl: file.previewUrl,
                  })
                }
              />
            </section>
          )}

          {feedback && (
            <p role={feedback.kind === "error" ? "alert" : "status"} className="member-message">
              {feedback.text}
            </p>
          )}

          {query.isPending && <p role="status" className="member-message">커뮤니티 게시글을 불러오는 중입니다…</p>}
          {query.isError && (
            <p role="alert" className="member-message">
              게시글 목록을 조회하지 못했습니다. {contentMessage(query.error)}{" "}
              <button type="button" className="account-refresh" onClick={() => void query.refetch()}>
                다시 조회
              </button>
            </p>
          )}

          {!query.isPending && !query.isError && allPosts.length === 0 && (
            <p className="member-message">조건에 해당하는 게시글이 없습니다.</p>
          )}

          {allPosts.length > 0 && (
            <ul className="ym-toss-feed-list" aria-label="커뮤니티 게시글 목록">
              {allPosts.map(post => {
                const comments = commentsByPost[post.id] ?? [];
                const topComments = comments.filter(c => c.parentCommentId === null);
                const repliesByParent = new Map<number, CommunityComment[]>();
                for (const c of comments) {
                  if (c.parentCommentId !== null) {
                    const list = repliesByParent.get(c.parentCommentId) ?? [];
                    list.push(c);
                    repliesByParent.set(c.parentCommentId, list);
                  }
                }
                const replyTarget = replyTargetByPost[post.id] ?? null;

                return (
                  <li key={post.id} className="ym-toss-feed-card">
                    <article>
                      <header className="ym-feed-card-head">
                        <div className="ym-feed-avatar" aria-hidden="true">
                          {post.authorWithdrawn ? "—" : post.authorNickname.slice(0, 1)}
                        </div>
                        <div className="ym-feed-head-meta">
                          <p className="member-note">
                            <strong>[{communityCategoryLabel(post.category)}]</strong>
                            {post.symbolTag && (
                              <>
                                {" "}· <span className="ym-badge-violet">#{post.symbolTag}</span>
                              </>
                            )}
                            {" "}· 작성자{" "}
                            <AuthorBadge
                              memberId={post.memberId}
                              nickname={post.authorNickname}
                              withdrawn={post.authorWithdrawn}
                            />
                            {" "}· <time dateTime={post.createdAt}>{kst(post.createdAt)} KST</time>
                          </p>
                          {post.category === "POSITION" && (
                            <span className="ym-position-verified-pill">
                              모의투자 포지션 공유 · {post.symbolTag ?? "BTC"} 격리마진
                            </span>
                          )}
                        </div>
                      </header>

                      {editingPostId === post.id ? (
                        <div className="member-fields">
                          <label>
                            제목 수정
                            <input
                              type="text"
                              className="myInput"
                              value={editTitle}
                              maxLength={120}
                              onChange={event => setEditTitle(event.target.value)}
                            />
                          </label>
                          <label>
                            본문 수정
                            <textarea
                              rows={4}
                              className="myTextarea"
                              value={editContent}
                              maxLength={4000}
                              onChange={event => setEditContent(event.target.value)}
                            />
                          </label>
                          <div className="member-actions">
                            <button
                              type="button"
                              className="member-primary"
                              disabled={savingEdit}
                              onClick={() => void submitEdit(post.id)}
                            >
                              {savingEdit ? "저장 중…" : "수정 저장"}
                            </button>
                            <button
                              type="button"
                              className="member-secondary"
                              onClick={() => setEditingPostId(null)}
                            >
                              수정 취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="ym-feed-card-body">
                          <h2>{post.title}</h2>
                          <p className="member-profile-message">{post.content}</p>
                        </div>
                      )}

                      <div className="member-actions ym-feed-action-bar">
                        <button
                          type="button"
                          className={post.likedByMe ? "member-primary" : "member-secondary"}
                          disabled={busyAction || snapshot.phase !== "ready"}
                          aria-pressed={post.likedByMe}
                          onClick={() => void toggleLike(post)}
                        >
                          좋아요 {post.likeCount}
                        </button>
                        <button
                          type="button"
                          className="member-secondary"
                          onClick={() => void loadComments(post.id)}
                        >
                          댓글 {post.commentCount}개 보기
                        </button>
                        <button
                          type="button"
                          className="account-refresh"
                          onClick={() =>
                            setLightboxState({
                              title: post.title,
                              subtitle: `${communityCategoryLabel(post.category)} · ${kst(post.createdAt)} KST`,
                              symbol: post.symbolTag,
                            })
                          }
                        >
                          포지션·차트 확대 모달
                        </button>
                        {post.symbolTag && (
                          <Link href="/trading" className="account-refresh">
                            #{post.symbolTag} 거래 화면
                          </Link>
                        )}
                        {post.mine && editingPostId !== post.id && (
                          <>
                            <button
                              type="button"
                              className="account-refresh"
                              onClick={() => startEdit(post)}
                            >
                              게시글 수정
                            </button>
                            <button
                              type="button"
                              className="account-refresh"
                              disabled={busyAction}
                              onClick={() => void deletePost(post.id)}
                            >
                              게시글 삭제
                            </button>
                          </>
                        )}
                      </div>

                      {(comments.length > 0 || snapshot.phase === "ready") && (
                        <section className="ym-feed-comments-box" aria-label={`게시글 #${post.id} 댓글`}>
                          {topComments.length > 0 && (
                            <ul className="member-follow-list">
                              {topComments.map(comment => (
                                <li key={comment.id}>
                                  <p className="member-note">
                                    <AuthorBadge
                                      memberId={comment.memberId}
                                      nickname={comment.authorNickname}
                                      withdrawn={comment.authorWithdrawn}
                                    />
                                    {" "}· <time dateTime={comment.createdAt}>{kst(comment.createdAt)} KST</time>
                                  </p>
                                  <p className="member-profile-message">{comment.content}</p>
                                  <div className="member-actions">
                                    {snapshot.phase === "ready" && (
                                      <button
                                        type="button"
                                        className="account-refresh"
                                        onClick={() =>
                                          setReplyTargetByPost(current => ({ ...current, [post.id]: comment.id }))
                                        }
                                      >
                                        답글 달기
                                      </button>
                                    )}
                                    {comment.mine && (
                                      <button
                                        type="button"
                                        className="account-refresh"
                                        disabled={busyAction}
                                        onClick={() => void removeComment(post.id, comment.id)}
                                      >
                                        댓글 삭제
                                      </button>
                                    )}
                                  </div>
                                  {(repliesByParent.get(comment.id) ?? []).length > 0 && (
                                    <ul className="member-note ym-reply-list">
                                      {(repliesByParent.get(comment.id) ?? []).map(reply => (
                                        <li key={reply.id}>
                                          ↳ <AuthorBadge memberId={reply.memberId} nickname={reply.authorNickname} withdrawn={reply.authorWithdrawn} />: {reply.content} ({kst(reply.createdAt)} KST)
                                          {reply.mine && (
                                            <>
                                              {" "}
                                              <button
                                                type="button"
                                                className="account-refresh"
                                                disabled={busyAction}
                                                onClick={() => void removeComment(post.id, reply.id)}
                                              >
                                                답글 삭제
                                              </button>
                                            </>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}

                          {snapshot.phase === "ready" && (
                            <div className="member-search ym-comment-input-row">
                              <input
                                type="text"
                                className="myInput"
                                aria-label={`게시글 #${post.id} 댓글 입력`}
                                maxLength={1000}
                                placeholder={
                                  replyTarget
                                    ? `댓글 #${replyTarget}에 대한 답글 입력`
                                    : "댓글을 입력하세요 (1~1000자)"
                                }
                                value={commentDrafts[post.id] ?? ""}
                                onChange={event =>
                                  setCommentDrafts(current => ({ ...current, [post.id]: event.target.value }))
                                }
                              />
                              {replyTarget && (
                                <button
                                  type="button"
                                  className="member-secondary"
                                  onClick={() =>
                                    setReplyTargetByPost(current => ({ ...current, [post.id]: null }))
                                  }
                                >
                                  답글 취소
                                </button>
                              )}
                              <button
                                type="button"
                                className="member-primary ym-inline-check-btn"
                                disabled={busyAction}
                                onClick={() => void submitComment(post.id)}
                              >
                                {replyTarget ? "답글 등록" : "댓글 등록"}
                              </button>
                            </div>
                          )}
                        </section>
                      )}
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
                {loadingMore ? "불러오는 중…" : "이전 게시글 더보기"}
              </button>
            </div>
          )}
        </div>

        {/* 우측 실시간 트렌드·인기 토픽 사이드바 */}
        <aside className="ym-toss-right-sidebar" aria-label="실시간 트렌드 및 라운지 안내">
          <div className="ym-toss-side-card">
            <h2>실시간 급상승 토픽</h2>
            <ol className="ym-hot-rank-list">
              {TRENDING_TOPICS.map(item => (
                <li key={item.rank} className="ym-hot-rank-item">
                  <span className="ym-rank-num">{item.rank}</span>
                  <div className="ym-rank-body">
                    <button
                      type="button"
                      className="ym-rank-title-btn"
                      onClick={() => {
                        setSymbolTag(item.tag);
                        resetPagination();
                      }}
                    >
                      #{item.tag} · {item.label}
                    </button>
                    <span className="ym-rank-meta">실시간 게시글 {item.posts}건</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="ym-toss-side-card">
            <h2>요기망치 커뮤니티 운영 원칙</h2>
            <ul className="ym-side-rule-list">
              <li>모의투자 관점과 손절/익절 근거를 서로 존중하며 토론합니다.</li>
              <li>탈퇴한 회원의 작성글·댓글은 ‘탈퇴한회원’ 표기로 보존됩니다.</li>
              <li>실제 금전 대여·리딩방 유도는 엄격히 금지됩니다.</li>
            </ul>
            <Link href="/trading" className="login-button">
              10,000 USDT 모의투자 바로가기
            </Link>
          </div>
        </aside>
      </div>

      {/* 이미지·포지션 라이트박스 딤 모달 */}
      <DimModal
        open={lightboxState !== null}
        onClose={() => setLightboxState(null)}
        title={lightboxState?.title ?? "차트·포지션 상세 보기"}
        subtitle={lightboxState?.subtitle}
        footer={
          <div className="ym-modal-actions">
            {lightboxState?.symbol && (
              <Link
                href="/trading"
                className="login-button ym-btn-inline"
                onClick={() => setLightboxState(null)}
              >
                #{lightboxState.symbol} 선물 모의투자 이동
              </Link>
            )}
            <button
              type="button"
              className="signup-button ym-btn-inline"
              onClick={() => setLightboxState(null)}
            >
              닫기
            </button>
          </div>
        }
      >
        {lightboxState && (
          <div className="ym-lightbox-body">
            {lightboxState.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightboxState.previewUrl} alt={lightboxState.title} className="ym-lightbox-img" />
            ) : (
              <div className="ym-lightbox-placeholder" data-s3-slot="community-post-images">
                <span className="ym-badge-violet">
                  #{lightboxState.symbol ?? "BTC"} PERPETUAL FUTURES
                </span>
                <strong>{lightboxState.title}</strong>
                <p>요기망치 선물 모의투자 격리마진 스냅샷 · S3 이미지 스토리지 연동 슬롯</p>
              </div>
            )}
          </div>
        )}
      </DimModal>
    </MemberShell>
  );
}
