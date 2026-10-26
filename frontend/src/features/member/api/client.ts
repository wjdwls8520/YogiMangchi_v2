export class ContentApiError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("회원 요청을 처리하지 못했습니다."); this.name = "ContentApiError";
  }
}
const codes = new Set(["SERVICE_TEMPORARILY_UNAVAILABLE", "NICKNAME_ALREADY_EXISTS", "NICKNAME_UNAVAILABLE", "MEMBER_BUSY", "INVALID_REQUEST", "INVALID_PROFILE", "INVALID_NICKNAME", "AUTHENTICATION_REQUIRED", "INVALID_ACCESS_TOKEN", "ACCESS_DENIED", "POLICY_VERSION_OR_CONSENT_INVALID", "MEMBER_NOT_ACTIVE", "WITHDRAWAL_CONFIRMATION_REQUIRED", "MEMBER_ALREADY_EXISTS"]);
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
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; access?: string; csrf?: string; body?: object; signal?: AbortSignal;
} = {}, transport: typeof fetch = fetch): Promise<unknown> {
  if (!/^\/(?:auth\/(?:csrf|flow|signup|login\/complete|refresh|logout)|policies\/(?:current|(?:TERMS|PRIVACY)\/[A-Za-z0-9._-]+)|members(?:\/[^?#]*)?)(?:\?[^#]*)?$/.test(path)
    || path.includes("..") || path.includes("\\")) throw new ContentApiError(400);
  const cookie = path.startsWith("/auth/") || path === "/members/me/withdrawal";
  try {
    const response = await transport(`${contentOrigin(origin)}/api/v1${path}`, {
      method: options.method ?? "GET", credentials: cookie ? "include" : "omit", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]),
      headers: { ...(options.access ? { Authorization: `Bearer ${options.access}` } : {}),
        ...(options.csrf ? { "X-CSRF-TOKEN": options.csrf } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
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
  if (error.code === "POLICY_VERSION_OR_CONSENT_INVALID") return "정책 버전이 변경되었거나 필수 동의가 누락되었습니다. 최신 원문을 확인하고 다시 동의해 주세요.";
  if (error.code === "WITHDRAWAL_CONFIRMATION_REQUIRED") return "안내 확인과 ‘탈퇴합니다’ 문구를 정확하게 입력해 주세요.";
  if (error.status === 401) return "로그인 상태가 만료되었습니다. 다시 로그인해 주세요.";
  if (error.status === 403) return "요청 권한 또는 로그인 설정을 확인해 주세요.";
  if (error.status === 404) return "회원을 찾을 수 없습니다.";
  if (error.status === 409) return "중복된 닉네임이나 변경 중인 정보가 있는지 확인해 주세요.";
  if (error.status === 400) return "입력한 내용을 확인해 주세요.";
  return "서버 연결을 확인한 뒤 다시 시도해 주세요.";
}
