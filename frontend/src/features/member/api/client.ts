export class ContentApiError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("회원 요청을 처리하지 못했습니다."); this.name = "ContentApiError";
  }
}
const codes = new Set([
  "SERVICE_TEMPORARILY_UNAVAILABLE", "NICKNAME_ALREADY_EXISTS", "NICKNAME_UNAVAILABLE", "MEMBER_BUSY", "INVALID_REQUEST", "INVALID_PROFILE", "INVALID_NICKNAME",
  "AUTHENTICATION_REQUIRED", "INVALID_ACCESS_TOKEN", "ACCESS_DENIED", "MEMBER_NOT_ACTIVE", "WITHDRAWAL_CONFIRMATION_REQUIRED", "MEMBER_ALREADY_EXISTS",
  "POLICY_VERSION_OR_CONSENT_INVALID", "POLICY_VERSION_CHANGED", "REQUIRED_CONSENT_MISSING", "POLICY_VERSION_REQUIRED",
  "LOGIN_PROOF_REQUIRED", "LOGIN_PROOF_EXPIRED", "CSRF_INVALID", "PROFILE_MESSAGE_UPDATE_REQUIRED", "RESOURCE_ALREADY_EXISTS", "RESOURCE_NOT_FOUND",
  "FILE_VIDEO_NOT_ALLOWED", "FILE_TYPE_NOT_ALLOWED", "GIF_FILE_TOO_LARGE", "IMAGE_FILE_TOO_LARGE", "FILE_TOTAL_SIZE_EXCEEDED", "FILE_COUNT_EXCEEDED",
]);

export function contentRecovery(error: unknown): "policies" | "login" | "state" | "csrf" | null {
  if (!(error instanceof ContentApiError)) return null;
  if (["POLICY_VERSION_CHANGED", "POLICY_VERSION_REQUIRED", "REQUIRED_CONSENT_MISSING", "POLICY_VERSION_OR_CONSENT_INVALID"].includes(error.code ?? "")) return "policies";
  if (error.code === "LOGIN_PROOF_REQUIRED" || error.code === "LOGIN_PROOF_EXPIRED") return "login";
  if (error.code === "MEMBER_BUSY" || error.code === "MEMBER_ALREADY_EXISTS" || error.code === "RESOURCE_ALREADY_EXISTS") return "state";
  if (error.status === 0 || error.status === 422 || error.status >= 500) return "state";
  return error.code === "CSRF_INVALID" ? "csrf" : null;
}
export function contentOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new ContentApiError(400); }
}
export function oauthUrl(origin: string, provider: "google" | "kakao") {
  if (provider !== "google" && provider !== "kakao") throw new ContentApiError(400);
  return `${contentOrigin(origin)}/oauth2/authorization/${provider}`;
}
export async function contentJson(origin: string, path: string, options: {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; access?: string; csrf?: string; anonViewerId?: string; body?: object | FormData; signal?: AbortSignal;
} = {}, transport: typeof fetch = fetch): Promise<unknown> {
  if (!/^\/(?:auth\/(?:csrf|flow|signup|login\/complete|refresh|logout)|policies\/(?:current|(?:TERMS|PRIVACY)\/[A-Za-z0-9._-]+)|members(?:\/[^?#]*)?|news(?:\/(?:highlights|stream|[0-9]+(?:\/(?:reactions|views))?))?|community\/(?:posts(?:\/latest-check|\/[0-9]+(?:\/(?:likes|reports|comments(?:\/[0-9]+(?:\/(?:likes|reports))?)?))?)?|comments\/[0-9]+(?:\/(?:likes|reports))?|report-reasons|ux\/subscribe\/feed))(?:\?[^#]*)?$/.test(path)
    || path.includes("..") || path.includes("\\")) throw new ContentApiError(400);
  const cookie = path.startsWith("/auth/") || path === "/members/me/withdrawal";
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  try {
    const response = await transport(`${contentOrigin(origin)}/api/v1${path}`, {
      method: options.method ?? "GET", credentials: cookie ? "include" : "omit", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]),
      headers: {
        ...(options.access ? { Authorization: `Bearer ${options.access}` } : {}),
        ...(options.csrf ? { "X-CSRF-TOKEN": options.csrf } : {}),
        ...(options.anonViewerId ? { "X-Anon-Viewer-Id": options.anonViewerId } : {}),
        ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? (isFormData ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        const body: unknown = await response.json();
        const value = body && typeof body === "object" ? (body as Record<string, unknown>).code : undefined;
        if (typeof value === "string" && codes.has(value)) code = value;
      } catch { /* Preserve the HTTP status when an error body is unreadable. */ }
      throw new ContentApiError(response.status, code);
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new ContentApiError(422); }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof ContentApiError) throw error;
    throw new ContentApiError(0);
  }
}
export function contentMessage(error: unknown) {
  if (!(error instanceof ContentApiError)) return "요청을 처리하지 못했습니다. 다시 확인해 주세요.";
  if (error.code === "POLICY_VERSION_CHANGED") return "정책 버전이 변경되었습니다. 최신 원문을 다시 확인하고 직접 동의해 주세요.";
  if (error.code === "POLICY_VERSION_REQUIRED") return "동의할 정책 버전을 확인하지 못했습니다. 최신 원문을 다시 조회해 주세요.";
  if (error.code === "REQUIRED_CONSENT_MISSING") return "필수 정책 동의가 누락되었습니다. 원문과 동의 항목을 확인해 주세요.";
  if (error.code === "LOGIN_PROOF_REQUIRED" || error.code === "LOGIN_PROOF_EXPIRED") return "소셜 본인 확인이 없거나 만료되었습니다. Google 또는 Kakao로 다시 확인해 주세요.";
  if (error.code === "CSRF_INVALID") return "요청 보안 확인에 실패했습니다. 현재 상태를 조회한 뒤 화면에서 다시 시도해 주세요.";
  if (error.code === "MEMBER_BUSY") return "회원 정보를 처리 중입니다. 요청을 반복하지 말고 현재 상태를 먼저 확인해 주세요.";
  if (error.code === "NICKNAME_UNAVAILABLE" || error.code === "NICKNAME_ALREADY_EXISTS") return "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.";
  if (error.code === "INVALID_NICKNAME") return "닉네임은 공백·특수문자 없이 1~8자로 입력해 주세요.";
  if (error.code === "PROFILE_MESSAGE_UPDATE_REQUIRED") return "기존 소개가 현재 입력 한도를 초과합니다. 소개를 255자 이내로 수정해 주세요.";
  if (error.code === "MEMBER_ALREADY_EXISTS") return "이미 가입된 소셜 계정입니다. 현재 로그인 상태를 확인해 주세요.";
  if (error.code === "RESOURCE_ALREADY_EXISTS") return "이미 처리된 정보와 요청이 충돌했습니다. 현재 상태를 먼저 확인해 주세요.";
  if (error.code === "RESOURCE_NOT_FOUND") return "요청한 게시글·댓글·뉴스 또는 회원을 찾을 수 없습니다.";
  if (error.code === "FILE_VIDEO_NOT_ALLOWED") return "동영상 파일은 업로드할 수 없습니다. 이미지(JPG, PNG, WEBP 최대 5MB) 또는 GIF 움짤(최대 3MB)만 첨부해 주세요.";
  if (error.code === "FILE_TYPE_NOT_ALLOWED") return "지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 또는 GIF(움짤) 파일만 첨부할 수 있습니다.";
  if (error.code === "GIF_FILE_TOO_LARGE") return "GIF 움짤 용량이 제한(최대 3MB)을 초과했습니다. 3MB 이하의 가벼운 GIF 파일만 첨부해 주세요.";
  if (error.code === "IMAGE_FILE_TOO_LARGE") return "이미지 파일 용량이 제한(장당 최대 5MB)을 초과했습니다. 5MB 이하의 이미지를 선택해 주세요.";
  if (error.code === "FILE_TOTAL_SIZE_EXCEEDED") return "첨부 파일의 총합 용량이 제한(최대 20MB)을 초과했습니다.";
  if (error.code === "FILE_COUNT_EXCEEDED") return "첨부 가능한 최대 이미지 장수를 초과했습니다.";
  if (error.code === "POLICY_VERSION_OR_CONSENT_INVALID") return "정책 버전이 변경되었거나 필수 동의가 누락되었습니다. 최신 원문을 확인하고 다시 동의해 주세요.";
  if (error.code === "WITHDRAWAL_CONFIRMATION_REQUIRED") return "안내 확인과 ‘탈퇴합니다’ 문구를 정확하게 입력해 주세요.";
  if (error.status === 401) return "로그인 상태가 만료되었습니다. 다시 로그인해 주세요.";
  if (error.status === 403) return "요청 권한 또는 로그인 설정을 확인해 주세요.";
  if (error.status === 404) return "요청한 항목 또는 회원을 찾을 수 없습니다.";
  if (error.status === 409) return "현재 정보와 요청이 충돌했습니다. 상태를 확인한 뒤 다시 시도해 주세요.";
  if (error.status === 400) return "입력한 내용을 확인해 주세요.";
  return "서버 연결을 확인한 뒤 다시 시도해 주세요.";
}
