import { marketEndpoints } from "../market/catalog";

export class TradingApiError extends Error {
  constructor(readonly status: number, message = "Trading 데이터를 불러올 수 없습니다.") {
    super(message);
    this.name = "TradingApiError";
  }
}

export function tradingOrigin(base: string) {
  try { return new URL(marketEndpoints(base).symbols).origin; }
  catch { throw new TradingApiError(400, "Trading Server 주소 설정을 확인해 주세요."); }
}

// Never propagate response bodies, URLs, headers or fetch error causes into UI/errors.
export async function tradingJson(origin: string, path: string, options: {
  token?: string; signal?: AbortSignal; method?: "GET" | "POST";
} = {}, transport: typeof fetch = fetch): Promise<unknown> {
  const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(options.signal ? [options.signal] : [])]);
  try {
    const response = await transport(`${tradingOrigin(origin)}/api/v1/trading/${path}`, {
      method: options.method ?? "GET", credentials: "omit", cache: "no-store", redirect: "error", signal,
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    });
    if (!response.ok) throw new TradingApiError(response.status);
    try { return await response.json(); }
    catch { throw new TradingApiError(422, "서버 응답 형식을 확인할 수 없습니다."); }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof TradingApiError) throw error;
    throw new TradingApiError(0, "서버 연결을 확인한 뒤 다시 시도해 주세요.");
  }
}

export function retryTradingQuery(failureCount: number, error: unknown) {
  return failureCount < 2 && error instanceof TradingApiError && [0, 500, 502, 503, 504].includes(error.status);
}
