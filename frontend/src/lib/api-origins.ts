export const DEFAULT_CONTENT_ORIGIN = "http://localhost:8080";
export const DEFAULT_TRADING_ORIGIN = "http://localhost:8081";

export function resolveContentOrigin(): string {
  return (
    process.env.CONTENT_API_BASE_URL ||
    process.env.NEXT_PUBLIC_CONTENT_SERVER_URL ||
    process.env.NEXT_PUBLIC_CONTENT_API_BASE_URL ||
    DEFAULT_CONTENT_ORIGIN
  ).replace(/\/+$/, "");
}

export function resolveTradingOrigin(): string {
  return (
    process.env.TRADING_API_BASE_URL ||
    process.env.NEXT_PUBLIC_TRADING_SERVER_URL ||
    process.env.NEXT_PUBLIC_TRADING_API_BASE_URL ||
    DEFAULT_TRADING_ORIGIN
  ).replace(/\/+$/, "");
}
