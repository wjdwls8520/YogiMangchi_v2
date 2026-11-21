import { NextResponse } from "next/server";
import {
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
    return NextResponse.json(
      { status: "UNAVAILABLE" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
