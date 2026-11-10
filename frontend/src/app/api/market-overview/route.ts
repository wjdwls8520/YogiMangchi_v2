import { NextResponse } from "next/server";
import {
  FALLBACK_MARKET_OVERVIEW,
  fetchRedisMarketOverview,
  resolveTradingMarketBaseUrl,
} from "@/features/member/api/market-overview";

export async function GET() {
  try {
    const data = await fetchRedisMarketOverview(resolveTradingMarketBaseUrl());
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json(FALLBACK_MARKET_OVERVIEW, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }
}
