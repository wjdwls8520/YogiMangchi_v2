"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MemberShell } from "./member-views";
import { useMember } from "./member-provider";
import { DimModal } from "./dim-modal";
import {
  V1AssetSummaryCard,
  V1Button,
  V1FolderTabs,
  V1ProfileSidebar,
  V1Tabs,
  V1UserAvatar,
} from "./v1-ui";

type ProfileResponse = {
  memberId?: number;
  nickname?: string;
  profileMessage?: string | null;
  profileImageUrl?: string | null;
  followerCount?: number;
  followingCount?: number;
};

type FollowMemberItem = {
  memberId: number;
  nickname: string;
  profileMsg: string;
  following: boolean;
  followsMe: boolean;
};

const INITIAL_FOLLOWERS: FollowMemberItem[] = [
  { memberId: 11, nickname: "알파트레이더", profileMsg: "BTC/ETH 추세 매매 전문", following: true, followsMe: true },
  { memberId: 15, nickname: "퀀트매니저", profileMsg: "펀딩비 차익 및 단기 변동성 돌파", following: false, followsMe: true },
  { memberId: 22, nickname: "솔라나고래", profileMsg: "격리 10배 원칙 매매", following: true, followsMe: true },
];

const INITIAL_FOLLOWINGS: FollowMemberItem[] = [
  { memberId: 11, nickname: "알파트레이더", profileMsg: "BTC/ETH 추세 매매 전문", following: true, followsMe: true },
  { memberId: 22, nickname: "솔라나고래", profileMsg: "격리 10배 원칙 매매", following: true, followsMe: true },
  { memberId: 31, nickname: "매크로워처", profileMsg: "FOMC·CPI 거시 지표 분석", following: true, followsMe: false },
];

const MOCK_POSITIONS = [
  {
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
    marginRatio: 45,
    color: "#0058FF",
  },
  {
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
    marginRatio: 22,
    color: "#9CB34E",
  },
  {
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
    marginRatio: 10,
    color: "#1D7CA7",
  },
];

export function MemberMyProfilePage() {
  const { snapshot: member, session } = useMember();
  const [mainTab, setMainTab] = useState<"portfolio" | "community">("portfolio");
  const [portfolioTab, setPortfolioTab] = useState<"mock" | "contest">("mock");
  const [communityTab, setCommunityTab] = useState<
    "posts" | "replies" | "likedPosts" | "likedReplies" | "reports"
  >("posts");
  const [followModalType, setFollowModalType] = useState<"followers" | "followings" | null>(null);
  const [followers, setFollowers] = useState<FollowMemberItem[]>(INITIAL_FOLLOWERS);
  const [followings, setFollowings] = useState<FollowMemberItem[]>(INITIAL_FOLLOWINGS);
  const [reports, setReports] = useState([
    {
      id: 501,
      targetType: "게시글",
      title: "외부 리딩방 불법 홍보 게시글",
      reason: "스팸 홍보/도배글입니다.",
      reportedAt: "2026-11-07",
      status: "접수완료",
    },
  ]);

  const ready = member.phase === "ready";
  const profileQuery = useQuery({
    queryKey: ["member", "profile", member.memberId, member.generation],
    enabled: ready,
    queryFn: () => session.request("/members/me") as Promise<ProfileResponse>,
  });

  const nickname = profileQuery.data?.nickname ?? member.nickname ?? "트레이더";
  const profileMsg =
    profileQuery.data?.profileMessage ?? "리스크 관리와 손절 원칙을 지키는 선물 트레이더입니다.";
  const followerCount = profileQuery.data?.followerCount ?? followers.length;
  const followingCount = profileQuery.data?.followingCount ?? followings.length;

  function toggleFollowInModal(targetId: number) {
    setFollowers(curr =>
      curr.map(item => (item.memberId === targetId ? { ...item, following: !item.following } : item)),
    );
    setFollowings(curr =>
      curr.map(item => (item.memberId === targetId ? { ...item, following: !item.following } : item)),
    );
  }

  return (
    <MemberShell
      title="내 프로필 · 포트폴리오"
      subtitle="나의 프로필 정보와 선물 모의투자 포트폴리오, 커뮤니티 활동 내역을 확인하세요."
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-[1280px]">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* 좌측 컬럼 (lg:col-span-4): ProfileSidebar + AssetSummaryCard + 회원탈퇴 */}
          <div className="space-y-6 lg:col-span-4">
            <V1ProfileSidebar
              profile={{
                memberId: member.memberId ?? 7,
                nickname,
                profileMsg,
                profileImgUrl: profileQuery.data?.profileImageUrl,
                role: "USER",
                followerCount,
                followingCount,
              }}
              onClickFollowers={() => setFollowModalType("followers")}
              onClickFollowings={() => setFollowModalType("followings")}
              actionArea={
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/me/settings"
                      className="flex h-10 items-center justify-center rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      회원정보 수정
                    </Link>
                    <Link
                      href="/assets"
                      className="flex h-10 items-center justify-center rounded-xl bg-[#0058FF] text-xs font-bold text-white transition-colors hover:bg-blue-700"
                    >
                      내 자산 상세
                    </Link>
                  </div>
                  {ready ? (
                    <button
                      type="button"
                      onClick={() => void session.logout()}
                      className="flex h-9 w-full items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200"
                    >
                      로그아웃
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="flex h-9 w-full items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      소셜 로그인 연결하기
                    </Link>
                  )}
                </div>
              }
            />

            <V1AssetSummaryCard
              summary={{
                title: "모의투자 선물 지갑",
                totalAsset: "11,096.95 USDT",
                cashBalance: "4,107.75 USDT",
                totalBuyAmount: "6,989.20 USDT",
                totalCoinValue: "8,086.15 USDT",
                totalProfit: "+1,096.95 USDT",
                totalRoi: "+10.97%",
                isPositive: true,
                unit: "USDT",
              }}
              footerSlot={
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">1회차 시드머니: 10,000 USDT</span>
                  <Link href="/assets" className="font-bold text-blue-400 hover:underline">
                    전체 자산/주문내역 →
                  </Link>
                </div>
              }
            />

            <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-3.5 text-xs">
              <span className="font-medium text-gray-500">계정 관리 및 약관 동의 철회</span>
              <Link href="/me/settings#withdrawal" className="font-bold text-gray-400 hover:text-red-500">
                회원 탈퇴 안내 →
              </Link>
            </div>
          </div>

          {/* 우측 컬럼 (lg:col-span-8): 메인 탭 (나의 포트폴리오 | 커뮤니티) */}
          <div className="space-y-6 lg:col-span-8">
            <div className="rounded-2xl border border-gray-200 bg-white px-6 pt-2">
              <V1Tabs
                tabs={[
                  { label: "나의 포트폴리오", value: "portfolio" },
                  { label: "커뮤니티 활동", value: "community" },
                ]}
                activeTab={mainTab}
                onChange={val => setMainTab(val as "portfolio" | "community")}
              />
            </div>

            {mainTab === "portfolio" ? (
              <V1FolderTabs
                tabs={[
                  { id: "mock", label: "모의투자 (선물)" },
                  { id: "contest", label: "대회" },
                ]}
                activeId={portfolioTab}
                onChange={id => setPortfolioTab(id as "mock" | "contest")}
              >
                {portfolioTab === "mock" ? (
                  <div className="space-y-8">
                    {/* 상단: 도넛 차트 (증거금 비중) + 롱/숏 비율 바 */}
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      {/* 도넛 차트 영역 */}
                      <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                        <h3 className="mb-4 text-sm font-black text-gray-900">
                          포지션 증거금 비중 (%)
                        </h3>
                        <div className="flex items-center gap-6">
                          <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
                            <svg viewBox="0 0 36 36" className="h-36 w-36 -rotate-90">
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
                                strokeDasharray="40 60"
                                strokeDashoffset="0"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#9CB34E"
                                strokeWidth="4.5"
                                strokeDasharray="20 80"
                                strokeDashoffset="-40"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#1D7CA7"
                                strokeWidth="4.5"
                                strokeDasharray="10 90"
                                strokeDashoffset="-60"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                              <span className="text-[10px] font-bold text-gray-400">사용 비중</span>
                              <strong className="text-base font-black text-gray-900">63.0%</strong>
                            </div>
                          </div>

                          <ul className="flex-1 space-y-2 text-xs">
                            {MOCK_POSITIONS.map(pos => (
                              <li key={pos.symbol} className="flex items-center justify-between">
                                <span className="flex items-center gap-2 font-bold text-gray-700">
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: pos.color }}
                                  />
                                  {pos.symbol}
                                </span>
                                <span className="font-black text-gray-900">{pos.marginRatio}%</span>
                              </li>
                            ))}
                            <li className="flex items-center justify-between border-t border-gray-200 pt-1.5">
                              <span className="flex items-center gap-2 font-bold text-gray-500">
                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" />
                                가용 USDT
                              </span>
                              <span className="font-black text-gray-600">23%</span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      {/* 롱 / 숏 포지션 비율 바 */}
                      <div className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                        <div>
                          <h3 className="mb-2 text-sm font-black text-gray-900">
                            롱 / 숏 포지션 비율
                          </h3>
                          <p className="text-xs text-gray-500">
                            현재 오픈된 선물 포지션의 매수(Long) / 매도(Short) 증거금 비율입니다.
                          </p>
                        </div>

                        <div className="my-4 space-y-2">
                          <div className="flex justify-between text-xs font-black">
                            <span className="text-red-500">LONG 87.7% (2종목)</span>
                            <span className="text-blue-600">SHORT 12.3% (1종목)</span>
                          </div>
                          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <div className="h-full bg-red-500" style={{ width: "87.7%" }} />
                            <div className="h-full bg-blue-600" style={{ width: "12.3%" }} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 text-xs">
                          <div>
                            <span className="text-gray-400">평균 레버리지</span>
                            <p className="font-black text-gray-900">7.8x (격리)</p>
                          </div>
                          <div className="text-right">
                            <span className="text-gray-400">누적 승률</span>
                            <p className="font-black text-[#0058FF]">68.4% (13승 6패)</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 하단: 보유 선물 포지션 목록 */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-base font-black text-gray-900">
                          보유 선물 포지션 현황 ({MOCK_POSITIONS.length})
                        </h3>
                        <Link href="/trading" className="text-xs font-bold text-[#0058FF] hover:underline">
                          터미널에서 포지션 관리 →
                        </Link>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-gray-200">
                        <table className="w-full min-w-[640px] text-left text-xs">
                          <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                            <tr>
                              <th className="px-4 py-3">종목 / 배율</th>
                              <th className="px-4 py-3">포지션</th>
                              <th className="px-4 py-3 text-right">보유수량</th>
                              <th className="px-4 py-3 text-right">진입가격</th>
                              <th className="px-4 py-3 text-right">마크가격</th>
                              <th className="px-4 py-3 text-right">청산예상가</th>
                              <th className="px-4 py-3 text-right">평가손익 (ROE)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {MOCK_POSITIONS.map(pos => (
                              <tr key={pos.symbol} className="hover:bg-gray-50">
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
                                <td className="px-4 py-3.5 text-right font-black text-red-500">
                                  <div>{pos.pnl}</div>
                                  <div className="text-[11px]">{pos.roe}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs font-semibold leading-relaxed text-blue-700">
                        보유수량 또는 포지션 수량이 0인 항목은 과거 거래 이력과 진입가 확인을 위해 내 자산 화면에서 조회할 수 있습니다.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center space-y-4">
                    <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
                      SEASON CONTEST · 준비중
                    </span>
                    <h3 className="text-lg font-black text-gray-900">
                      현재 진행 중인 대회 참여 내역이 없습니다
                    </h3>
                    <p className="mx-auto max-w-md text-xs leading-relaxed text-gray-500">
                      시즌 모의투자 대회가 시작되면 대회 전용 선물 지갑과 시즌별 수익률·순위가 이곳에 표시됩니다.
                    </p>
                    <div>
                      <Link
                        href="/contest"
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0058FF] px-5 text-xs font-bold text-white hover:bg-blue-700"
                      >
                        대회 안내 페이지 보기
                      </Link>
                    </div>
                  </div>
                )}
              </V1FolderTabs>
            ) : (
              /* 커뮤니티 활동 탭 (5개 FolderTabs: 게시글 | 댓글 | 좋아요 | 좋아요 댓글 | 신고내역) */
              <V1FolderTabs
                tabs={[
                  { id: "posts", label: "게시글" },
                  { id: "replies", label: "댓글" },
                  { id: "likedPosts", label: "좋아요" },
                  { id: "likedReplies", label: "좋아요 댓글" },
                  { id: "reports", label: "신고내역" },
                ]}
                activeId={communityTab}
                onChange={id =>
                  setCommunityTab(
                    id as "posts" | "replies" | "likedPosts" | "likedReplies" | "reports",
                  )
                }
              >
                {communityTab === "posts" && (
                  <div className="space-y-3">
                    <article className="rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span className="font-bold text-[#0058FF]">포지션 인증 · #BTC</span>
                        <span>2026-11-08</span>
                      </div>
                      <Link href="/community" className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]">
                        BTC 10배 롱 포지션 진입 및 손절가 공유
                      </Link>
                      <p className="mt-1 text-xs text-gray-600">
                        지지 구간 확인 후 진입했으며 손절가는 -25% ROE 지점으로 설정했습니다.
                      </p>
                    </article>
                  </div>
                )}

                {communityTab === "replies" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-gray-200 p-4 text-xs">
                      <p className="font-bold text-gray-900">
                        “감사합니다! 리스크 관리가 최우선입니다.”
                      </p>
                      <p className="mt-1 text-gray-400">원문: BTC 10배 롱 포지션 진입 및 손절가 공유</p>
                    </div>
                  </div>
                )}

                {communityTab === "likedPosts" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-gray-200 p-4 text-xs">
                      <span className="font-bold text-red-500">♥ 좋아요 표시한 게시글</span>
                      <p className="mt-1 text-sm font-black text-gray-900">
                        ETH/BTC 상대강도 반등 시그널 및 단기 스위칭 전략 공유
                      </p>
                    </div>
                  </div>
                )}

                {communityTab === "likedReplies" && (
                  <div className="py-10 text-center text-xs font-bold text-gray-400">
                    좋아요한 댓글 내역이 없습니다.
                  </div>
                )}

                {communityTab === "reports" && (
                  <div className="space-y-3">
                    {reports.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        접수된 신고 내역이 없습니다.
                      </div>
                    ) : (
                      reports.map(item => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between rounded-xl border border-gray-200 p-4 text-xs"
                        >
                          <div>
                            <span className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">
                              {item.targetType} 신고 · {item.status}
                            </span>
                            <p className="mt-1.5 font-bold text-gray-900">{item.title}</p>
                            <p className="mt-0.5 text-gray-500">사유: {item.reason}</p>
                          </div>
                          <V1Button
                            variant="white"
                            size="xs"
                            onClick={() =>
                              setReports(curr => curr.filter(report => report.id !== item.id))
                            }
                          >
                            신고 취소
                          </V1Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </V1FolderTabs>
            )}
          </div>
        </div>
      </div>

      {/* V1 FollowMembersModal (팔로워 / 팔로잉 목록 모달) */}
      <DimModal
        open={followModalType !== null}
        onClose={() => setFollowModalType(null)}
        title={followModalType === "followers" ? "팔로워 (Followers)" : "팔로잉 (Following)"}
        subtitle="회원 프로필을 클릭해 포트폴리오를 조회하거나 팔로우 상태를 변경할 수 있습니다."
      >
        <ul className="divide-y divide-gray-100">
          {(followModalType === "followers" ? followers : followings).map(person => (
            <li key={person.memberId} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <V1UserAvatar memberId={person.memberId} nickname={person.nickname} size="md" />
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/members/${person.memberId}`}
                      className="text-sm font-bold text-gray-900 hover:text-[#0058FF]"
                      onClick={() => setFollowModalType(null)}
                    >
                      {person.nickname}
                    </Link>
                    {person.followsMe && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                        나를 팔로우 중
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{person.profileMsg}</p>
                </div>
              </div>
              <V1Button
                variant={person.following ? "gray" : "blue"}
                size="xs"
                onClick={() => toggleFollowInModal(person.memberId)}
              >
                {person.following ? "팔로잉" : "팔로우"}
              </V1Button>
            </li>
          ))}
        </ul>
      </DimModal>
    </MemberShell>
  );
}
