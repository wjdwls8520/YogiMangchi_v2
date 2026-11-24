"use client";

import { useEffect, useState } from "react";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import { RequestIdChip } from "../../../components/request-id-copy";
import { getErrorRequestId, isUnexpectedApiError } from "../../../lib/request-id";
import {
  cn,
  V1IconAlert,
  V1IconCheck,
  V1IconComment,
} from "../../member/components/v1-ui";
import {
  deleteAdminCommunityPost,
  deleteAdminCommunityReply,
  fetchAdminCommunityPosts,
  fetchAdminCommunityReplies,
  formatAdminDateTime,
  restoreAdminCommunityPost,
  restoreAdminCommunityReply,
  type AdminPostDto,
  type AdminReplyDto,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

function AuthorStatusBadge({ status }: { status?: string | null }) {
  const normalized = (status ?? "").trim().toUpperCase();
  if (!normalized || normalized === "ACTIVE") return null;
  if (normalized === "SUSPENDED") {
    return (
      <span className="ml-1.5 inline-flex shrink-0 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800">
        정지 (SUSPENDED)
      </span>
    );
  }
  if (normalized === "BANNED") {
    return (
      <span className="ml-1.5 inline-flex shrink-0 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-black text-[#F6465D]">
        영구정지 (BANNED)
      </span>
    );
  }
  if (normalized === "WITHDRAWN") {
    return (
      <span className="ml-1.5 inline-flex shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-500">
        탈퇴 (WITHDRAWN)
      </span>
    );
  }
  return (
    <span className="ml-1.5 inline-flex shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-600">
      {normalized}
    </span>
  );
}

export function AdminCommunity() {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const role = memberCtx?.snapshot.role;
  const generation = memberCtx?.snapshot.generation;
  const session = memberCtx?.session;
  const [subTab, setSubTab] = useState<"posts" | "replies">("posts");
  const [authorMode, setAuthorMode] = useState<"ALL" | "ACTIVE" | "WITHDRAWN">("ALL");
  const [reloadTick, setReloadTick] = useState(0);

  // 게시글 검색 입력
  const [titleInput, setTitleInput] = useState("");
  const [contentInput, setContentInput] = useState("");
  const [postAuthorInput, setPostAuthorInput] = useState("");
  const [appliedPostFilters, setAppliedPostFilters] = useState<{
    mode: "ALL" | "ACTIVE" | "WITHDRAWN";
    title: string;
    content: string;
    authorNickname: string;
  }>({
    mode: "ALL",
    title: "",
    content: "",
    authorNickname: "",
  });

  // 댓글 검색 입력
  const [replyPostTitleInput, setReplyPostTitleInput] = useState("");
  const [replyContentInput, setReplyContentInput] = useState("");
  const [replyAuthorInput, setReplyAuthorInput] = useState("");
  const [appliedReplyFilters, setAppliedReplyFilters] = useState<{
    mode: "ALL" | "ACTIVE" | "WITHDRAWN";
    postTitle: string;
    replyContent: string;
    authorNickname: string;
  }>({
    mode: "ALL",
    postTitle: "",
    replyContent: "",
    authorNickname: "",
  });

  // 게시글 목록 상태
  const [posts, setPosts] = useState<AdminPostDto[]>([]);
  const [postNextCursor, setPostNextCursor] = useState<number | null>(null);
  const [postHasNext, setPostHasNext] = useState(false);

  // 댓글 목록 상태
  const [replies, setReplies] = useState<AdminReplyDto[]>([]);
  const [replyNextCursor, setReplyNextCursor] = useState<number | null>(null);
  const [replyHasNext, setReplyHasNext] = useState(false);

  const [settledListKey, setSettledListKey] = useState<string | null>(null);
  const listQueryKey = `${generation ?? 0}:${subTab}:${reloadTick}:${JSON.stringify(subTab === "posts" ? appliedPostFilters : appliedReplyFilters)}`;
  const loadingList = phase === "ready" && role === "ADMIN" && settledListKey !== listQueryKey;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<{ text: string; requestId?: string } | null>(null);
  const [actionToast, setActionToast] = useState<{
    kind: "success" | "error";
    text: string;
    requestId?: string;
  } | null>(null);

  const [deletePostTarget, setDeletePostTarget] = useState<AdminPostDto | null>(null);
  const [deleteReplyTarget, setDeleteReplyTarget] = useState<AdminReplyDto | null>(null);
  const [modalError, setModalError] = useState<{ text: string; requestId?: string } | null>(null);
  const [restoringPostId, setRestoringPostId] = useState<number | null>(null);
  const [restoringReplyId, setRestoringReplyId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();
    if (subTab === "posts") {
      void session
        .authorized(
          cred =>
            fetchAdminCommunityPosts(
              cred.accessToken,
              appliedPostFilters.mode,
              {
                title: appliedPostFilters.title,
                content: appliedPostFilters.content,
                authorNickname: appliedPostFilters.authorNickname,
                size: 10,
              },
              { signal: controller.signal },
            ),
          true,
        )
        .then(res => {
          setLoadError(null);
          setSettledListKey(listQueryKey);
          setPosts(res.content);
          setPostNextCursor(res.nextCursorId);
          setPostHasNext(res.hasNext);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          setSettledListKey(listQueryKey);
          setLoadError({
            text: "게시글 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
            requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
          });
        });
    } else {
      void session
        .authorized(
          cred =>
            fetchAdminCommunityReplies(
              cred.accessToken,
              appliedReplyFilters.mode,
              {
                postTitle: appliedReplyFilters.postTitle,
                replyContent: appliedReplyFilters.replyContent,
                authorNickname: appliedReplyFilters.authorNickname,
                size: 10,
              },
              { signal: controller.signal },
            ),
          true,
        )
        .then(res => {
          setLoadError(null);
          setSettledListKey(listQueryKey);
          setReplies(res.content);
          setReplyNextCursor(res.nextCursorId);
          setReplyHasNext(res.hasNext);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          setSettledListKey(listQueryKey);
          setLoadError({
            text: "댓글 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
            requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
          });
        });
    }
    return () => controller.abort();
  }, [subTab, appliedPostFilters, appliedReplyFilters, reloadTick, phase, role, generation, session, listQueryKey]);

  const handleApplySearch = () => {
    if (subTab === "posts") {
      setAppliedPostFilters({
        mode: authorMode,
        title: titleInput.trim(),
        content: contentInput.trim(),
        authorNickname: postAuthorInput.trim(),
      });
    } else {
      setAppliedReplyFilters({
        mode: authorMode,
        postTitle: replyPostTitleInput.trim(),
        replyContent: replyContentInput.trim(),
        authorNickname: replyAuthorInput.trim(),
      });
    }
  };

  const handleResetSearch = () => {
    setAuthorMode("ALL");
    if (subTab === "posts") {
      setTitleInput("");
      setContentInput("");
      setPostAuthorInput("");
      setAppliedPostFilters({
        mode: "ALL",
        title: "",
        content: "",
        authorNickname: "",
      });
    } else {
      setReplyPostTitleInput("");
      setReplyContentInput("");
      setReplyAuthorInput("");
      setAppliedReplyFilters({
        mode: "ALL",
        postTitle: "",
        replyContent: "",
        authorNickname: "",
      });
    }
  };

  const handleLoadMorePosts = async () => {
    if (!postHasNext || postNextCursor == null || loadingMore) return;
    if (phase !== "ready" || !session) return;
    setLoadingMore(true);
    try {
      const res = await session.authorized(
        cred =>
          fetchAdminCommunityPosts(cred.accessToken, appliedPostFilters.mode, {
            title: appliedPostFilters.title,
            content: appliedPostFilters.content,
            authorNickname: appliedPostFilters.authorNickname,
            cursorId: postNextCursor,
            size: 10,
          }),
        true,
      );
      setPosts(prev => [...prev, ...res.content]);
      setPostNextCursor(res.nextCursorId);
      setPostHasNext(res.hasNext);
    } catch (error) {
      setActionToast({
        kind: "error",
        text: "추가 게시글 목록을 불러오지 못했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLoadMoreReplies = async () => {
    if (!replyHasNext || replyNextCursor == null || loadingMore) return;
    if (phase !== "ready" || !session) return;
    setLoadingMore(true);
    try {
      const res = await session.authorized(
        cred =>
          fetchAdminCommunityReplies(cred.accessToken, appliedReplyFilters.mode, {
            postTitle: appliedReplyFilters.postTitle,
            replyContent: appliedReplyFilters.replyContent,
            authorNickname: appliedReplyFilters.authorNickname,
            cursorId: replyNextCursor,
            size: 10,
          }),
        true,
      );
      setReplies(prev => [...prev, ...res.content]);
      setReplyNextCursor(res.nextCursorId);
      setReplyHasNext(res.hasNext);
    } catch (error) {
      setActionToast({
        kind: "error",
        text: "추가 댓글 목록을 불러오지 못했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleConfirmDeletePost = async () => {
    if (!deletePostTarget || deleting) return;
    if (phase !== "ready" || !session) {
      setModalError({ text: "관리자 인증 세션이 필요합니다." });
      return;
    }
    setDeleting(true);
    setModalError(null);
    try {
      const target = deletePostTarget;
      await session.authorized(cred =>
        deleteAdminCommunityPost(cred.accessToken, target.postId),
      );
      setActionToast({
        kind: "success",
        text: `게시글 #${target.postId} 삭제 처리가 완료되었습니다.`,
      });
      setDeletePostTarget(null);
      setReloadTick(prev => prev + 1);
    } catch (error) {
      setModalError({
        text: "게시글 삭제 처리에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleRestorePost = async (post: AdminPostDto) => {
    if (restoringPostId !== null) return;
    if (phase !== "ready" || !session) {
      setActionToast({ kind: "error", text: "관리자 인증 세션이 필요합니다." });
      return;
    }
    setRestoringPostId(post.postId);
    try {
      await session.authorized(cred =>
        restoreAdminCommunityPost(cred.accessToken, post.postId),
      );
      setActionToast({
        kind: "success",
        text: `게시글 #${post.postId} (${post.title}) 복구가 완료되었습니다.`,
      });
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast({ kind: "error", text: "게시글 복구 처리에 실패했습니다." });
    } finally {
      setRestoringPostId(null);
    }
  };

  const handleRestoreReply = async (reply: AdminReplyDto) => {
    if (restoringReplyId !== null) return;
    if (phase !== "ready" || !session) {
      setActionToast({ kind: "error", text: "관리자 인증 세션이 필요합니다." });
      return;
    }
    setRestoringReplyId(reply.replyId);
    try {
      await session.authorized(cred =>
        restoreAdminCommunityReply(cred.accessToken, reply.replyId),
      );
      setActionToast({
        kind: "success",
        text: `댓글 #${reply.replyId} 복구가 완료되었습니다.`,
      });
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast({ kind: "error", text: "댓글 복구 처리에 실패했습니다." });
    } finally {
      setRestoringReplyId(null);
    }
  };

  const handleConfirmDeleteReply = async () => {
    if (!deleteReplyTarget || deleting) return;
    if (phase !== "ready" || !session) {
      setModalError({ text: "관리자 인증 세션이 필요합니다." });
      return;
    }
    setDeleting(true);
    setModalError(null);
    try {
      const target = deleteReplyTarget;
      await session.authorized(cred =>
        deleteAdminCommunityReply(cred.accessToken, target.replyId),
      );
      setActionToast({
        kind: "success",
        text: `댓글 #${target.replyId} 삭제 처리가 완료되었습니다.`,
      });
      setDeleteReplyTarget(null);
      setReloadTick(prev => prev + 1);
    } catch (error) {
      setModalError({
        text: "댓글 삭제 처리에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminShell activeSection="community">
      <div className="space-y-8" data-admin-community-page="true">
        {/* 상단 타이틀 & 탭 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-black tracking-wide text-[#0058FF]">
              <V1IconComment className="h-4 w-4" />
              <span>COMMUNITY MODERATION</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              커뮤니티 관리
            </h1>
            <p className="text-sm font-medium text-gray-500">
              커뮤니티 게시글 및 댓글 현황을 조회하고 운영 정책 위반 게시물을 소프트 삭제 처리합니다.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="커뮤니티 관리 구분"
            className="inline-flex shrink-0 rounded-2xl bg-gray-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={subTab === "posts"}
              onClick={() => setSubTab("posts")}
              className={cn(
                "h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-black transition-colors",
                subTab === "posts"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900",
              )}
            >
              게시글 관리
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === "replies"}
              onClick={() => setSubTab("replies")}
              className={cn(
                "h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-black transition-colors",
                subTab === "replies"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900",
              )}
            >
              댓글 관리
            </button>
          </div>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-[#F6465D]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{loadError.text}</span>
              {loadError.requestId && <RequestIdChip requestId={loadError.requestId} />}
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReloadTick(t => t + 1);
              }}
              className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-white px-3 py-1 text-[11px] font-black text-[#F6465D] hover:bg-rose-100"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {actionToast ? (
          <div
            role={actionToast.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-bold",
              actionToast.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-blue-200 bg-blue-50/80 text-[#0058FF]",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {actionToast.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{actionToast.text}</span>
              {actionToast.requestId && <RequestIdChip requestId={actionToast.requestId} />}
            </div>
            <button
              type="button"
              onClick={() => setActionToast(null)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-black",
                actionToast.kind === "error"
                  ? "text-rose-700 hover:bg-rose-100"
                  : "text-blue-700 hover:bg-blue-100",
              )}
            >
              닫기
            </button>
          </div>
        ) : null}

        {/* 검색 및 필터 바 */}
        <form
          aria-label="커뮤니티 검색 필터"
          onSubmit={e => {
            e.preventDefault();
            handleApplySearch();
          }}
          className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5 text-xs font-bold text-gray-600">
              <span>작성자 상태</span>
              <select
                aria-label="작성자 상태 필터"
                value={authorMode}
                onChange={e =>
                  setAuthorMode(e.target.value as "ALL" | "ACTIVE" | "WITHDRAWN")
                }
                className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              >
                <option value="ALL">전체 작성자 (ALL)</option>
                <option value="ACTIVE">활동 작성자 (ACTIVE)</option>
                <option value="WITHDRAWN">탈퇴 작성자 (WITHDRAWN)</option>
              </select>
            </label>

            {subTab === "posts" ? (
              <>
                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>제목 검색</span>
                  <input
                    type="search"
                    value={titleInput}
                    onChange={e => setTitleInput(e.target.value)}
                    placeholder="게시글 제목"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>본문 검색</span>
                  <input
                    type="search"
                    value={contentInput}
                    onChange={e => setContentInput(e.target.value)}
                    placeholder="게시글 본문 키워드"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>작성자 닉네임</span>
                  <input
                    type="search"
                    value={postAuthorInput}
                    onChange={e => setPostAuthorInput(e.target.value)}
                    placeholder="작성자 닉네임"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>원글 제목</span>
                  <input
                    type="search"
                    value={replyPostTitleInput}
                    onChange={e => setReplyPostTitleInput(e.target.value)}
                    placeholder="원글 제목"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>댓글 내용</span>
                  <input
                    type="search"
                    value={replyContentInput}
                    onChange={e => setReplyContentInput(e.target.value)}
                    placeholder="댓글 내용 키워드"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>작성자 닉네임</span>
                  <input
                    type="search"
                    value={replyAuthorInput}
                    onChange={e => setReplyAuthorInput(e.target.value)}
                    placeholder="작성자 닉네임"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleResetSearch}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              초기화
            </button>
            <button
              type="submit"
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-[#0058FF] px-4 text-xs font-black text-white hover:bg-[#0047D1]"
            >
              조회하기
            </button>
          </div>
        </form>

        {/* 게시글 테이블 / 댓글 테이블 */}
        {subTab === "posts" ? (
          <section
            aria-label="게시글 목록"
            className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-[#F9FAFB] text-[11px] font-black uppercase tracking-wider text-gray-400">
                    <th className="px-4 py-3.5 whitespace-nowrap">글 번호</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">카테고리</th>
                    <th className="w-[260px] max-w-[260px] px-4 py-3.5 whitespace-nowrap">제목 · 본문 요약</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성자</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">반응 지표</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성일</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">삭제 여부</th>
                    <th className="px-4 py-3.5 text-right whitespace-nowrap">관리 액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loadingList && posts.length === 0 ? (
                    [1, 2, 3, 4].map(idx => (
                      <tr key={`post-sk-${idx}`}>
                        <td colSpan={8} className="px-4 py-3.5">
                          <div className="h-5 w-full animate-pulse rounded bg-gray-100" />
                        </td>
                      </tr>
                    ))
                  ) : posts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-12 text-center text-xs font-semibold text-gray-400"
                      >
                        조건에 맞는 게시글이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    posts.map(post => {
                      const isDeleted = post.deleteYn === "Y";
                      return (
                        <tr
                          key={post.postId}
                          className="transition-colors hover:bg-gray-50/70"
                        >
                          <td className="px-4 py-3.5 font-black tabular-nums text-gray-900 whitespace-nowrap">
                            #{post.postId}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="inline-flex shrink-0 whitespace-nowrap rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                              {post.category}
                            </span>
                          </td>
                          <td className="w-[260px] max-w-[260px] px-4 py-3.5">
                            <div className="truncate font-bold text-gray-900">{post.title}</div>
                            <div className="mt-0.5 truncate text-[11px] text-gray-500">
                              {post.content}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap">
                            <span className="font-bold">{post.authorNickname ?? "탈퇴회원"}</span>
                            <span className="ml-1 text-[11px] text-gray-400">
                              (#{post.authorId})
                            </span>
                            <AuthorStatusBadge status={post.authorStatus} />
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-[11px] text-gray-600 whitespace-nowrap">
                            <span>조회 {post.viewCount.toLocaleString("ko-KR")}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>좋아요 {post.likeCount}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>댓글 {post.replyCount}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span
                              className={cn(
                                post.reportCount > 0 ? "font-black text-rose-600" : "text-gray-500",
                              )}
                            >
                              신고 {post.reportCount}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-gray-500 whitespace-nowrap">
                            {formatAdminDateTime(post.createdAt)}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={cn(
                                "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                                isDeleted
                                  ? "bg-gray-100 text-gray-500"
                                  : "bg-emerald-50 text-bull",
                              )}
                            >
                              {isDeleted ? "삭제됨 (Y)" : "정상 (N)"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {!isDeleted ? (
                              <button
                                type="button"
                                onClick={() => setDeletePostTarget(post)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-black text-rose-600 transition-colors hover:bg-rose-100"
                              >
                                삭제
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={restoringPostId === post.postId}
                                onClick={() => void handleRestorePost(post)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-black text-[#0058FF] transition-colors hover:bg-blue-100 disabled:opacity-50"
                              >
                                {restoringPostId === post.postId ? "복구 중…" : "복구"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {postHasNext ? (
              <div className="border-t border-gray-100 bg-[#F9FAFB] px-4 py-3 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMorePosts()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-5 text-xs font-black text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? "불러오는 중..." : "더 보기"}
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section
            aria-label="댓글 목록"
            className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-[#F9FAFB] text-[11px] font-black uppercase tracking-wider text-gray-400">
                    <th className="px-4 py-3.5 whitespace-nowrap">댓글 번호</th>
                    <th className="w-[200px] max-w-[200px] px-4 py-3.5 whitespace-nowrap">원글</th>
                    <th className="w-[260px] max-w-[260px] px-4 py-3.5 whitespace-nowrap">댓글 내용</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성자</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">반응 지표</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성일</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">삭제 여부</th>
                    <th className="px-4 py-3.5 text-right whitespace-nowrap">관리 액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loadingList && replies.length === 0 ? (
                    [1, 2, 3, 4].map(idx => (
                      <tr key={`reply-sk-${idx}`}>
                        <td colSpan={8} className="px-4 py-3.5">
                          <div className="h-5 w-full animate-pulse rounded bg-gray-100" />
                        </td>
                      </tr>
                    ))
                  ) : replies.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-12 text-center text-xs font-semibold text-gray-400"
                      >
                        조건에 맞는 댓글이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    replies.map(reply => {
                      const isDeleted = reply.deleteYn === "Y";
                      return (
                        <tr
                          key={reply.replyId}
                          className="transition-colors hover:bg-gray-50/70"
                        >
                          <td className="px-4 py-3.5 font-black tabular-nums text-gray-900 whitespace-nowrap">
                            #{reply.replyId}
                          </td>
                          <td className="w-[200px] max-w-[200px] px-4 py-3.5">
                            <div className="truncate font-bold text-gray-800">
                              {reply.postTitle ?? "(제목 없음)"}
                            </div>
                            <div className="text-[11px] text-gray-400 whitespace-nowrap">글 #{reply.postId}</div>
                          </td>
                          <td className="w-[260px] max-w-[260px] px-4 py-3.5">
                            <div className="truncate text-gray-800">{reply.content}</div>
                          </td>
                          <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap">
                            <span className="font-bold">{reply.authorNickname ?? "탈퇴회원"}</span>
                            <span className="ml-1 text-[11px] text-gray-400">
                              (#{reply.authorId})
                            </span>
                            <AuthorStatusBadge status={reply.authorStatus} />
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-[11px] text-gray-600 whitespace-nowrap">
                            <span>좋아요 {reply.likeCount}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span
                              className={cn(
                                reply.reportCount > 0 ? "font-black text-rose-600" : "text-gray-500",
                              )}
                            >
                              신고 {reply.reportCount}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-gray-500 whitespace-nowrap">
                            {formatAdminDateTime(reply.createdAt)}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={cn(
                                "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                                isDeleted
                                  ? "bg-gray-100 text-gray-500"
                                  : "bg-emerald-50 text-emerald-600",
                              )}
                            >
                              {isDeleted ? "삭제됨 (Y)" : "정상 (N)"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {!isDeleted ? (
                              <button
                                type="button"
                                onClick={() => setDeleteReplyTarget(reply)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-black text-rose-600 transition-colors hover:bg-rose-100"
                              >
                                삭제
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={restoringReplyId === reply.replyId}
                                onClick={() => void handleRestoreReply(reply)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-black text-[#0058FF] transition-colors hover:bg-blue-100 disabled:opacity-50"
                              >
                                {restoringReplyId === reply.replyId ? "복구 중…" : "복구"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {replyHasNext ? (
              <div className="border-t border-gray-100 bg-[#F9FAFB] px-4 py-3 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMoreReplies()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-5 text-xs font-black text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? "불러오는 중..." : "더 보기"}
                </button>
              </div>
            ) : null}
          </section>
        )}

        {/* 게시글 삭제 확인 모달 */}
        <DimModal
          open={deletePostTarget !== null}
          onClose={() => {
            if (!deleting) {
              setModalError(null);
              setDeletePostTarget(null);
            }
          }}
          title="게시글 삭제 확인"
        >
          {deletePostTarget ? (
            <div className="space-y-4">
              {modalError ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{modalError.text}</span>
                    {modalError.requestId && <RequestIdChip requestId={modalError.requestId} />}
                  </div>
                </div>
              ) : null}
              <p className="text-xs leading-relaxed text-gray-600">
                게시글 <strong className="font-black text-gray-900">#{deletePostTarget.postId} ({deletePostTarget.title})</strong> 항목을 삭제 처리하시겠습니까?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setModalError(null);
                    setDeletePostTarget(null);
                  }}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleConfirmDeletePost()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? "삭제 중..." : "삭제 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>

        {/* 댓글 삭제 확인 모달 */}
        <DimModal
          open={deleteReplyTarget !== null}
          onClose={() => {
            if (!deleting) {
              setModalError(null);
              setDeleteReplyTarget(null);
            }
          }}
          title="댓글 삭제 확인"
        >
          {deleteReplyTarget ? (
            <div className="space-y-4">
              {modalError ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{modalError.text}</span>
                    {modalError.requestId && <RequestIdChip requestId={modalError.requestId} />}
                  </div>
                </div>
              ) : null}
              <p className="text-xs leading-relaxed text-gray-600">
                댓글 <strong className="font-black text-gray-900">#{deleteReplyTarget.replyId}</strong> 항목을 삭제 처리하시겠습니까?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setModalError(null);
                    setDeleteReplyTarget(null);
                  }}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleConfirmDeleteReply()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? "삭제 중..." : "삭제 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>
      </div>
    </AdminShell>
  );
}
