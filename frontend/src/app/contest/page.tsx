import Link from "next/link";
import { MemberShell } from "../../features/member/components/member-views";

export default function ContestPage() {
  return (
    <MemberShell
      title="실전 모의투자 대회"
      subtitle="시즌별 가상 USDT 선물 수익률 랭킹전 안내"
      variant="wide"
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-3xl bg-[#0F172A] p-8 text-white sm:p-12">
          <span className="inline-flex rounded-full bg-blue-500/20 px-3 py-1 text-xs font-bold text-blue-300">
            SEASON CONTEST · 준비중
          </span>
          <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-4xl">
            요기망치 선물 모의투자 정규 시즌 대회 준비중
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-300 sm:text-base">
            모든 참가자에게 동일한 대회 전용 시드머니를 지급하고, 시즌 기간 동안의 선물 모의투자 수익률(ROI)로
            실시간 랭킹을 산정하는 대회가 곧 오픈됩니다.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/trading"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-sm font-bold text-white hover:bg-blue-700"
            >
              모의투자에서 먼저 연습하기
            </Link>
            <Link
              href="/community"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-bold text-white hover:bg-white/10"
            >
              커뮤니티 TOP5 랭킹 보기
            </Link>
          </div>
        </section>
      </div>
    </MemberShell>
  );
}
