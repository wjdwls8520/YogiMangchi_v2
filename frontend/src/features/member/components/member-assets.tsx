"use client";

import Link from "next/link";
import { useState } from "react";
import { MemberShell } from "./member-views";
import { useMember } from "./member-provider";
import { TradingDataProvider } from "../../trading/components/trading-data-provider";
import { MemberSimulation } from "../../trading/components/member-simulation";
import { V1AssetSummaryCard, V1Button, V1FolderTabs, V1Tabs } from "./v1-ui";

type AssetTab = "mock" | "contest";
type DetailTab = "holdings" | "pnl" | "orders" | "trades" | "open";

const ZERO_QUANTITY_NOTICE_TEXT =
  "보유수량 또는 포지션 수량이 0인 항목은 과거 거래 이력과 평균매수가/진입가 확인을 위해 표시됩니다. 현재 보유 중인 수량이 없어 평가금액, 평가손익, 수익률은 0으로 표시될 수 있습니다.";

const MOCK_OPEN_POSITIONS = [
  {
    id: 1,
    symbol: "BTCUSDT",
    nameKr: "비트코인 무기한",
    side: "LONG" as const,
    leverage: 10,
    quantity: "0.450 BTC",
    entryPrice: "92,400.00",
    markPrice: "94,280.50",
    liqPrice: "83,610.00",
    margin: "4,158.00 USDT",
    pnl: "+846.23 USDT",
    roe: "+20.35%",
    isPositive: true,
    color: "#0058FF",
    ratio: 45,
  },
  {
    id: 2,
    symbol: "ETHUSDT",
    nameKr: "이더리움 무기한",
    side: "LONG" as const,
    leverage: 5,
    quantity: "3.200 ETH",
    entryPrice: "3,080.00",
    markPrice: "3,142.10",
    liqPrice: "2,495.00",
    margin: "1,971.20 USDT",
    pnl: "+198.72 USDT",
    roe: "+10.08%",
    isPositive: true,
    color: "#9CB34E",
    ratio: 22,
  },
  {
    id: 3,
    symbol: "SOLUSDT",
    nameKr: "솔라나 무기한",
    side: "SHORT" as const,
    leverage: 5,
    quantity: "20.00 SOL",
    entryPrice: "215.00",
    markPrice: "212.40",
    liqPrice: "255.80",
    margin: "860.00 USDT",
    pnl: "+52.00 USDT",
    roe: "+6.05%",
    isPositive: true,
    color: "#1D7CA7",
    ratio: 10,
  },
];

const MOCK_CLOSED_PNL = [
  {
    id: 101,
    closedAt: "2026-11-08 09:42:11",
    symbol: "BTCUSDT",
    nameKr: "비트코인 무기한",
    side: "LONG",
    leverage: 10,
    entryPrice: "91,150.00",
    exitPrice: "93,400.00",
    quantity: "0.300 BTC",
    realizedPnl: "+675.00 USDT",
    roe: "+24.68%",
    isPositive: true,
  },
  {
    id: 102,
    closedAt: "2026-11-07 21:15:04",
    symbol: "XRPUSDT",
    nameKr: "리플 무기한",
    side: "SHORT",
    leverage: 5,
    entryPrice: "0.5820",
    exitPrice: "0.5910",
    quantity: "2,000 XRP",
    realizedPnl: "-18.00 USDT",
    roe: "-7.73%",
    isPositive: false,
  },
];

const MOCK_ORDERS = [
  {
    id: 3001,
    orderedAt: "2026-11-08 10:12:30",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "BUY",
    sideLabel: "매수/롱",
    orderType: "MARKET",
    orderStatus: "COMPLETED",
    orderPrice: "시장가",
    orderQuantity: "0.450 BTC",
    filledQuantity: "0.450 BTC",
    avgFilledPrice: "92,400.00 USDT",
  },
  {
    id: 3002,
    orderedAt: "2026-11-08 09:50:18",
    symbol: "ETHUSDT",
    nameKr: "이더리움",
    side: "BUY",
    sideLabel: "매수/롱",
    orderType: "LIMIT",
    orderStatus: "COMPLETED",
    orderPrice: "3,080.00 USDT",
    orderQuantity: "3.200 ETH",
    filledQuantity: "3.200 ETH",
    avgFilledPrice: "3,080.00 USDT",
  },
  {
    id: 3003,
    orderedAt: "2026-11-08 08:30:00",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "SELL",
    sideLabel: "매도/숏 (익절대기)",
    orderType: "LIMIT",
    orderStatus: "PENDING",
    orderPrice: "96,500.00 USDT",
    orderQuantity: "0.200 BTC",
    filledQuantity: "0.000 BTC",
    avgFilledPrice: "-",
  },
];

const MOCK_TRADES = [
  {
    id: 4001,
    executedAt: "2026-11-08 10:12:30",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "BUY",
    sideLabel: "매수/롱",
    price: "92,400.00 USDT",
    quantity: "0.450 BTC",
    totalAmount: "41,580.00 USDT",
    fee: "12.47 USDT",
    realizedProfit: "0.00 USDT",
  },
  {
    id: 4002,
    executedAt: "2026-11-08 09:42:11",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "SELL",
    sideLabel: "매도/청산",
    price: "93,400.00 USDT",
    quantity: "0.300 BTC",
    totalAmount: "28,020.00 USDT",
    fee: "8.41 USDT",
    realizedProfit: "+675.00 USDT",
  },
];

export function MemberAssetsPage() {
  const { snapshot } = useMember();
  const [assetTab, setAssetTab] = useState<AssetTab>("mock");
  const [detailTab, setDetailTab] = useState<DetailTab>("holdings");

  // 주문/거래 필터 상태
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSide, setFilterSide] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const filteredOrders = MOCK_ORDERS.filter(item => {
    if (filterSymbol && !item.symbol.includes(filterSymbol.toUpperCase())) return false;
    if (filterSide && item.side !== filterSide) return false;
    if (filterStatus && item.orderStatus !== filterStatus) return false;
    return true;
  });

  const openOrders = MOCK_ORDERS.filter(item => item.orderStatus === "PENDING");

  return (
    <MemberShell
      title="내 자산"
      subtitle="선물 모의투자 및 대회 지갑의 실시간 자산 추이, 포지션 현황, 손익·주문·체결 내역을 관리합니다."
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-[1280px] space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
              내 자산
            </h2>
            <p className="mt-1 text-sm font-medium text-gray-500">
              가상 USDT 기반 선물 모의투자 원장 및 포지션·주문 이력을 실시간으로 확인하세요.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/me"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              내 프로필 (/me)
            </Link>
            <Link
              href="/trading"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white hover:bg-blue-700"
            >
              선물 거래소 이동 →
            </Link>
          </div>
        </div>

        {/* 상단 V1Tabs (모의투자 | 대회) */}
        <div className="rounded-2xl border border-gray-200 bg-white px-6 pt-2">
          <V1Tabs
            tabs={[
              { label: "모의투자 (선물)", value: "mock" },
              { label: "대회 (시즌 랭킹)", value: "contest" },
            ]}
            activeTab={assetTab}
            onChange={val => setAssetTab(val as AssetTab)}
          />
        </div>

        {assetTab === "mock" ? (
          <>
            {/* 상단 2-Column: 좌측 AssetSummaryCard + 우측 도넛 차트 & 롱/숏 비율 */}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-5">
                <V1AssetSummaryCard
                  summary={{
                    title: "모의투자 선물 지갑 (1회차)",
                    totalAsset: "11,096.95 USDT",
                    cashBalance: "4,107.75 USDT",
                    totalBuyAmount: "6,989.20 USDT",
                    totalCoinValue: "8,086.15 USDT",
                    totalProfit: "+1,096.95 USDT",
                    totalRoi: "+10.97%",
                    isPositive: true,
                    unit: "USDT",
                  }}
                />

                {/* V2 모의투자 회차 관리 및 재시작 연동 영역 */}
                {snapshot.phase === "ready" && snapshot.consentStatus === "accepted" ? (
                  <div className="card rounded-2xl border border-gray-200 bg-white p-5">
                    <TradingDataProvider>
                      <MemberSimulation />
                    </TradingDataProvider>
                  </div>
                ) : (
                  <div className="card flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-4 text-xs">
                    <div>
                      <strong className="font-black text-gray-900">모의투자 회차 및 파산 재시작 관리</strong>
                      <p className="mt-0.5 text-gray-500">
                        로그인 후 10,000 USDT 시드머니 지급 및 파산 시 새 회차 시작을 이용할 수 있습니다.
                      </p>
                    </div>
                    <Link
                      href="/trading"
                      className="shrink-0 rounded-xl bg-gray-900 px-3.5 py-2 font-bold text-white"
                    >
                      터미널 열기
                    </Link>
                  </div>
                )}
              </div>

              {/* 우측: 증거금 비중 도넛 차트 & 롱/숏 포지션 비율 */}
              <div className="card flex flex-col justify-between rounded-3xl border border-gray-200 bg-white p-6 sm:p-8 lg:col-span-7">
                <div>
                  <h3 className="text-lg font-black text-gray-900">
                    자산 구성 및 포지션 비중 분석
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    종목별 투입 증거금(Isolated Margin) 비중과 롱/숏 포지션 밸런스를 나타냅니다.
                  </p>
                </div>

                <div className="my-6 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:items-center">
                  <div className="flex items-center justify-center gap-6">
                    <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
                      <svg viewBox="0 0 36 36" className="h-40 w-40 -rotate-90">
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke="#E5E7EB"
                          strokeWidth="4.5"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke="#0058FF"
                          strokeWidth="4.5"
                          strokeDasharray="45 55"
                          strokeDashoffset="0"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke="#9CB34E"
                          strokeWidth="4.5"
                          strokeDasharray="22 78"
                          strokeDashoffset="-45"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke="#1D7CA7"
                          strokeWidth="4.5"
                          strokeDasharray="10 90"
                          strokeDashoffset="-67"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-[11px] font-bold text-gray-400">증거금 비중</span>
                        <strong className="text-lg font-black text-gray-900">77.0%</strong>
                      </div>
                    </div>
                  </div>

                  <ul className="space-y-3 text-xs">
                    {MOCK_OPEN_POSITIONS.map(pos => (
                      <li
                        key={pos.symbol}
                        className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-2.5"
                      >
                        <span className="flex items-center gap-2 font-bold text-gray-800">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: pos.color }}
                          />
                          {pos.nameKr} ({pos.symbol})
                        </span>
                        <strong className="font-black text-gray-900">{pos.ratio}%</strong>
                      </li>
                    ))}
                    <li className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-2.5">
                      <span className="flex items-center gap-2 font-bold text-gray-500">
                        <span className="inline-block h-3 w-3 rounded-full bg-gray-300" />
                        가용 현금 (USDT)
                      </span>
                      <strong className="font-black text-gray-700">23%</strong>
                    </li>
                  </ul>
                </div>

                {/* 롱 / 숏 비율 바 */}
                <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-4 space-y-2">
                  <div className="flex justify-between text-xs font-black">
                    <span className="text-red-500">LONG 비중 87.7% (6,129.20 USDT)</span>
                    <span className="text-blue-600">SHORT 비중 12.3% (860.00 USDT)</span>
                  </div>
                  <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-red-500" style={{ width: "87.7%" }} />
                    <div className="h-full bg-blue-600" style={{ width: "12.3%" }} />
                  </div>
                </div>
              </div>
            </div>

            {/* 하단 V1FolderTabs 5탭 (포지션 현황 | 손익현황 | 주문내역 | 거래내역 | 미체결내역) */}
            <V1FolderTabs
              tabs={[
                { id: "holdings", label: "포지션 현황" },
                { id: "pnl", label: "손익현황" },
                { id: "orders", label: "주문내역" },
                { id: "trades", label: "거래내역" },
                { id: "open", label: `미체결내역 (${openOrders.length})` },
              ]}
              activeId={detailTab}
              onChange={id => setDetailTab(id as DetailTab)}
            >
              {detailTab === "holdings" && (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-2xl border border-gray-200">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                        <tr>
                          <th className="px-4 py-3.5">종목 / 배율</th>
                          <th className="px-4 py-3.5">포지션</th>
                          <th className="px-4 py-3.5 text-right">포지션 수량</th>
                          <th className="px-4 py-3.5 text-right">진입가격</th>
                          <th className="px-4 py-3.5 text-right">마크가격</th>
                          <th className="px-4 py-3.5 text-right">청산예상가</th>
                          <th className="px-4 py-3.5 text-right">투입 증거금</th>
                          <th className="px-4 py-3.5 text-right">평가손익 (ROE)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {MOCK_OPEN_POSITIONS.map(pos => (
                          <tr key={pos.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3.5 font-black text-gray-900">
                              <div>{pos.nameKr}</div>
                              <div className="text-[11px] font-bold text-gray-400">
                                {pos.symbol} · 격리 {pos.leverage}x
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${
                                  pos.side === "LONG"
                                    ? "bg-red-50 text-red-500"
                                    : "bg-blue-50 text-blue-600"
                                }`}
                              >
                                {pos.side}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right font-bold text-gray-800">
                              {pos.quantity}
                            </td>
                            <td className="px-4 py-3.5 text-right font-medium text-gray-600">
                              ${pos.entryPrice}
                            </td>
                            <td className="px-4 py-3.5 text-right font-bold text-gray-900">
                              ${pos.markPrice}
                            </td>
                            <td className="px-4 py-3.5 text-right font-semibold text-amber-600">
                              ${pos.liqPrice}
                            </td>
                            <td className="px-4 py-3.5 text-right font-bold text-gray-700">
                              {pos.margin}
                            </td>
                            <td className="px-4 py-3.5 text-right font-black text-red-500">
                              <div>{pos.pnl}</div>
                              <div className="text-[11px]">{pos.roe}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs font-semibold leading-relaxed text-blue-700">
                    {ZERO_QUANTITY_NOTICE_TEXT}
                  </div>
                </div>
              )}

              {detailTab === "pnl" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                      <span className="text-xs font-bold text-gray-400">누적 실현손익</span>
                      <p className="mt-1 text-xl font-black text-red-500">+657.00 USDT</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                      <span className="text-xs font-bold text-gray-400">미실현 평가손익</span>
                      <p className="mt-1 text-xl font-black text-red-500">+1,096.95 USDT</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                      <span className="text-xs font-bold text-gray-400">청산/종료 승률</span>
                      <p className="mt-1 text-xl font-black text-[#0058FF]">68.4% (13승 6패)</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-gray-200">
                    <table className="w-full min-w-[680px] text-left text-xs">
                      <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                        <tr>
                          <th className="px-4 py-3.5">종료 시각</th>
                          <th className="px-4 py-3.5">종목 / 배율</th>
                          <th className="px-4 py-3.5">포지션</th>
                          <th className="px-4 py-3.5 text-right">진입가격</th>
                          <th className="px-4 py-3.5 text-right">종료가격</th>
                          <th className="px-4 py-3.5 text-right">청산수량</th>
                          <th className="px-4 py-3.5 text-right">실현손익 (ROE)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {MOCK_CLOSED_PNL.map(row => (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3.5 text-gray-500">{row.closedAt}</td>
                            <td className="px-4 py-3.5 font-bold text-gray-900">
                              {row.nameKr} ({row.symbol} · {row.leverage}x)
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${
                                  row.side === "LONG"
                                    ? "bg-red-50 text-red-500"
                                    : "bg-blue-50 text-blue-600"
                                }`}
                              >
                                {row.side}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right">${row.entryPrice}</td>
                            <td className="px-4 py-3.5 text-right font-bold">${row.exitPrice}</td>
                            <td className="px-4 py-3.5 text-right">{row.quantity}</td>
                            <td
                              className={`px-4 py-3.5 text-right font-black ${
                                row.isPositive ? "text-red-500" : "text-blue-600"
                              }`}
                            >
                              {row.realizedPnl} ({row.roe})
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detailTab === "orders" && (
                <div className="space-y-4">
                  {/* V1 주문내역 필터 바 */}
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-[#F9FAFB] p-3">
                    <input
                      type="text"
                      value={filterSymbol}
                      onChange={e => setFilterSymbol(e.target.value)}
                      placeholder="종목코드 검색 (예: BTC)"
                      className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                    />
                    <select
                      aria-label="주문 구분 필터"
                      value={filterSide}
                      onChange={e => setFilterSide(e.target.value)}
                      className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                    >
                      <option value="">구분 전체</option>
                      <option value="BUY">매수/롱</option>
                      <option value="SELL">매도/숏</option>
                    </select>
                    <select
                      aria-label="주문 상태 필터"
                      value={filterStatus}
                      onChange={e => setFilterStatus(e.target.value)}
                      className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                    >
                      <option value="">상태 전체</option>
                      <option value="PENDING">대기중</option>
                      <option value="PARTIALLY_FILLED">부분체결</option>
                      <option value="COMPLETED">체결완료</option>
                      <option value="CANCELED">취소</option>
                    </select>
                    <V1Button
                      variant="gray"
                      size="xs"
                      onClick={() => {
                        setFilterSymbol("");
                        setFilterSide("");
                        setFilterStatus("");
                      }}
                    >
                      필터 초기화
                    </V1Button>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-gray-200">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                        <tr>
                          <th className="px-4 py-3.5">주문시각</th>
                          <th className="px-4 py-3.5">종목</th>
                          <th className="px-4 py-3.5">구분</th>
                          <th className="px-4 py-3.5">유형</th>
                          <th className="px-4 py-3.5 text-right">주문가격</th>
                          <th className="px-4 py-3.5 text-right">주문수량</th>
                          <th className="px-4 py-3.5 text-right">체결수량</th>
                          <th className="px-4 py-3.5 text-right">상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {filteredOrders.map(order => (
                          <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3.5 text-gray-500">{order.orderedAt}</td>
                            <td className="px-4 py-3.5 font-bold text-gray-900">
                              {order.nameKr} ({order.symbol})
                            </td>
                            <td
                              className={`px-4 py-3.5 font-bold ${
                                order.side === "BUY" ? "text-red-500" : "text-blue-600"
                              }`}
                            >
                              {order.sideLabel}
                            </td>
                            <td className="px-4 py-3.5 text-gray-600">
                              {order.orderType === "MARKET" ? "시장가" : "지정가"}
                            </td>
                            <td className="px-4 py-3.5 text-right font-medium">{order.orderPrice}</td>
                            <td className="px-4 py-3.5 text-right">{order.orderQuantity}</td>
                            <td className="px-4 py-3.5 text-right font-bold">{order.filledQuantity}</td>
                            <td className="px-4 py-3.5 text-right font-bold text-gray-700">
                              {order.orderStatus === "COMPLETED" ? "체결완료" : "대기중"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detailTab === "trades" && (
                <div className="overflow-x-auto rounded-2xl border border-gray-200">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                      <tr>
                        <th className="px-4 py-3.5">체결시각</th>
                        <th className="px-4 py-3.5">종목</th>
                        <th className="px-4 py-3.5">구분</th>
                        <th className="px-4 py-3.5 text-right">체결가격</th>
                        <th className="px-4 py-3.5 text-right">체결수량</th>
                        <th className="px-4 py-3.5 text-right">체결금액</th>
                        <th className="px-4 py-3.5 text-right">수수료</th>
                        <th className="px-4 py-3.5 text-right">실현손익</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {MOCK_TRADES.map(trade => (
                        <tr key={trade.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3.5 text-gray-500">{trade.executedAt}</td>
                          <td className="px-4 py-3.5 font-bold text-gray-900">
                            {trade.nameKr} ({trade.symbol})
                          </td>
                          <td
                            className={`px-4 py-3.5 font-bold ${
                              trade.side === "BUY" ? "text-red-500" : "text-blue-600"
                            }`}
                          >
                            {trade.sideLabel}
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold">{trade.price}</td>
                          <td className="px-4 py-3.5 text-right">{trade.quantity}</td>
                          <td className="px-4 py-3.5 text-right">{trade.totalAmount}</td>
                          <td className="px-4 py-3.5 text-right text-gray-500">{trade.fee}</td>
                          <td className="px-4 py-3.5 text-right font-black text-red-500">
                            {trade.realizedProfit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detailTab === "open" && (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-2xl border border-gray-200">
                    <table className="w-full min-w-[680px] text-left text-xs">
                      <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                        <tr>
                          <th className="px-4 py-3.5">주문시각</th>
                          <th className="px-4 py-3.5">종목</th>
                          <th className="px-4 py-3.5">구분</th>
                          <th className="px-4 py-3.5 text-right">지정가격</th>
                          <th className="px-4 py-3.5 text-right">미체결수량</th>
                          <th className="px-4 py-3.5 text-right">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {openOrders.map(order => (
                          <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3.5 text-gray-500">{order.orderedAt}</td>
                            <td className="px-4 py-3.5 font-bold text-gray-900">
                              {order.nameKr} ({order.symbol})
                            </td>
                            <td className="px-4 py-3.5 font-bold text-blue-600">{order.sideLabel}</td>
                            <td className="px-4 py-3.5 text-right font-bold">{order.orderPrice}</td>
                            <td className="px-4 py-3.5 text-right">{order.orderQuantity}</td>
                            <td className="px-4 py-3.5 text-right">
                              <Link
                                href="/trading"
                                className="inline-flex rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100"
                              >
                                터미널에서 취소
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </V1FolderTabs>
          </>
        ) : (
          /* 대회 자산 탭 (준비중 안내) */
          <div className="card rounded-3xl border border-gray-200 bg-white py-16 px-6 text-center space-y-4">
            <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
              SEASON CONTEST · 준비중
            </span>
            <h3 className="text-xl font-black text-gray-900">
              참여 중인 모의투자 대회 선물 지갑이 없습니다
            </h3>
            <p className="mx-auto max-w-lg text-sm text-gray-500">
              정규 시즌 대회가 오픈되면 대회 전용 시드머니와 포지션·손익·주문 내역을 이곳에서 별도 관리할 수 있습니다.
            </p>
            <div className="pt-2">
              <Link
                href="/contest"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-xs font-bold text-white hover:bg-blue-700"
              >
                대회 일정 및 안내 확인하기
              </Link>
            </div>
          </div>
        )}
      </div>
    </MemberShell>
  );
}
