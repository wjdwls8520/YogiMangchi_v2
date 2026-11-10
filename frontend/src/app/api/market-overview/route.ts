import { NextResponse } from "next/server";
import {
  FALLBACK_MARKET_OVERVIEW,
  fetchLiveMarketOverview,
  type MarketOverviewData,
} from "@/features/member/api/market-overview";

const CACHE_TTL_MS = 60_000;

let cachedOverview: MarketOverviewData | null = null;
let cachedAtMs = 0;
let inflightPromise: Promise<MarketOverviewData> | null = null;

export async function GET() {
  const now = Date.now();
  if (cachedOverview && now - cachedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(cachedOverview, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  }

  if (!inflightPromise) {
    inflightPromise = fetchLiveMarketOverview()
      .then(fresh => {
        cachedOverview = fresh;
        cachedAtMs = Date.now();
        return fresh;
      })
      .catch(() => cachedOverview ?? FALLBACK_MARKET_OVERVIEW)
      .finally(() => {
        inflightPromise = null;
      });
  }

  const data = await inflightPromise;
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
