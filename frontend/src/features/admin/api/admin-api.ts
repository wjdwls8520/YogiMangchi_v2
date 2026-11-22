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
  bannedCount: number;
  withdrawnCount: number;
  content: AdminMemberDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface AdminBannedOAuthIdentityDto {
  id: number;
  provider: string;
  providerSubjectHash: string;
  originalMemberId: number | null;
  reason: string | null;
  bannedByAdminId: number | null;
  bannedByAdminNickname: string | null;
  bannedAt: string | null;
}

export interface AdminBannedOAuthPageResponse {
  totalCount: number;
  page: number;
  size: number;
  items: AdminBannedOAuthIdentityDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface ContentAdminAuditLogDto {
  id: number;
  adminMemberId: number;
  adminNickname: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  detailJson: string | null;
  requestId: string | null;
  createdAt: string | null;
}

export interface ContentAdminAuditLogPage {
  items: ContentAdminAuditLogDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface TradingAdminAuditLogDto {
  id: number;
  adminMemberId: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  requestId: string | null;
  createdAt: string | null;
}

export interface TradingAdminAuditLogPage {
  items: TradingAdminAuditLogDto[];
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
  topAppFrame?: string | null;
}

export interface OpsAlertDispatchEntry {
  key: string | null;
  severity: string | null;
  title: string | null;
  status: string | null;
  httpStatus: number | null;
  dispatchedAt: string | null;
  message: string | null;
}

export interface OpsAlertSummary {
  configured: boolean;
  targetType: string | null;
  cooldownSeconds: number;
  recentDispatches: OpsAlertDispatchEntry[];
}

export interface OpsErrorMetrics {
  last5m5xx: number;
  last1h5xx: number;
  total5xx: number;
  total429: number;
  total409: number;
  criticalErrors: OpsErrorEntry[];
  recentErrors: OpsErrorEntry[];
}

export interface ContentRssSourceStatus {
  name: string;
  section: string | null;
  subCategory: string | null;
  healthy: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastIngestedCount: number;
}

export interface ContentS3FailedTask {
  id: number;
  objectKey: string;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string | null;
}

export interface ContentOutboxStuckDetail {
  kind: string;
  id: number;
  target: string;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string | null;
}

export interface ClientErrorEntry {
  occurredAt: string | null;
  route: string | null;
  message: string;
  digest: string | null;
  requestId: string | null;
  userAgent: string | null;
}

export interface ContentOpsSummary {
  generatedAt: string | null;
  db: { up: boolean; latencyMs: number };
  dbLatencyMs: number;
  runtime: {
    heapUsedMb: number;
    heapMaxMb: number;
    heapUsagePct: number;
    uptimeSeconds: number;
    activeProfiles: string[];
  } | null;
  hikari: {
    active: number;
    idle: number;
    total: number;
    threadsAwaiting: number;
    maxPoolSize: number;
  } | null;
  newsIngestion: {
    live: boolean;
    collectorEnabled: boolean;
    lastCollectedAt: string | null;
    consecutiveFailures: number;
  };
  rssSources: ContentRssSourceStatus[];
  s3Storage: {
    mode: string;
    pendingCleanupCount: number;
    failedCleanupCount: number;
    recentFailedTasks: ContentS3FailedTask[];
  } | null;
  outbox: {
    pendingWithdrawals: number;
    stuckWithdrawals: number;
    pendingProvisions: number;
    stuckProvisions: number;
    pendingSuspensions: number;
    stuckSuspensions: number;
    pendingS3Cleanup: number;
    failedS3Cleanup: number;
    stuckDetails: ContentOutboxStuckDetail[];
  };
  openSupportInquiries: number;
  activeSse: {
    newsSse: number;
    communitySse: number;
    notificationSse: number;
  };
  alerts: OpsAlertSummary | null;
  errorMetrics: OpsErrorMetrics | null;
  recentErrors: OpsErrorEntry[];
  clientErrors: ClientErrorEntry[];
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

export interface TradingLedgerMismatchDetail {
  accountId: number;
  failedChecks: string[];
  checkedAt: string | null;
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
  ledgerMismatchDetails: TradingLedgerMismatchDetail[];
  lastReconciliationAt: string | null;
  activeWebSockets: {
    market: number;
    trading: number;
  };
  sse: {
    tradingNotificationSseCount: number;
  } | null;
  runtime: {
    heapUsedMb: number;
    heapMaxMb: number;
    heapUsagePercent: number;
    uptimeSeconds: number;
    activeThreads: number;
    buildVersion: string | null;
    buildTime: string | null;
  } | null;
  hikari: {
    active: number;
    idle: number;
    total: number;
    max: number;
    pending: number;
  } | null;
  dbLatencyMs: number | null;
  redis: {
    status: string;
    latencyMs: number | null;
    gapSequence: number | null;
  } | null;
  binance: {
    markState: string;
    markReconnectCount: number;
    markLastTickAgeMs: number | null;
    markLastDisconnectReason: string | null;
    orderBookConnected: boolean;
    orderBookReconnectCount: number;
    orderBookLastDisconnectReason: string | null;
  } | null;
  marketOverview: {
    healthy: boolean;
    staleGroupCount: number;
    lastError: string | null;
  } | null;
  errorMetrics: OpsErrorMetrics | null;
  alerts: OpsAlertSummary | null;
  criticalErrors: OpsErrorEntry[];
  recentErrors: OpsErrorEntry[];
  capturedAt: string | null;
}

export interface OpsOutboxRetryResult {
  rearmedWithdrawals: number;
  rearmedProvisions: number;
  rearmedSuspensions: number;
  rearmedS3Tasks: number;
  totalRearmed: number;
}

export interface OpsTestAlertResult {
  enabled: boolean;
  targetType: string | null;
  status: string;
  httpStatus: number | null;
  message: string | null;
  dispatchedAt: string | null;
}

export interface TradingReconcileNowResult {
  checkedCount: number;
  matchedCount: number;
  mismatchCount: number;
  unverifiedCount: number;
  deferredCount: number;
  mismatches: TradingLedgerMismatchDetail[];
  completedAt: string | null;
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
    status?: "ALL" | "ACTIVE" | "SUSPENDED" | "BANNED" | "WITHDRAWN";
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
    bannedCount: asNumber(r.bannedCount),
    withdrawnCount: asNumber(r.withdrawnCount),
    content: asArray(r.content, parseAdminMember),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export function parseAdminBannedOAuthPage(raw: unknown): AdminBannedOAuthPageResponse {
  const r = asRecord(raw);
  return {
    totalCount: asNumber(r.totalCount),
    page: asNumber(r.page),
    size: asNumber(r.size, 20),
    items: asArray(r.items, item => {
      const row = asRecord(item);
      return {
        id: asNumber(row.id),
        provider: asString(row.provider, "-"),
        providerSubjectHash: asString(row.providerSubjectHash, "-"),
        originalMemberId: asNullableNumber(row.originalMemberId),
        reason: asNullableString(row.reason),
        bannedByAdminId: asNullableNumber(row.bannedByAdminId),
        bannedByAdminNickname: asNullableString(row.bannedByAdminNickname),
        bannedAt: asNullableString(row.bannedAt),
      };
    }),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function fetchAdminBannedOAuthIdentities(
  token: string,
  params: {
    provider?: "ALL" | "GOOGLE" | "KAKAO";
    keyword?: string;
    cursorId?: number | null;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminBannedOAuthPageResponse> {
  const search = new URLSearchParams();
  if (params.provider && params.provider !== "ALL") search.set("provider", params.provider);
  if (params.keyword?.trim()) search.set("keyword", params.keyword.trim());
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 20));
  const raw = await requestAdminJson(`/api/v1/admin/banned-oauth-identities?${search.toString()}`, {
    method: "GET",
    token,
    ...options,
  });
  return parseAdminBannedOAuthPage(raw);
}

export async function unbanAdminOAuthIdentity(
  token: string,
  id: number,
  options?: AdminRequestOptions,
): Promise<void> {
  await requestAdminJson(`/api/v1/admin/banned-oauth-identities/${id}`, {
    method: "DELETE",
    token,
    ...options,
  });
}

export function parseContentAdminAuditLogs(raw: unknown): ContentAdminAuditLogPage {
  const r = asRecord(raw);
  return {
    items: asArray(r.items, item => {
      const row = asRecord(item);
      return {
        id: asNumber(row.id),
        adminMemberId: asNumber(row.adminMemberId),
        adminNickname: asNullableString(row.adminNickname),
        action: asString(row.action, "-"),
        targetType: asNullableString(row.targetType),
        targetId: asNullableString(row.targetId),
        summary: asNullableString(row.summary),
        detailJson: asNullableString(row.detailJson),
        requestId: asNullableString(row.requestId),
        createdAt: asNullableString(row.createdAt),
      };
    }),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function fetchContentAdminAuditLogs(
  token: string,
  params: {
    cursorId?: number | null;
    size?: number;
    action?: string;
    adminMemberId?: number | null;
  } = {},
  options?: AdminRequestOptions,
): Promise<ContentAdminAuditLogPage> {
  const search = new URLSearchParams();
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 20));
  if (params.action?.trim()) search.set("action", params.action.trim());
  if (params.adminMemberId != null && Number.isFinite(params.adminMemberId)) {
    search.set("adminMemberId", String(params.adminMemberId));
  }
  const raw = await requestAdminJson(`/api/v1/admin/audit-logs?${search.toString()}`, {
    method: "GET",
    token,
    ...options,
  });
  return parseContentAdminAuditLogs(raw);
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
    topAppFrame: asNullableString(r.topAppFrame),
  };
}

function parseOpsAlertSummary(raw: unknown): OpsAlertSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = asRecord(raw);
  return {
    configured: asBoolean(r.configured, false),
    targetType: asNullableString(r.targetType),
    cooldownSeconds: asNumber(r.cooldownSeconds),
    recentDispatches: asArray(r.recentDispatches, item => {
      const row = asRecord(item);
      return {
        key: asNullableString(row.key),
        severity: asNullableString(row.severity),
        title: asNullableString(row.title),
        status: asNullableString(row.status),
        httpStatus: asNullableNumber(row.httpStatus),
        dispatchedAt: asNullableString(row.dispatchedAt),
        message: asNullableString(row.message),
      };
    }),
  };
}

function parseOpsErrorMetrics(raw: unknown): OpsErrorMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = asRecord(raw);
  return {
    last5m5xx: asNumber(r.last5m5xx),
    last1h5xx: asNumber(r.last1h5xx),
    total5xx: asNumber(r.total5xx),
    total429: asNumber(r.total429),
    total409: asNumber(r.total409),
    criticalErrors: asArray(r.criticalErrors, parseOpsErrorEntry),
    recentErrors: asArray(r.recentErrors, parseOpsErrorEntry),
  };
}

export function parseContentOpsSummary(raw: unknown): ContentOpsSummary {
  const r = asRecord(raw);
  const db = asRecord(r.db);
  const news = asRecord(r.newsIngestion);
  const outbox = asRecord(r.outbox);
  const sse = asRecord(r.activeSse);
  const rt =
    r.runtime && typeof r.runtime === "object" && !Array.isArray(r.runtime)
      ? asRecord(r.runtime)
      : null;
  const hik =
    r.hikari && typeof r.hikari === "object" && !Array.isArray(r.hikari)
      ? asRecord(r.hikari)
      : null;
  const s3 =
    r.s3Storage && typeof r.s3Storage === "object" && !Array.isArray(r.s3Storage)
      ? asRecord(r.s3Storage)
      : null;
  return {
    generatedAt: asNullableString(r.generatedAt),
    db: {
      up: asBoolean(db.up, false),
      latencyMs: asNumber(db.latencyMs),
    },
    dbLatencyMs: asNumber(r.dbLatencyMs, asNumber(db.latencyMs)),
    runtime: rt
      ? {
          heapUsedMb: asNumber(rt.heapUsedMb),
          heapMaxMb: asNumber(rt.heapMaxMb),
          heapUsagePct: asNumber(rt.heapUsagePct ?? rt.heapUsagePercent),
          uptimeSeconds: asNumber(rt.uptimeSeconds),
          activeProfiles: Array.isArray(rt.activeProfiles)
            ? rt.activeProfiles.map(p => asString(p)).filter(Boolean)
            : [],
        }
      : null,
    hikari: hik
      ? {
          active: asNumber(hik.active),
          idle: asNumber(hik.idle),
          total: asNumber(hik.total),
          threadsAwaiting: asNumber(hik.threadsAwaiting ?? hik.pending),
          maxPoolSize: asNumber(hik.maxPoolSize ?? hik.max),
        }
      : null,
    newsIngestion: {
      live: asBoolean(news.live, false),
      collectorEnabled: asBoolean(news.collectorEnabled, false),
      lastCollectedAt: asNullableString(news.lastCollectedAt),
      consecutiveFailures: asNumber(news.consecutiveFailures),
    },
    rssSources: asArray(r.rssSources, item => {
      const row = asRecord(item);
      return {
        name: asString(row.name, "-"),
        section: asNullableString(row.section),
        subCategory: asNullableString(row.subCategory),
        healthy: asBoolean(row.healthy, false),
        consecutiveFailures: asNumber(row.consecutiveFailures),
        lastSuccessAt: asNullableString(row.lastSuccessAt),
        lastFailureAt: asNullableString(row.lastFailureAt),
        lastError: asNullableString(row.lastError),
        lastIngestedCount: asNumber(row.lastIngestedCount),
      };
    }),
    s3Storage: s3
      ? {
          mode: asString(s3.mode, "UNKNOWN"),
          pendingCleanupCount: asNumber(s3.pendingCleanupCount),
          failedCleanupCount: asNumber(s3.failedCleanupCount),
          recentFailedTasks: asArray(s3.recentFailedTasks, item => {
            const row = asRecord(item);
            return {
              id: asNumber(row.id),
              objectKey: asString(row.objectKey, "-"),
              attemptCount: asNumber(row.attemptCount),
              lastError: asNullableString(row.lastError),
              updatedAt: asNullableString(row.updatedAt),
            };
          }),
        }
      : null,
    outbox: {
      pendingWithdrawals: asNumber(outbox.pendingWithdrawals),
      stuckWithdrawals: asNumber(outbox.stuckWithdrawals),
      pendingProvisions: asNumber(outbox.pendingProvisions),
      stuckProvisions: asNumber(outbox.stuckProvisions),
      pendingSuspensions: asNumber(outbox.pendingSuspensions),
      stuckSuspensions: asNumber(outbox.stuckSuspensions),
      pendingS3Cleanup: asNumber(outbox.pendingS3Cleanup),
      failedS3Cleanup: asNumber(outbox.failedS3Cleanup),
      stuckDetails: asArray(outbox.stuckDetails, item => {
        const row = asRecord(item);
        return {
          kind: asString(row.kind, "OUTBOX"),
          id: asNumber(row.id),
          target: asString(row.target, "-"),
          attemptCount: asNumber(row.attemptCount),
          lastError: asNullableString(row.lastError),
          updatedAt: asNullableString(row.updatedAt),
        };
      }),
    },
    openSupportInquiries: asNumber(r.openSupportInquiries),
    activeSse: {
      newsSse: asNumber(sse.newsSse),
      communitySse: asNumber(sse.communitySse),
      notificationSse: asNumber(sse.notificationSse),
    },
    alerts: parseOpsAlertSummary(r.alerts),
    errorMetrics: parseOpsErrorMetrics(r.errorMetrics),
    recentErrors: asArray(r.recentErrors, parseOpsErrorEntry),
    clientErrors: asArray(r.clientErrors, item => {
      const row = asRecord(item);
      return {
        occurredAt: asNullableString(row.occurredAt),
        route: asNullableString(row.route),
        message: asString(row.message, "-"),
        digest: asNullableString(row.digest),
        requestId: asNullableString(row.requestId),
        userAgent: asNullableString(row.userAgent),
      };
    }),
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
  const rt =
    r.runtime && typeof r.runtime === "object" && !Array.isArray(r.runtime)
      ? asRecord(r.runtime)
      : null;
  const hik =
    r.hikari && typeof r.hikari === "object" && !Array.isArray(r.hikari)
      ? asRecord(r.hikari)
      : null;
  const red =
    r.redis && typeof r.redis === "object" && !Array.isArray(r.redis)
      ? asRecord(r.redis)
      : null;
  const bin =
    r.binance && typeof r.binance === "object" && !Array.isArray(r.binance)
      ? asRecord(r.binance)
      : null;
  const sseObj =
    r.sse && typeof r.sse === "object" && !Array.isArray(r.sse)
      ? asRecord(r.sse)
      : null;
  const mo =
    r.marketOverview && typeof r.marketOverview === "object" && !Array.isArray(r.marketOverview)
      ? asRecord(r.marketOverview)
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
    ledgerMismatchDetails: asArray(r.ledgerMismatchDetails, item => {
      const row = asRecord(item);
      return {
        accountId: asNumber(row.accountId),
        failedChecks: Array.isArray(row.failedChecks)
          ? row.failedChecks.map(c => asString(c)).filter(Boolean)
          : [],
        checkedAt: asNullableString(row.checkedAt),
      };
    }),
    lastReconciliationAt: asNullableString(r.lastReconciliationAt),
    activeWebSockets: {
      market: asNumber(ws.market),
      trading: asNumber(ws.trading),
    },
    sse: sseObj
      ? {
          tradingNotificationSseCount: asNumber(sseObj.tradingNotificationSseCount),
        }
      : null,
    runtime: rt
      ? {
          heapUsedMb: asNumber(rt.heapUsedMb),
          heapMaxMb: asNumber(rt.heapMaxMb),
          heapUsagePercent: asNumber(rt.heapUsagePercent ?? rt.heapUsagePct),
          uptimeSeconds: asNumber(rt.uptimeSeconds),
          activeThreads: asNumber(rt.activeThreads),
          buildVersion: asNullableString(rt.buildVersion),
          buildTime: asNullableString(rt.buildTime),
        }
      : null,
    hikari: hik
      ? {
          active: asNumber(hik.active),
          idle: asNumber(hik.idle),
          total: asNumber(hik.total),
          max: asNumber(hik.max ?? hik.maxPoolSize),
          pending: asNumber(hik.pending ?? hik.threadsAwaiting),
        }
      : null,
    dbLatencyMs: asNullableNumber(r.dbLatencyMs),
    redis: red
      ? {
          status: asString(red.status, "UNKNOWN"),
          latencyMs: asNullableNumber(red.latencyMs),
          gapSequence: asNullableNumber(red.gapSequence),
        }
      : null,
    binance: bin
      ? {
          markState: asString(bin.markState, "UNKNOWN"),
          markReconnectCount: asNumber(bin.markReconnectCount),
          markLastTickAgeMs: asNullableNumber(bin.markLastTickAgeMs),
          markLastDisconnectReason: asNullableString(bin.markLastDisconnectReason),
          orderBookConnected: asBoolean(bin.orderBookConnected, false),
          orderBookReconnectCount: asNumber(bin.orderBookReconnectCount),
          orderBookLastDisconnectReason: asNullableString(bin.orderBookLastDisconnectReason),
        }
      : null,
    marketOverview: mo
      ? {
          healthy: asBoolean(mo.healthy, false),
          staleGroupCount: asNumber(mo.staleGroupCount),
          lastError: asNullableString(mo.lastError),
        }
      : null,
    errorMetrics: parseOpsErrorMetrics(r.errorMetrics),
    alerts: parseOpsAlertSummary(r.alerts),
    criticalErrors: asArray(r.criticalErrors, parseOpsErrorEntry),
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

export async function retryAdminContentOutbox(
  token: string,
  options?: AdminRequestOptions,
): Promise<OpsOutboxRetryResult> {
  const raw = await requestAdminJson("/api/v1/admin/ops/outbox/retry", {
    method: "POST",
    token,
    ...options,
  });
  const r = asRecord(raw);
  return {
    rearmedWithdrawals: asNumber(r.rearmedWithdrawals),
    rearmedProvisions: asNumber(r.rearmedProvisions),
    rearmedSuspensions: asNumber(r.rearmedSuspensions),
    rearmedS3Tasks: asNumber(r.rearmedS3Tasks),
    totalRearmed: asNumber(r.totalRearmed),
  };
}

function parseTestAlertResult(raw: unknown): OpsTestAlertResult {
  const r = asRecord(raw);
  return {
    enabled: asBoolean(r.enabled, false),
    targetType: asNullableString(r.targetType),
    status: asString(r.status, "UNKNOWN"),
    httpStatus: asNullableNumber(r.httpStatus),
    message: asNullableString(r.message),
    dispatchedAt: asNullableString(r.dispatchedAt),
  };
}

export async function sendContentTestAlert(
  token: string,
  options?: AdminRequestOptions,
): Promise<OpsTestAlertResult> {
  const raw = await requestAdminJson("/api/v1/admin/ops/test-alert", {
    method: "POST",
    token,
    ...options,
  });
  return parseTestAlertResult(raw);
}

async function requestTradingAdminJson(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token: string;
    body?: object;
  } & AdminRequestOptions,
): Promise<unknown> {
  const base = tradingOrigin(options.origin ?? resolveTradingOrigin());
  const transport = options.transport ?? fetch;
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
      let body: unknown;
      let code: string | undefined;
      try {
        body = await response.json();
        const rec = asRecord(body);
        if (typeof rec.code === "string") code = rec.code;
      } catch {
        // Ignore non-JSON error body
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
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0);
  }
}

export async function sendTradingTestAlert(
  token: string,
  options?: AdminRequestOptions,
): Promise<OpsTestAlertResult> {
  const raw = await requestTradingAdminJson("/api/v1/trading/admin/ops/test-alert", {
    method: "POST",
    token,
    ...options,
  });
  return parseTestAlertResult(raw);
}

export async function reconcileTradingLedgerNow(
  token: string,
  body?: { accountId?: number; limit?: number },
  options?: AdminRequestOptions,
): Promise<TradingReconcileNowResult> {
  const raw = await requestTradingAdminJson("/api/v1/trading/admin/ops/reconcile-now", {
    method: "POST",
    token,
    body: body ?? {},
    ...options,
  });
  const r = asRecord(raw);
  return {
    checkedCount: asNumber(r.checkedCount),
    matchedCount: asNumber(r.matchedCount),
    mismatchCount: asNumber(r.mismatchCount),
    unverifiedCount: asNumber(r.unverifiedCount),
    deferredCount: asNumber(r.deferredCount),
    mismatches: asArray(r.mismatches, item => {
      const row = asRecord(item);
      return {
        accountId: asNumber(row.accountId),
        failedChecks: Array.isArray(row.failedChecks)
          ? row.failedChecks.map(c => asString(c)).filter(Boolean)
          : [],
        checkedAt: asNullableString(row.checkedAt),
      };
    }),
    completedAt: asNullableString(r.completedAt),
  };
}

export function parseTradingAdminAuditLogs(raw: unknown): TradingAdminAuditLogPage {
  const r = asRecord(raw);
  return {
    items: asArray(r.items, item => {
      const row = asRecord(item);
      return {
        id: asNumber(row.id),
        adminMemberId: asNumber(row.adminMemberId),
        action: asString(row.action, "-"),
        targetType: asNullableString(row.targetType),
        targetId: asNullableString(row.targetId),
        detail: asNullableString(row.detail),
        requestId: asNullableString(row.requestId),
        createdAt: asNullableString(row.createdAt),
      };
    }),
    nextCursorId: asNullableNumber(r.nextCursorId),
    hasNext: asBoolean(r.hasNext),
  };
}

export async function fetchTradingAdminAuditLogs(
  token: string,
  params: { cursorId?: number | null; size?: number } = {},
  options?: AdminRequestOptions,
): Promise<TradingAdminAuditLogPage> {
  const search = new URLSearchParams();
  if (params.cursorId != null && Number.isFinite(params.cursorId)) {
    search.set("cursorId", String(params.cursorId));
  }
  search.set("size", String(params.size ?? 20));
  const raw = await requestTradingAdminJson(
    `/api/v1/trading/admin/audit-logs?${search.toString()}`,
    {
      method: "GET",
      token,
      ...options,
    },
  );
  return parseTradingAdminAuditLogs(raw);
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
    keyword?: string;
    cursorId?: number | null;
    size?: number;
  } = {},
  options?: AdminRequestOptions,
): Promise<AdminSupportInquiryPage> {
  const search = new URLSearchParams();
  search.set("status", params.status ?? "ALL");
  if (params.category?.trim()) search.set("category", params.category.trim());
  if (params.keyword?.trim()) search.set("keyword", params.keyword.trim());
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
