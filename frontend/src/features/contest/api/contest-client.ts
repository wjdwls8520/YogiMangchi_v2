import { TradingApiError, tradingOrigin } from "../../trading/api/client";

export const DEFAULT_TRADING_API_BASE_URL =
  process.env.NEXT_PUBLIC_TRADING_SERVER_URL ??
  process.env.NEXT_PUBLIC_TRADING_API_BASE_URL ??
  "http://localhost:8081";

export function resolveTradingContestBaseUrl(): string {
  return tradingOrigin(DEFAULT_TRADING_API_BASE_URL);
}

export interface ContestSeasonView {
  id: number;
  title: string;
  description: string;
  seedMoney: string;
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  contestStartAt: string;
  contestEndAt: string;
  isPublic: boolean;
  isCanceled: boolean;
  settledAt: string | null;
  displayStatus: string;
  statusLabel: string;
  participantCount: number;
  applicantCount: number;
  pendingOrderCount: number;
  openPositionCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PublicSeasonsOverviewResponse {
  recruiting: ContestSeasonView[];
  running: ContestSeasonView[];
  finished: ContestSeasonView[];
  seasons: ContestSeasonView[];
}

export interface ContestLeaderboardEntryDto {
  rank: number;
  participantId: number;
  memberId: number;
  nickname: string;
  accountId: number;
  seedMoney: string;
  totalEquity: string;
  balance: string;
  realizedPnl: string;
  unrealizedPnl: string;
  roiPct: string;
  openPositionCount: number;
  tradeCount?: number;
  winRate?: string;
  settled: boolean;
  settledAt: string | null;
}

export interface LeaderboardPageResponse {
  season: ContestSeasonView;
  items: ContestLeaderboardEntryDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface MemberContestParticipationView {
  seasonId: number;
  title: string;
  description: string;
  displayStatus: string;
  statusLabel: string;
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  contestStartAt: string;
  contestEndAt: string;
  settledAt: string | null;
  participantId: number;
  memberId: number;
  nickname: string;
  accountId: number;
  seedMoney: string;
  balance: string;
  availableBalance: string;
  usedMargin: string;
  reservedMargin: string;
  totalEquity: string;
  realizedPnl: string;
  unrealizedPnl: string;
  totalPnl: string;
  roiPct: string;
  rank: number | null;
  totalParticipants: number;
  openPositionCount: number;
  pendingOrderCount: number;
  tradeCount?: number;
  winRate?: string;
}

export interface MemberContestSeasonsResponse {
  memberId: number;
  activeSeason: MemberContestParticipationView | null;
  participatingSeasons: MemberContestParticipationView[];
  pastSeasons: MemberContestParticipationView[];
}

export interface RecruitingSeasonForMemberView {
  season: ContestSeasonView;
  applied: boolean;
  applicationStatus: string | null;
  applicationId: number | null;
  rejectReason: string | null;
}

export interface ContestApplicationView {
  applicationId: number;
  seasonId: number;
  seasonTitle: string;
  seasonDescription?: string;
  seedMoney?: string;
  recruitmentStartAt?: string;
  recruitmentEndAt?: string;
  seasonDisplayStatus: string;
  contestStartAt: string;
  contestEndAt: string;
  memberId: number;
  nickname: string;
  status: string;
  rejectReason: string | null;
  appliedAt: string;
  processedAt: string | null;
  processedByMemberId: number | null;
}

export interface MyContestOverviewResponse {
  participatingSeasons: MemberContestParticipationView[];
  recruitingSeasons: RecruitingSeasonForMemberView[];
  pendingApplications: ContestApplicationView[];
  rejectedApplications: ContestApplicationView[];
}

export interface ContestSeasonSummaryResponse {
  season: ContestSeasonView;
  participation: MemberContestParticipationView;
  accountSummary: Record<string, unknown> | null;
}

export interface AdminSeasonUpsertRequest {
  title: string;
  description: string;
  seedMoney: string;
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  contestStartAt: string;
  contestEndAt: string;
  isPublic: boolean;
}

export interface AdminSeasonStatusPatchRequest {
  isPublic?: boolean;
  isCanceled?: boolean;
}

export interface AdminSeasonListResponse {
  totalCount: number;
  recruitingCount: number;
  liveCount: number;
  finishedCount: number;
  items: ContestSeasonView[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface AdminParticipantView {
  participantId: number;
  seasonId: number;
  memberId: number;
  nickname: string;
  accountId: number;
  accountStatus: string;
  seedMoney: string;
  balance: string;
  usedMargin: string;
  reservedMargin: string;
  totalEquity: string;
  realizedPnl: string;
  unrealizedPnl: string;
  roiPct: string;
  rank: number | null;
  openPositionCount: number;
  pendingOrderCount: number;
  tradeCount?: number;
  winRate?: string;
  appliedAt: string;
  approvedAt: string;
  settledAt: string | null;
}

export interface SettlementRunView {
  id: number;
  seasonId: number;
  attemptNo: number;
  triggeredBy: string;
  status: string;
  lastCompletedPhase: string;
  deactivatedWalletCount: number;
  canceledOrderCount: number;
  liquidatedPositionCount: number;
  finalizedParticipantCount: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminSeasonDetailResponse {
  season: ContestSeasonView;
  pendingOrderCount: number;
  openPositionCount: number;
  settlementRuns: SettlementRunView[];
  applicants: ContestApplicationView[];
  participants: AdminParticipantView[];
  rejectedApplicants: ContestApplicationView[];
}

export interface ContestSettlementResultResponse {
  runId: number;
  seasonId: number;
  attemptNo: number;
  triggeredBy: string;
  status: string;
  lastCompletedPhase: string;
  deactivatedWalletCount: number;
  canceledOrderCount: number;
  liquidatedPositionCount: number;
  finalizedParticipantCount: number;
  startedAt: string | null;
  completedAt: string | null;
  settledAt: string | null;
}

export interface ContestRequestOptions {
  baseUrl?: string;
  token?: string;
  signal?: AbortSignal;
  transport?: typeof fetch;
}

async function contestApiJson<T>(
  path: string,
  options: {
    baseUrl?: string;
    token?: string;
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: object;
    transport?: typeof fetch;
  } = {},
): Promise<T> {
  const origin = tradingOrigin(options.baseUrl ?? DEFAULT_TRADING_API_BASE_URL);
  const transport = options.transport ?? fetch;
  const signal = AbortSignal.any([
    AbortSignal.timeout(10_000),
    ...(options.signal ? [options.signal] : []),
  ]);

  try {
    const response = await transport(`${origin}/api/v1/trading/${path}`, {
      method: options.method ?? "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let code: string | undefined;
      try {
        const problem: unknown = await response.json();
        if (
          problem &&
          typeof problem === "object" &&
          !Array.isArray(problem) &&
          typeof (problem as Record<string, unknown>).code === "string"
        ) {
          code = (problem as Record<string, unknown>).code as string;
        }
      } catch {
        // Ignore unreadable problem body
      }
      throw new TradingApiError(response.status, undefined, code);
    }

    const text = await response.text();
    if (!text) return null as T;
    return JSON.parse(text) as T;
  } catch (error) {
    if (options.signal?.aborted) {
      throw new DOMException("Request cancelled", "AbortError");
    }
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0, "서버 연결을 확인한 뒤 다시 시도해 주세요.");
  }
}

// ============================================================================
// 1. 공개 API (Authorization 불필요)
// ============================================================================

export async function fetchPublicContestSeasons(
  options: ContestRequestOptions = {},
): Promise<PublicSeasonsOverviewResponse> {
  return contestApiJson<PublicSeasonsOverviewResponse>("contest/public/seasons", options);
}

export async function fetchPublicContestLeaderboard(
  seasonId: number,
  options: ContestRequestOptions & { cursorId?: number; size?: number } = {},
): Promise<LeaderboardPageResponse> {
  const params = new URLSearchParams();
  if (options.cursorId !== undefined) params.set("cursorId", String(options.cursorId));
  params.set("size", String(options.size ?? 20));
  return contestApiJson<LeaderboardPageResponse>(
    `contest/public/seasons/${seasonId}/leaderboard?${params.toString()}`,
    options,
  );
}

export async function fetchPublicMemberContestSeasons(
  memberId: number,
  options: ContestRequestOptions = {},
): Promise<MemberContestSeasonsResponse> {
  return contestApiJson<MemberContestSeasonsResponse>(
    `contest/public/members/${memberId}/seasons`,
    options,
  );
}

// ============================================================================
// 2. 로그인 회원 API (Bearer ${accessToken})
// ============================================================================

export async function fetchMyContestOverview(
  token: string,
  options: ContestRequestOptions = {},
): Promise<MyContestOverviewResponse> {
  return contestApiJson<MyContestOverviewResponse>("contest/me/overview", {
    ...options,
    token,
  });
}

export async function applyForContestSeason(
  seasonId: number,
  nickname: string,
  token: string,
  options: ContestRequestOptions = {},
): Promise<ContestApplicationView> {
  return contestApiJson<ContestApplicationView>(`contest/seasons/${seasonId}/applications`, {
    ...options,
    token,
    method: "POST",
    body: { nickname },
  });
}

export async function fetchMyLiveContestAccount(
  token: string,
  options: ContestRequestOptions = {},
): Promise<MemberContestParticipationView | null> {
  return contestApiJson<MemberContestParticipationView | null>("contest/account/live", {
    ...options,
    token,
  });
}

export async function fetchMyContestSeasons(
  token: string,
  options: ContestRequestOptions = {},
): Promise<MemberContestSeasonsResponse> {
  return contestApiJson<MemberContestSeasonsResponse>("contest/account/seasons", {
    ...options,
    token,
  });
}

export async function fetchContestSeasonSummary(
  seasonId: number,
  token: string,
  options: ContestRequestOptions = {},
): Promise<ContestSeasonSummaryResponse> {
  return contestApiJson<ContestSeasonSummaryResponse>(`contest/seasons/${seasonId}/summary`, {
    ...options,
    token,
  });
}

// ============================================================================
// 3. 관리자 대회 운영 API (Bearer ${accessToken}, ROLE_ADMIN)
// ============================================================================

export async function fetchAdminContestSeasons(
  options: ContestRequestOptions & { cursorId?: number; size?: number } = {},
): Promise<AdminSeasonListResponse> {
  const params = new URLSearchParams();
  if (options.cursorId !== undefined) params.set("cursorId", String(options.cursorId));
  params.set("size", String(options.size ?? 20));
  return contestApiJson<AdminSeasonListResponse>(
    `admin/contest/seasons?${params.toString()}`,
    options,
  );
}

export async function createAdminContestSeason(
  payload: AdminSeasonUpsertRequest,
  options: ContestRequestOptions = {},
): Promise<ContestSeasonView> {
  return contestApiJson<ContestSeasonView>("admin/contest/seasons", {
    ...options,
    method: "POST",
    body: payload,
  });
}

export async function updateAdminContestSeason(
  seasonId: number,
  payload: AdminSeasonUpsertRequest,
  options: ContestRequestOptions = {},
): Promise<ContestSeasonView> {
  return contestApiJson<ContestSeasonView>(`admin/contest/seasons/${seasonId}`, {
    ...options,
    method: "PUT",
    body: payload,
  });
}

export async function patchAdminContestSeasonStatus(
  seasonId: number,
  payload: AdminSeasonStatusPatchRequest,
  options: ContestRequestOptions = {},
): Promise<ContestSeasonView> {
  return contestApiJson<ContestSeasonView>(`admin/contest/seasons/${seasonId}/status`, {
    ...options,
    method: "PATCH",
    body: payload,
  });
}

export async function fetchAdminContestSeasonDetail(
  seasonId: number,
  options: ContestRequestOptions = {},
): Promise<AdminSeasonDetailResponse> {
  return contestApiJson<AdminSeasonDetailResponse>(
    `admin/contest/seasons/${seasonId}`,
    options,
  );
}

export async function approveAdminContestApplicant(
  seasonId: number,
  applicationId: number,
  options: ContestRequestOptions = {},
): Promise<AdminParticipantView> {
  return contestApiJson<AdminParticipantView>(
    `admin/contest/seasons/${seasonId}/applicants/${applicationId}/approve`,
    {
      ...options,
      method: "POST",
    },
  );
}

export async function bulkApproveAdminContestApplicants(
  seasonId: number,
  applicationIds: number[],
  options: ContestRequestOptions = {},
): Promise<AdminParticipantView[]> {
  return contestApiJson<AdminParticipantView[]>(
    `admin/contest/seasons/${seasonId}/applicants/bulk-approve`,
    {
      ...options,
      method: "POST",
      body: { applicationIds },
    },
  );
}

export async function rejectAdminContestApplicant(
  seasonId: number,
  applicationId: number,
  reason: string,
  options: ContestRequestOptions = {},
): Promise<ContestApplicationView> {
  return contestApiJson<ContestApplicationView>(
    `admin/contest/seasons/${seasonId}/applicants/${applicationId}/reject`,
    {
      ...options,
      method: "POST",
      body: { reason },
    },
  );
}

export async function settleAdminContestSeason(
  seasonId: number,
  options: ContestRequestOptions = {},
): Promise<ContestSettlementResultResponse> {
  return contestApiJson<ContestSettlementResultResponse>(
    `admin/contest/seasons/${seasonId}/settle`,
    {
      ...options,
      method: "POST",
    },
  );
}

export async function cleanupRemainingAdminContestSeason(
  seasonId: number,
  options: ContestRequestOptions = {},
): Promise<ContestSettlementResultResponse> {
  return contestApiJson<ContestSettlementResultResponse>(
    `admin/contest/seasons/${seasonId}/cleanup-remaining`,
    {
      ...options,
      method: "POST",
    },
  );
}

// ============================================================================
// Decimal-safe Formatting & Date Conversion Helpers
// ============================================================================

function formatDecimalThousands(raw: string, ensureTwoDecimals = true): string {
  const cleaned = String(raw ?? "0").replace(/,/g, "").replace(/\s*USDT$/i, "").trim();
  if (!cleaned) return ensureTwoDecimals ? "0.00" : "0";
  const sign = cleaned.startsWith("-") ? "-" : cleaned.startsWith("+") ? "+" : "";
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  const [intPartRaw = "0", fracPartRaw] = unsigned.split(".");
  const intFormatted = (intPartRaw || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fracPartRaw !== undefined) {
    const frac = ensureTwoDecimals
      ? fracPartRaw.padEnd(2, "0").slice(0, 2)
      : fracPartRaw;
    return `${sign}${intFormatted}${frac ? `.${frac}` : ""}`;
  }
  return ensureTwoDecimals ? `${sign}${intFormatted}.00` : `${sign}${intFormatted}`;
}

export function formatContestUsdt(raw: string, ensureTwoDecimals = true): string {
  return `${formatDecimalThousands(raw, ensureTwoDecimals)} USDT`;
}

export function formatContestSeedPlain(raw: string): string {
  return formatDecimalThousands(raw, false);
}

export function formatContestSignedUsdt(raw: string): string {
  const cleaned = String(raw ?? "0").replace(/,/g, "").replace(/\s*USDT$/i, "").trim();
  if (!cleaned || /^[-+]?0+(?:\.0+)?$/.test(cleaned)) {
    return "0.00 USDT";
  }
  const formatted = formatDecimalThousands(cleaned, true);
  if (formatted.startsWith("-") || formatted.startsWith("+")) {
    return `${formatted} USDT`;
  }
  return `+${formatted} USDT`;
}

export function formatContestSignedRoi(raw: string): string {
  const cleaned = String(raw ?? "0").replace(/%/g, "").trim();
  if (!cleaned || /^[-+]?0+(?:\.0+)?$/.test(cleaned)) {
    return "0.00%";
  }
  const formatted = formatDecimalThousands(cleaned, true);
  if (formatted.startsWith("-") || formatted.startsWith("+")) {
    return `${formatted}%`;
  }
  return `+${formatted}%`;
}

export function formatContestWinRate(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "0.0%";
  const cleaned = String(raw).replace(/%/g, "").trim();
  if (!cleaned) return "0.0%";
  const [intPartRaw = "0", fracPartRaw = "0"] = cleaned.replace(/^[+-]/, "").split(".");
  return `${intPartRaw || "0"}.${(fracPartRaw || "0").padEnd(1, "0").slice(0, 1)}%`;
}

export function isNonNegativeContestDecimal(raw: string): boolean {
  return !String(raw ?? "0").trim().startsWith("-");
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function extractKstParts(str: string): {
  yyyy: string;
  mm: string;
  dd: string;
  hh: string;
  min: string;
} | null {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(str)) {
    const ms = Date.parse(str);
    if (Number.isFinite(ms)) {
      const kst = new Date(ms + KST_OFFSET_MS);
      return {
        yyyy: String(kst.getUTCFullYear()),
        mm: String(kst.getUTCMonth() + 1).padStart(2, "0"),
        dd: String(kst.getUTCDate()).padStart(2, "0"),
        hh: String(kst.getUTCHours()).padStart(2, "0"),
        min: String(kst.getUTCMinutes()).padStart(2, "0"),
      };
    }
  }
  const match = /^(\d{4})[-.](\d{2})[-.](\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(str);
  if (match) {
    return {
      yyyy: match[1]!,
      mm: match[2]!,
      dd: match[3]!,
      hh: match[4] ?? "00",
      min: match[5] ?? "00",
    };
  }
  return null;
}

export function formatContestDateTime(isoOrText: string | null | undefined): string {
  if (!isoOrText) return "";
  const str = String(isoOrText).trim();
  const parts = extractKstParts(str);
  if (parts) {
    return `${parts.yyyy}.${parts.mm}.${parts.dd} ${parts.hh}:${parts.min}`;
  }
  return str.replace("T", " ").replace(/-/g, ".");
}

export function formatContestDateOnly(isoOrText: string | null | undefined): string {
  if (!isoOrText) return "";
  const str = String(isoOrText).trim();
  const parts = extractKstParts(str);
  if (parts) {
    return `${parts.yyyy}.${parts.mm}.${parts.dd}`;
  }
  return str;
}

export function toDatetimeLocalInput(isoOrText: string | null | undefined): string {
  if (!isoOrText) return "2026-12-01T00:00";
  const str = String(isoOrText).trim();
  const parts = extractKstParts(str);
  if (parts) {
    return `${parts.yyyy}-${parts.mm}-${parts.dd}T${parts.hh}:${parts.min}`;
  }
  return str;
}

export function toIsoInstantFromInput(localInput: string): string {
  const trimmed = String(localInput ?? "").trim();
  if (!trimmed) return new Date().toISOString();
  if (/Z$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}:00+09:00`);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : `${trimmed}:00+09:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}+09:00`);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : `${trimmed}+09:00`;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : `${trimmed}:00+09:00`;
}
