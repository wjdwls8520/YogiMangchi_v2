export type TradingSymbol = {
  id: number;
  symbol: string;
  name: string;
  quoteAsset: string;
  displaySymbol: string;
  priceTickSize?: string;
};

export type SymbolCatalog = {symbols:TradingSymbol[];allSymbols:TradingSymbol[];state:"loading"|"unavailable"|"empty"|"ready";socket:string};
export function loadedSymbolCatalog(allSymbols:TradingSymbol[],socket:string,excluded:ReadonlySet<number>):SymbolCatalog {
  const symbols=allSymbols.filter(symbol=>symbol.quoteAsset==="USDT"&&!excluded.has(symbol.id));
  return {allSymbols,symbols,socket,state:symbols.length?"ready":"empty"};
}
export function failedSymbolCatalog(current:SymbolCatalog,excluded:ReadonlySet<number>):SymbolCatalog {
  // A failed metadata refresh must not discard the current chart subscription.
  // An explicitly rejected symbol still cannot be selected again.
  return {...current,symbols:current.symbols.filter(symbol=>!excluded.has(symbol.id)),state:"unavailable"};
}
export function catalogStateLabel(state:SymbolCatalog["state"]) {
  return state==="unavailable"?"종목을 불러오지 못했습니다":state==="empty"?"거래 가능한 종목이 없습니다":state==="loading"?"거래 가능 종목 확인 중":"종목 선택";
}

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
    return { ...entry, priceTickSize: typeof entry.priceTickSize === "string" ? entry.priceTickSize : undefined } as TradingSymbol;
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
