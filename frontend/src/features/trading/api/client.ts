import { marketEndpoints } from "../market/catalog";

export class TradingApiError extends Error {
  constructor(readonly status: number, message = "Trading 데이터를 불러올 수 없습니다.", readonly code?: string) {
    super(message);
    this.name = "TradingApiError";
  }
}

const serverCodes = new Set(["TRADING_BUSY", "CLOSE_QUANTITY_EXCEEDED", "ENGINE_RECOVERING", "ORDER_NOT_FOUND",
  "ORDER_NOT_PENDING", "PENDING_LIMIT_REACHED", "INVALID_ORDER", "INVALID_IDEMPOTENCY_KEY", "IDEMPOTENCY_CONFLICT",
  "PRICE_NOT_FRESH", "INSUFFICIENT_MARGIN", "ACCOUNT_AT_RISK", "ACCOUNT_NOT_ACTIVE", "POSITION_NOT_FOUND",
  "POSITION_NOT_OPEN", "SYMBOL_NOT_AVAILABLE", "POSITION_LIMIT_REACHED", "ACCOUNT_NOT_FOUND"]);

export function tradingOrigin(base: string) {
  try { return new URL(marketEndpoints(base).symbols).origin; }
  catch { throw new TradingApiError(400, "Trading Server 주소 설정을 확인해 주세요."); }
}

// Never propagate response bodies, URLs, headers or fetch error causes into UI/errors.
export async function tradingJson(origin: string, path: string, options: {
  token?: string; signal?: AbortSignal; method?: "GET" | "POST"; body?: object; idempotencyKey?: string;
} = {}, transport: typeof fetch = fetch): Promise<unknown> {
  return apiJson(origin, `/api/v1/trading/${path}`, options, transport);
}
export async function marketTickersJson(origin: string, signal: AbortSignal) {
  return apiJson(origin, "/api/v1/market/tickers", { signal });
}
async function apiJson(origin: string, path: string, options: {
  token?: string; signal?: AbortSignal; method?: "GET" | "POST"; body?: object; idempotencyKey?: string;
}, transport: typeof fetch = fetch): Promise<unknown> {
  const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]);
  try {
    const response = await transport(`${tradingOrigin(origin)}${path}`, {
      method: options.method ?? "GET", credentials: "omit", cache: "no-store", redirect: "error", signal,
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        const problem: unknown = await response.json();
        // Retain only known business codes, never arbitrary server strings.
        if (problem && typeof problem === "object" && !Array.isArray(problem)
          && typeof (problem as Record<string, unknown>).code === "string"
          && serverCodes.has((problem as Record<string, unknown>).code as string)) code = (problem as Record<string, unknown>).code as string;
      } catch { /* An unreadable error body must not replace the HTTP status. */ }
      throw new TradingApiError(response.status, undefined, code);
    }
    try { return await response.json(); }
    catch { throw new TradingApiError(422, "서버 응답 형식을 확인할 수 없습니다."); }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0, "서버 연결을 확인한 뒤 다시 시도해 주세요.");
  }
}

export function retryTradingQuery(failureCount: number, error: unknown) {
  return failureCount < 2 && error instanceof TradingApiError
    && ([0, 500, 502, 503, 504].includes(error.status) || (error.status === 409 && error.code === "TRADING_BUSY"));
}
