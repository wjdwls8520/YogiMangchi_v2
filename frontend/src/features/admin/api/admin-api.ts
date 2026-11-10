import { ContentApiError, contentOrigin } from "../../member/api/client";

export const DEFAULT_CONTENT_API_BASE_URL =
  process.env.NEXT_PUBLIC_CONTENT_API_BASE_URL ??
  process.env.NEXT_PUBLIC_CONTENT_SERVER_URL ??
  "http://localhost:8080";

export interface AdminRequestOptions {
  origin?: string;
  signal?: AbortSignal;
  transport?: typeof fetch;
}

export interface AdminMemberDto {
  memberId: number;
  nickname: string;
  profileImgUrl: string | null;
  role: string;
  deleteYn: string;
  status: string;
  createdAt: string | null;
  withdrawnAt: string | null;
  oauthEmail: string | null;
  oauthProvider: string | null;
  oauthProviderUserId: string | null;
}

export interface AdminMembersPageResponse {
  totalCount: number;
  activeCount: number;
  withdrawnCount: number;
  content: AdminMemberDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface AdminPostDto {
  postId: number;
  category: string;
  title: string;
  content: string;
  likeCount: number;
  replyCount: number;
  reportCount: number;
  deleteYn: string;
  createdAt: string | null;
  updatedAt: string | null;
  authorId: number;
  authorNickname: string | null;
}

export interface AdminPostsPageResponse {
  content: AdminPostDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface AdminReplyDto {
  replyId: number;
  content: string;
  likeCount: number;
  reportCount: number;
  deleteYn: string;
  createdAt: string | null;
  updatedAt: string | null;
  postId: number;
  postTitle: string | null;
  authorId: number;
  authorNickname: string | null;
}

export interface AdminRepliesPageResponse {
  content: AdminReplyDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface AdminReportDto {
  reportKey: string;
  targetType: "POST" | "COMMENT";
  targetId: number;
  postId: number;
  postTitle: string;
  targetContent: string;
  targetAuthorId: number;
  targetAuthorNickname: string | null;
  targetDeleteYn: string;
  targetReportCount: number;
  reporterId: number;
  reporterNickname: string | null;
  reasonType: string;
  createdAt: string | null;
}

export interface AdminReportsPageResponse {
  content: AdminReportDto[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasNext: boolean;
  postReportCount: number;
  commentReportCount: number;
  activeTargetReportCount: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = asString(value).trim();
  return s ? s : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = asNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asArray<T>(value: unknown, mapper: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(mapper);
}

async function requestAdminJson(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    token: string;
    body?: object;
  } & AdminRequestOptions,
): Promise<unknown> {
  const base = contentOrigin(options.origin ?? DEFAULT_CONTENT_API_BASE_URL);
  const transport = options.transport ?? fetch;
  if (!path.startsWith("/api/v1/admin/") || path.includes("..") || path.includes("\\")) {
    throw new ContentApiError(400);
  }
  try {
    const response = await transport(`${base}${path}`, {
      method: options.method ?? "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(options.signal ? [options.signal] : []),
      ]),
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let code: string | undefined;
      try {
        const errBody = asRecord(await response.json());
        if (typeof errBody.code === "string") code = errBody.code;
      } catch {
        // Ignore non-JSON body on error
      }
      throw new ContentApiError(response.status, code);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ContentApiError(422);
    }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof ContentApiError) throw error;
    throw new ContentApiError(0);
  }
}

function parseAdminMember(raw: unknown): AdminMemberDto {
  const r = asRecord(raw);
  return {
    memberId: asNumber(r.memberId),
    nickname: asString(r.nickname, "-"),
    profileImgUrl: asNullableString(r.profileImgUrl),
    role: asString(r.role, "MEMBER"),
    deleteYn: asString(r.deleteYn, "N"),
    status: asString(r.status, r.deleteYn === "Y" ? "WITHDRAWN" : "ACTIVE"),
    createdAt: asNullableString(r.createdAt),
    withdrawnAt: asNullableString(r.withdrawnAt),
    oauthEmail: asNullableString(r.oauthEmail),
    oauthProvider: asNullableString(r.oauthProvider),
    oauthProviderUserId: asNullableString(r.oauthProviderUserId),
  };
}

function parseAdminPost(raw: unknown): AdminPostDto {
  const r = asRecord(raw);
  return {
    postId: asNumber(r.postId),
    category: asString(r.category, "FREE"),
    title: asString(r.title),
    content: asString(r.content),
    likeCount: asNumber(r.likeCount),
    replyCount: asNumber(r.replyCount),
    reportCount: asNumber(r.reportCount),
    deleteYn: asString(r.deleteYn, "N"),
    createdAt: asNullableString(r.createdAt),
    updatedAt: asNullableString(r.updatedAt),
    authorId: asNumber(r.authorId),
    authorNickname: asNullableString(r.authorNickname),
  };
}

function parseAdminReply(raw: unknown): AdminReplyDto {
  const r = asRecord(raw);
  return {
    replyId: asNumber(r.replyId),
    content: asString(r.content),
    likeCount: asNumber(r.likeCount),
    reportCount: asNumber(r.reportCount),
    deleteYn: asString(r.deleteYn, "N"),
    createdAt: asNullableString(r.createdAt),
    updatedAt: asNullableString(r.updatedAt),
    postId: asNumber(r.postId),
    postTitle: asNullableString(r.postTitle),
    authorId: asNumber(r.authorId),
    authorNickname: asNullableString(r.authorNickname),
  };
}

function parseAdminReport(raw: unknown): AdminReportDto {
  const r = asRecord(raw);
  const rawType = asString(r.targetType, "POST").toUpperCase();
  const targetType: "POST" | "COMMENT" = rawType === "COMMENT" ? "COMMENT" : "POST";
  const targetId = asNumber(r.targetId);
  const reporterId = asNumber(r.reporterId);
  return {
    reportKey: asString(r.reportKey, `${targetType}:${targetId}:${reporterId}`),
    targetType,
    targetId,
    postId: asNumber(r.postId),
    postTitle: asString(r.postTitle),
    targetContent: asString(r.targetContent),
    targetAuthorId: asNumber(r.targetAuthorId),
    targetAuthorNickname: asNullableString(r.targetAuthorNickname),
    targetDeleteYn: asString(r.targetDeleteYn, "N"),
    targetReportCount: asNumber(r.targetReportCount),
    reporterId,
    reporterNickname: asNullableString(r.reporterNickname),
    reasonType: asString(r.reasonType, "SPAM"),
    createdAt: asNullableString(r.createdAt),
  };
}

export async function fetchAdminMembers(
  token: string,
  params: {
    status?: "ALL" | "ACTIVE" | "WITHDRAWN";
    role?: "ALL" | "ADMIN" | "MEMBER";
    memberId?: number | null;
    nickname?: string;
    cursorId?: number | null;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminMembersPageResponse> {
  const search = new URLSearchParams();
  search.set("status", params.status ?? "ALL");
  search.set("role", params.role ?? "ALL");
  if (params.memberId != null && Number.isFinite(params.memberId) && params.memberId > 0) {
    search.set("memberId", String(params.memberId));
  }
  if (params.nickname && params.nickname.trim()) {
    search.set("nickname", params.nickname.trim());
  }
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 10));

  const raw = await requestAdminJson(`/api/v1/admin/members?${search.toString()}`, {
    method: "GET",
    token,
    ...options,
  });
  const r = asRecord(raw);
  return {
    totalCount: asNumber(r.totalCount),
    activeCount: asNumber(r.activeCount),
    withdrawnCount: asNumber(r.withdrawnCount),
    content: asArray(r.content, parseAdminMember),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function withdrawAdminMember(
  token: string,
  memberId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/members/${memberId}`, {
    method: "DELETE",
    token,
    ...options,
  });
}

export async function fetchAdminCommunityPosts(
  token: string,
  mode: "ALL" | "ACTIVE" | "WITHDRAWN" = "ALL",
  params: {
    title?: string;
    content?: string;
    authorNickname?: string;
    cursorId?: number | null;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminPostsPageResponse> {
  const search = new URLSearchParams();
  if (mode === "ALL") {
    search.set("authorStatus", "ALL");
  }
  if (params.title && params.title.trim()) search.set("title", params.title.trim());
  if (params.content && params.content.trim()) search.set("content", params.content.trim());
  if (params.authorNickname && params.authorNickname.trim()) {
    search.set("authorNickname", params.authorNickname.trim());
  }
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 10));

  const endpoint =
    mode === "ACTIVE"
      ? "/api/v1/admin/community/posts/active-author"
      : mode === "WITHDRAWN"
        ? "/api/v1/admin/community/posts/withdrawn-author"
        : "/api/v1/admin/community/posts";

  const raw = await requestAdminJson(`${endpoint}?${search.toString()}`, {
    method: "GET",
    token,
    ...options,
  });
  const r = asRecord(raw);
  return {
    content: asArray(r.content, parseAdminPost),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function deleteAdminCommunityPost(
  token: string,
  postId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/community/posts/${postId}`, {
    method: "DELETE",
    token,
    ...options,
  });
}

export async function fetchAdminCommunityReplies(
  token: string,
  mode: "ALL" | "ACTIVE" | "WITHDRAWN" = "ALL",
  params: {
    postTitle?: string;
    postContent?: string;
    replyContent?: string;
    authorNickname?: string;
    cursorId?: number | null;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminRepliesPageResponse> {
  const search = new URLSearchParams();
  if (mode === "ALL") {
    search.set("authorStatus", "ALL");
  }
  if (params.postTitle && params.postTitle.trim()) {
    search.set("postTitle", params.postTitle.trim());
  }
  if (params.postContent && params.postContent.trim()) {
    search.set("postContent", params.postContent.trim());
  }
  if (params.replyContent && params.replyContent.trim()) {
    search.set("replyContent", params.replyContent.trim());
  }
  if (params.authorNickname && params.authorNickname.trim()) {
    search.set("authorNickname", params.authorNickname.trim());
  }
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 10));

  const endpoint =
    mode === "ACTIVE"
      ? "/api/v1/admin/community/replies/active-author"
      : mode === "WITHDRAWN"
        ? "/api/v1/admin/community/replies/withdrawn-author"
        : "/api/v1/admin/community/replies";

  const raw = await requestAdminJson(`${endpoint}?${search.toString()}`, {
    method: "GET",
    token,
    ...options,
  });
  const r = asRecord(raw);
  return {
    content: asArray(r.content, parseAdminReply),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function deleteAdminCommunityReply(
  token: string,
  replyId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/community/replies/${replyId}`, {
    method: "DELETE",
    token,
    ...options,
  });
}

export async function fetchAdminReports(
  token: string,
  params: {
    targetType?: "ALL" | "POST" | "COMMENT";
    targetStatus?: "ALL" | "ACTIVE" | "DELETED";
    reasonType?: "ALL" | "SPAM" | "ABUSE" | "FRAUD" | "INAPPROPRIATE" | "OTHER";
    keyword?: string;
    page?: number;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminReportsPageResponse> {
  const search = new URLSearchParams();
  search.set("targetType", params.targetType ?? "ALL");
  search.set("targetStatus", params.targetStatus ?? "ALL");
  search.set("reasonType", params.reasonType ?? "ALL");
  if (params.keyword && params.keyword.trim()) {
    search.set("keyword", params.keyword.trim());
  }
  search.set("page", String(params.page ?? 0));
  search.set("size", String(params.size ?? 20));

  const raw = await requestAdminJson(
    `/api/v1/admin/community/reports?${search.toString()}`,
    {
      method: "GET",
      token,
      ...options,
    },
  );
  const r = asRecord(raw);
  return {
    content: asArray(r.content, parseAdminReport),
    page: asNumber(r.page),
    size: asNumber(r.size, 20),
    totalElements: asNumber(r.totalElements),
    totalPages: asNumber(r.totalPages),
    hasNext: asBoolean(r.hasNext),
    postReportCount: asNumber(r.postReportCount),
    commentReportCount: asNumber(r.commentReportCount),
    activeTargetReportCount: asNumber(r.activeTargetReportCount),
  };
}

export async function dismissAdminReport(
  token: string,
  targetType: "POST" | "COMMENT",
  targetId: number,
  reporterId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(
    `/api/v1/admin/community/reports/${targetType}/${targetId}/reporters/${reporterId}`,
    {
      method: "DELETE",
      token,
      ...options,
    },
  );
}

export async function moderateAdminReportTarget(
  token: string,
  targetType: "POST" | "COMMENT",
  targetId: number,
  action: "DELETE_TARGET" | "CLEAR_REPORTS" = "DELETE_TARGET",
  options?: AdminRequestOptions,
): Promise<void> {
  const search = new URLSearchParams({ action });
  await requestAdminJson(
    `/api/v1/admin/community/reports/${targetType}/${targetId}/moderate?${search.toString()}`,
    {
      method: "POST",
      token,
      ...options,
    },
  );
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
}
