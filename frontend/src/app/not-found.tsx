import Link from "next/link";
import { V1Header } from "@/features/member/components/v1-ui";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900">
      <V1Header theme="light" />
      <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8">
          <span className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-50 px-4 text-sm font-black tracking-wider text-[#0058FF]">
            404 NOT FOUND
          </span>
          <h1 className="mt-5 text-2xl font-black tracking-tight text-gray-900">
            요청하신 페이지를 찾을 수 없습니다
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            주소가 잘못 입력되었거나 삭제·이동된 페이지입니다. 아래 메뉴를 통해 원하시는 화면으로 이동해 주세요.
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0046CC]"
            >
              홈으로 이동
            </Link>
            <Link
              href="/trading"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              모의투자 바로가기
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
