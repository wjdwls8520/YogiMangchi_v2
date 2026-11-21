import { ContentApiError, contentOrigin } from "../../member/api/client";
import { TradingApiError, tradingOrigin } from "../../trading/api/client";
import { resolveContentOrigin, resolveTradingOrigin } from "../../../lib/api-origins";
import { extractRequestId } from "../../../lib/request-id";
import {
  parseAdminSupportInquiryPage,
  parseSupportInquiry,
  type AdminSupportInquiryPage,
  type SupportInquiry,
  type SupportInquiryFilterStatus,
} from "../../member/api/support";

export class AdminApiError extends ContentApiError {
  constructor(status: number, code?: string, requestId?: string) {
    super(status, code, requestId);
    this.name = "AdminApiError";
  }
}

export const DEFAULT_CONTENT_API_BASE_URL = resolveContentOrigin();

export const DEFAULT_ADMIN_TRADING_API_BASE_URL = resolveTradingOrigin();

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
  suspendedAt: string | null;
  suspendedReason: string | null;
  oauthEmail: string | null;
  oauthProvider: string | null;
  oauthProviderUserId: string | null;
}

export interface AdminMembersPageResponse {
  totalCount: number;
  activeCount: number;
  suspendedCount: number;
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
  viewCount: number;
  deleteYn: string;
  createdAt: string | null;
  updatedAt: string | null;
  authorId: number;
  authorNickname: string | null;
  authorStatus?: string | null;
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
  authorStatus?: string | null;
}

export interface AdminRepliesPageResponse {
  content: AdminReplyDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export type AdminReportReasonFilter =
  | "ALL"
  | "SPAM"
  | "SEXUAL"
  | "ILLEGAL"
  | "YOUTH_HARMFUL"
  | "ABUSE"
  | "PRIVACY"
  | "INAPPROPRIATE"
  | "FRAUD"
  | "ETC"
  | "OTHER";

export type AdminReportStatusFilter = "ALL" | "PENDING" | "RESOLVED" | "DISMISSED";

export interface AdminReportDto {
  reportKey: string;
  targetType: "POST" | "COMMENT";
  targetId: number;
  postId: number;
  postTitle: string;
  targetContent: string;
  targetAuthorId: number;
  targetAuthorNickname: string | null;
  targetAuthorStatus?: string | null;
  targetDeleteYn: string;
  targetReportCount: number;
  reporterId: number;
  reporterNickname: string | null;
  reasonType: string;
  reportStatus: "PENDING" | "RESOLVED" | "DISMISSED" | string;
  resolvedAt: string | null;
  resolvedByMemberId: number | null;
  resolutionNote: string | null;
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
  pendingReportCount: number;
}

export interface OpsErrorEntry {
  occurredAt: string | null;
  status: number;
  code: string | null;
  method: string | null;
  uri: string | null;
  requestId: string | null;
  rootCause: string | null;
}

export interface ContentOpsSummary {
  generatedAt: string | null;
  db: { up: boolean; latencyMs: number };
  newsIngestion: {
    live: boolean;
    collectorEnabled: boolean;
    lastCollectedAt: string | null;
    consecutiveFailures: number;
  };
  outbox: {
    pendingWithdrawals: number;
    stuckWithdrawals: number;
    pendingProvisions: number;
    stuckProvisions: number;
    pendingS3Cleanup: number;
    failedS3Cleanup: number;
  };
  openSupportInquiries: number;
  activeSse: {
    newsSse: number;
    communitySse: number;
    notificationSse: number;
  };
  recentErrors: OpsErrorEntry[];
}

export interface TradingRiskHoldItem {
  holdId: number;
  accountId: number;
  tradingSymbolId: number | null;
  eventId: number | null;
  reason: string | null;
  heldAt: string | null;
}

export interface TradingWorkerMeasurements {
  committedWork: number;
  maxReceiveCommitMs: number;
  maxWorkDelayMs: number;
  failedWork: number;
  lockTimeouts: number;
  readyQueries: number;
  readyQueryNanos: number;
  maxReadyQueryNanos: number;
  selectedWork: number;
  admissionDeferrals: number;
}

export interface TradingOpsSummary {
  status: {
    engineStatus: string;
    marketClockStatus: string;
    clockSkewMs: number | null;
  };
  dependencies: {
    db: string;
    redis: string;
    binanceMarkWs: string;
    binanceOrderBookWs: string;
  };
  workerMeasurements: TradingWorkerMeasurements | null;
  riskHolds: {
    unresolvedCount: number;
    items: TradingRiskHoldItem[];
  };
  pendingRiskWork: {
    pendingCount: number;
    heldCount: number;
  };
  ledgerMismatches: number;
  activeWebSockets: {
    market: number;
    trading: number;
  };
  recentErrors: OpsErrorEntry[];
  capturedAt: string | null;
}

export interface TradingHoldReleaseResult {
  accountId: number;
  reconciliationStatus: string;
  failedChecks: string[];
  releasedCount: number;
  resolutionReference: string | null;
  checkedAt: string | null;
  released: boolean;
}

export interface AdminTradingSymbolDto {
  id: number;
  symbol: string;
  name: string;
  quoteAsset: string;
  displaySymbol: string;
  provider: string;
  providerSymbol: string;
  providerUnitMultiplier: number;
  status: "ACTIVE" | "HALTED" | "INACTIVE" | string;
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
  const base = contentOrigin(options.origin ?? resolveContentOrigin());
  const transport = options.transport ?? fetch;
  if (!path.startsWith("/api/v1/admin/") || path.includes("..") || path.includes("\\")) {
    throw new AdminApiError(400);
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
      let errBody: unknown;
      try {
        errBody = await response.json();
        const rec = asRecord(errBody);
        if (typeof rec.code === "string") code = rec.code;
      } catch {
        // Ignore non-JSON body on error
      }
      const requestId = extractRequestId(errBody, response);
      throw new AdminApiError(response.status, code, requestId);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new AdminApiError(422);
    }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof ContentApiError) throw error;
    throw new AdminApiError(0);
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
    suspendedAt: asNullableString(r.suspendedAt),
    suspendedReason: asNullableString(r.suspendedReason),
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
    viewCount: asNumber(r.viewCount),
    deleteYn: asString(r.deleteYn, "N"),
    createdAt: asNullableString(r.createdAt),
    updatedAt: asNullableString(r.updatedAt),
    authorId: asNumber(r.authorId),
    authorNickname: asNullableString(r.authorNickname),
    authorStatus: asNullableString(r.authorStatus),
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
    authorStatus: asNullableString(r.authorStatus),
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
    targetAuthorStatus: asNullableString(r.targetAuthorStatus),
    targetDeleteYn: asString(r.targetDeleteYn, "N"),
    targetReportCount: asNumber(r.targetReportCount),
    reporterId,
    reporterNickname: asNullableString(r.reporterNickname),
    reasonType: asString(r.reasonType, "SPAM"),
    reportStatus: asString(r.reportStatus, "PENDING"),
    resolvedAt: asNullableString(r.resolvedAt),
    resolvedByMemberId: asNullableNumber(r.resolvedByMemberId),
    resolutionNote: asNullableString(r.resolutionNote),
    createdAt: asNullableString(r.createdAt),
  };
}

export async function fetchAdminMembers(
  token: string,
  params: {
    status?: "ALL" | "ACTIVE" | "SUSPENDED" | "WITHDRAWN";
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
    suspendedCount: asNumber(r.suspendedCount),
    withdrawnCount: asNumber(r.withdrawnCount),
    content: asArray(r.content, parseAdminMember),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function suspendAdminMember(
  token: string,
  memberId: number,
  reason?: string,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/members/${memberId}/suspend`, {
    method: "POST",
    token,
    body: reason?.trim() ? { reason: reason.trim() } : {},
    ...options,
  });
}

export async function unsuspendAdminMember(
  token: string,
  memberId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/members/${memberId}/unsuspend`, {
    method: "POST",
    token,
    ...options,
  });
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

export async function restoreAdminCommunityPost(
  token: string,
  postId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/community/posts/${postId}/restore`, {
    method: "POST",
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

export async function restoreAdminCommunityReply(
  token: string,
  replyId: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/community/replies/${replyId}/restore`, {
    method: "POST",
    token,
    ...options,
  });
}

export async function fetchAdminReports(
  token: string,
  params: {
    targetType?: "ALL" | "POST" | "COMMENT";
    targetStatus?: "ALL" | "ACTIVE" | "DELETED";
    reasonType?: AdminReportReasonFilter;
    reportStatus?: AdminReportStatusFilter;
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
  if (params.reportStatus) {
    search.set("reportStatus", params.reportStatus);
  }
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
    pendingReportCount: asNumber(r.pendingReportCount),
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

function parseOpsErrorEntry(raw: unknown): OpsErrorEntry {
  const r = asRecord(raw);
  return {
    occurredAt: asNullableString(r.occurredAt),
    status: asNumber(r.status),
    code: asNullableString(r.code),
    method: asNullableString(r.method),
    uri: asNullableString(r.uri),
    requestId: asNullableString(r.requestId),
    rootCause: asNullableString(r.rootCause),
  };
}

export function parseContentOpsSummary(raw: unknown): ContentOpsSummary {
  const r = asRecord(raw);
  const db = asRecord(r.db);
  const news = asRecord(r.newsIngestion);
  const outbox = asRecord(r.outbox);
  const sse = asRecord(r.activeSse);
  return {
    generatedAt: asNullableString(r.generatedAt),
    db: {
      up: asBoolean(db.up, false),
      latencyMs: asNumber(db.latencyMs),
    },
    newsIngestion: {
      live: asBoolean(news.live, false),
      collectorEnabled: asBoolean(news.collectorEnabled, false),
      lastCollectedAt: asNullableString(news.lastCollectedAt),
      consecutiveFailures: asNumber(news.consecutiveFailures),
    },
    outbox: {
      pendingWithdrawals: asNumber(outbox.pendingWithdrawals),
      stuckWithdrawals: asNumber(outbox.stuckWithdrawals),
      pendingProvisions: asNumber(outbox.pendingProvisions),
      stuckProvisions: asNumber(outbox.stuckProvisions),
      pendingS3Cleanup: asNumber(outbox.pendingS3Cleanup),
      failedS3Cleanup: asNumber(outbox.failedS3Cleanup),
    },
    openSupportInquiries: asNumber(r.openSupportInquiries),
    activeSse: {
      newsSse: asNumber(sse.newsSse),
      communitySse: asNumber(sse.communitySse),
      notificationSse: asNumber(sse.notificationSse),
    },
    recentErrors: asArray(r.recentErrors, parseOpsErrorEntry),
  };
}

export function parseTradingOpsSummary(raw: unknown): TradingOpsSummary {
  const r = asRecord(raw);
  const st = asRecord(r.status);
  const deps = asRecord(r.dependencies);
  const holds = asRecord(r.riskHolds);
  const pending = asRecord(r.pendingRiskWork);
  const ws = asRecord(r.activeWebSockets);
  const rawWm =
    r.workerMeasurements && typeof r.workerMeasurements === "object" && !Array.isArray(r.workerMeasurements)
      ? (r.workerMeasurements as Record<string, unknown>)
      : null;

  return {
    status: {
      engineStatus: asString(st.engineStatus, "UNKNOWN"),
      marketClockStatus: asString(st.marketClockStatus, "UNKNOWN"),
      clockSkewMs: asNullableNumber(st.clockSkewMs),
    },
    dependencies: {
      db: asString(deps.db, "UNKNOWN"),
      redis: asString(deps.redis, "UNKNOWN"),
      binanceMarkWs: asString(deps.binanceMarkWs, "UNKNOWN"),
      binanceOrderBookWs: asString(deps.binanceOrderBookWs, "UNKNOWN"),
    },
    workerMeasurements: rawWm
      ? {
          committedWork: asNumber(rawWm.committedWork),
          maxReceiveCommitMs: asNumber(rawWm.maxReceiveCommitMs),
          maxWorkDelayMs: asNumber(rawWm.maxWorkDelayMs),
          failedWork: asNumber(rawWm.failedWork),
          lockTimeouts: asNumber(rawWm.lockTimeouts),
          readyQueries: asNumber(rawWm.readyQueries),
          readyQueryNanos: asNumber(rawWm.readyQueryNanos),
          maxReadyQueryNanos: asNumber(rawWm.maxReadyQueryNanos),
          selectedWork: asNumber(rawWm.selectedWork),
          admissionDeferrals: asNumber(rawWm.admissionDeferrals),
        }
      : null,
    riskHolds: {
      unresolvedCount: asNumber(holds.unresolvedCount),
      items: asArray(holds.items, item => {
        const row = asRecord(item);
        return {
          holdId: asNumber(row.holdId),
          accountId: asNumber(row.accountId),
          tradingSymbolId: asNullableNumber(row.tradingSymbolId),
          eventId: asNullableNumber(row.eventId),
          reason: asNullableString(row.reason),
          heldAt: asNullableString(row.heldAt),
        };
      }),
    },
    pendingRiskWork: {
      pendingCount: asNumber(pending.pendingCount),
      heldCount: asNumber(pending.heldCount),
    },
    ledgerMismatches: asNumber(r.ledgerMismatches),
    activeWebSockets: {
      market: asNumber(ws.market),
      trading: asNumber(ws.trading),
    },
    recentErrors: asArray(r.recentErrors, parseOpsErrorEntry),
    capturedAt: asNullableString(r.capturedAt),
  };
}

export function parseTradingHoldReleaseResult(raw: unknown): TradingHoldReleaseResult {
  const r = asRecord(raw);
  const reconciliationStatus = asString(r.reconciliationStatus, "UNKNOWN");
  return {
    accountId: asNumber(r.accountId),
    reconciliationStatus,
    failedChecks: Array.isArray(r.failedChecks)
      ? r.failedChecks.map(item => asString(item)).filter(Boolean)
      : [],
    releasedCount: asNumber(r.releasedCount),
    resolutionReference: asNullableString(r.resolutionReference),
    checkedAt: asNullableString(r.checkedAt),
    released: reconciliationStatus === "MATCHED",
  };
}

export async function fetchContentOpsSummary(
  token: string,
  options?: AdminRequestOptions,
): Promise<ContentOpsSummary> {
  const raw = await requestAdminJson("/api/v1/admin/ops/summary", {
    method: "GET",
    token,
    ...options,
  });
  return parseContentOpsSummary(raw);
}

export async function retryFailedS3Cleanup(
  token: string,
  options?: AdminRequestOptions,
): Promise<{ retriedCount: number }> {
  const raw = await requestAdminJson("/api/v1/admin/ops/s3-cleanup/retry-failed", {
    method: "POST",
    token,
    ...options,
  });
  const r = asRecord(raw);
  return { retriedCount: asNumber(r.retriedCount) };
}

export function parseAdminTradingSymbol(raw: unknown): AdminTradingSymbolDto {
  const r = asRecord(raw);
  const symbol = asString(r.symbol, "-");
  const quoteAsset = asString(r.quoteAsset, "USDT");
  return {
    id: asNumber(r.id),
    symbol,
    name: asString(r.name, symbol),
    quoteAsset,
    displaySymbol: asString(r.displaySymbol, `${symbol} / ${quoteAsset}`),
    provider: asString(r.provider, "BINANCE"),
    providerSymbol: asString(r.providerSymbol, `${symbol}${quoteAsset}`),
    providerUnitMultiplier: asNumber(r.providerUnitMultiplier, 1),
    status: asString(r.status, "INACTIVE").toUpperCase(),
  };
}

export async function fetchAdminTradingSymbols(
  token: string,
  options?: AdminRequestOptions,
): Promise<AdminTradingSymbolDto[]> {
  const base = tradingOrigin(options?.origin ?? resolveTradingOrigin());
  const transport = options?.transport ?? fetch;
  try {
    const response = await transport(`${base}/api/v1/trading/admin/symbols`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(options?.signal ? [options.signal] : []),
      ]),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let body: unknown;
      let code: string | undefined;
      try {
        body = await response.json();
        const rec = asRecord(body);
        if (typeof rec.code === "string") code = rec.code;
      } catch {
        // Ignore unreadable body
      }
      throw new TradingApiError(
        response.status,
        undefined,
        code,
        undefined,
        undefined,
        undefined,
        extractRequestId(body, response),
      );
    }
    return asArray(await response.json(), parseAdminTradingSymbol);
  } catch (error) {
    if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0);
  }
}

export async function updateAdminTradingSymbolStatus(
  token: string,
  symbolId: number,
  status: "ACTIVE" | "HALTED",
  options?: AdminRequestOptions,
): Promise<AdminTradingSymbolDto> {
  const base = tradingOrigin(options?.origin ?? resolveTradingOrigin());
  const transport = options?.transport ?? fetch;
  try {
    const response = await transport(`${base}/api/v1/trading/admin/symbols/${symbolId}/status`, {
      method: "PATCH",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(options?.signal ? [options.signal] : []),
      ]),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      let body: unknown;
      let code: string | undefined;
      try {
        body = await response.json();
        const rec = asRecord(body);
        if (typeof rec.code === "string") code = rec.code;
      } catch {
        // Ignore unreadable body
      }
      throw new TradingApiError(
        response.status,
        undefined,
        code,
        undefined,
        undefined,
        undefined,
        extractRequestId(body, response),
      );
    }
    return parseAdminTradingSymbol(await response.json());
  } catch (error) {
    if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0);
  }
}

export async function fetchTradingOpsSummary(
  token: string,
  options?: AdminRequestOptions,
): Promise<TradingOpsSummary> {
  const base = tradingOrigin(options?.origin ?? resolveTradingOrigin());
  const transport = options?.transport ?? fetch;
  try {
    const response = await transport(`${base}/api/v1/trading/admin/ops/summary`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(options?.signal ? [options.signal] : []),
      ]),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let body: unknown;
      let code: string | undefined;
      try {
        body = await response.json();
        const rec = asRecord(body);
        if (typeof rec.code === "string") code = rec.code;
      } catch {
        // Ignore unreadable body
      }
      throw new TradingApiError(
        response.status,
        undefined,
        code,
        undefined,
        undefined,
        undefined,
        extractRequestId(body, response),
      );
    }
    return parseTradingOpsSummary(await response.json());
  } catch (error) {
    if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0);
  }
}

export async function releaseTradingRiskHold(
  token: string,
  accountId: number,
  reference?: string,
  options?: AdminRequestOptions,
): Promise<TradingHoldReleaseResult> {
  const base = tradingOrigin(options?.origin ?? resolveTradingOrigin());
  const transport = options?.transport ?? fetch;
  try {
    const body = reference?.trim() ? { reference: reference.trim() } : {};
    const response = await transport(
      `${base}/api/v1/trading/admin/ops/holds/${accountId}/release`,
      {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(10_000),
          ...(options?.signal ? [options.signal] : []),
        ]),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    // Both 200 OK (MATCHED) and 409 Conflict (MISMATCH/UNVERIFIED) carry structured HoldReleaseResult
    if (response.ok || response.status === 409) {
      return parseTradingHoldReleaseResult(await response.json());
    }
    let errBody: unknown;
    let code: string | undefined;
    try {
      errBody = await response.json();
      const rec = asRecord(errBody);
      if (typeof rec.code === "string") code = rec.code;
    } catch {
      // Ignore unreadable body
    }
    throw new TradingApiError(
      response.status,
      undefined,
      code,
      undefined,
      undefined,
      undefined,
      extractRequestId(errBody, response),
    );
  } catch (error) {
    if (options?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0);
  }
}

export async function fetchAdminSupportInquiries(
  token: string,
  params: {
    status?: SupportInquiryFilterStatus;
    category?: string;
    cursorId?: number | null;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminSupportInquiryPage> {
  const search = new URLSearchParams();
  search.set("status", params.status ?? "ALL");
  if (params.category?.trim()) search.set("category", params.category.trim());
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 20));
  const raw = await requestAdminJson(`/api/v1/admin/support/inquiries?${search.toString()}`, {
    method: "GET",
    token,
    ...options,
  });
  return parseAdminSupportInquiryPage(raw);
}

export async function replyAdminSupportInquiry(
  token: string,
  inquiryId: number,
  reply: string,
  options?: AdminRequestOptions,
): Promise<SupportInquiry> {
  const raw = await requestAdminJson(`/api/v1/admin/support/inquiries/${inquiryId}/reply`, {
    method: "POST",
    token,
    body: { reply },
    ...options,
  });
  return parseSupportInquiry(raw);
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const str = String(iso).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(str)) {
    const ms = Date.parse(str);
    if (Number.isFinite(ms)) {
      const kst = new Date(ms + 9 * 60 * 60 * 1000);
      const yyyy = kst.getUTCFullYear();
      const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(kst.getUTCDate()).padStart(2, "0");
      const hh = String(kst.getUTCHours()).padStart(2, "0");
      const min = String(kst.getUTCMinutes()).padStart(2, "0");
      return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
    }
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
}
