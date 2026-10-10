export type TradingSymbol = {
  id: number;
  symbol: string;
  name: string;
  quoteAsset: string;
  displaySymbol: string;
};

export function parseSymbols(input: unknown): TradingSymbol[] {
  if (!Array.isArray(input)) throw new Error("Invalid symbol response");
  const ids = new Set<number>();
  return input.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid symbol");
    const entry = value as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.id) || (entry.id as number) <= 0 || ids.has(entry.id as number)
      || ![entry.symbol, entry.name, entry.quoteAsset, entry.displaySymbol].every((item) => typeof item === "string" && item.length > 0 && item.length <= 100)) {
      throw new Error("Invalid symbol fields");
    }
    ids.add(entry.id as number);
    return entry as TradingSymbol;
  });
}

export function marketEndpoints(base: string) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Trading server must be an HTTP(S) origin");
  }
  const symbols = new URL("/api/v1/symbols", url).href;
  const socket = new URL("/ws/market", url);
  socket.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { symbols, socket: socket.href };
}
