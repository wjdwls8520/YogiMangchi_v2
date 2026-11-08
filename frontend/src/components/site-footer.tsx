"use client";

import { useState } from "react";
import Link from "next/link";
import { DimModal } from "../features/member/components/dim-modal";

export function SiteFooter() {
  const [modalKind, setModalKind] = useState<"TERMS" | "PRIVACY" | null>(null);

  return (
    <>
      <footer
        className="site-footer border-t border-gray-200 bg-gray-100 py-8 text-xs text-gray-500 transition-colors duration-200"
        aria-label="사이트 안내"
      >
        <div className="site-footer-content mx-auto max-w-[1280px] px-4 md:px-6">
          {/* 상단 영역: 로고 및 약관 링크 */}
          <div className="mb-6 flex flex-col items-start justify-between gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/logo.webp"
                alt="요기망치 YOGIMANGCHI"
                className="ym-footer-logo-img h-7 w-auto object-contain"
              />
              <span className="sr-only">
                요기망치 <span>YOGIMANGCHI</span>
              </span>
              <span className="text-xs font-medium text-gray-400">
                투자의 기준을 세우다
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs sm:gap-6">
              <div className="inline-flex items-center gap-1">
                <Link
                  href="/terms"
                  className="font-medium text-gray-500 transition-colors hover:text-gray-900"
                >
                  이용약관
                </Link>
                <button
                  type="button"
                  className="ym-footer-modal-btn text-[11px] font-bold text-[#0058FF] hover:underline"
                  onClick={() => setModalKind("TERMS")}
                >
                  (요약)
                </button>
              </div>
              <div className="inline-flex items-center gap-1">
                <Link
                  href="/privacy"
                  className="font-bold text-gray-700 transition-colors hover:text-gray-900"
                >
                  개인정보처리방침
                </Link>
                <button
                  type="button"
                  className="ym-footer-modal-btn text-[11px] font-bold text-[#0058FF] hover:underline"
                  onClick={() => setModalKind("PRIVACY")}
                >
                  (요약)
                </button>
              </div>
              <Link
                href="/trading"
                className="font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                모의투자
              </Link>
              <Link
                href="/contest"
                className="font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                대회
              </Link>
              <Link
                href="/community"
                className="font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                커뮤니티
              </Link>
              <Link
                href="/news"
                className="font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                실시간 뉴스
              </Link>
              <Link
                href="/me"
                className="font-medium text-gray-500 transition-colors hover:text-gray-900"
              >
                마이페이지
              </Link>
            </div>
          </div>

          {/* 중단 영역: 서비스 면책 조항 및 안내 */}
          <div className="mb-6 space-y-2 leading-relaxed">
            <p className="font-semibold text-gray-600">
              [모의투자 서비스 이용 안내 및 면책 조항]
            </p>
            <p>
              요기망치에서 제공하는 모든 투자 시스템 및 자산(USDT/포인트 등)은 실제 화폐 가치가 없는{" "}
              <strong>100% 가상의 모의투자 데이터</strong>입니다. 당사는 실제 암호화폐의 매매, 중개, 알선 행위를 일절 하지 않으며, 서비스 내의 가상 수익은 실제 금전이나 현물로 환전 및 출금될 수 없습니다.
            </p>
            <p>
              본 서비스에서 제공되는 시세 정보 및 커뮤니티의 게시글은 투자 참고용일 뿐이며, 실제 투자 권유나 자문을 의미하지 않습니다. 실제 투자의 최종 판단과 책임은 투자자 본인에게 있으며, 당사는 사용자의 실제 투자 결과에 대해 어떠한 법적 책임도 지지 않습니다.
            </p>
          </div>

          {/* 하단 영역: 저작권 및 팀 정보 */}
          <div className="flex flex-col justify-between gap-2 text-[11px] text-gray-400 sm:flex-row">
            <div>
              <span>운영팀: 요기망치 | 이메일: contact@yogimangchi.com</span>
            </div>
            <div className="site-footer-copyright">
              Copyright © {new Date().getFullYear()} YOGIMANGCHI. All rights reserved.
            </div>
          </div>
        </div>
      </footer>

      <DimModal
        open={modalKind !== null}
        onClose={() => setModalKind(null)}
        title={modalKind === "TERMS" ? "요기망치 이용약관 핵심 안내" : "요기망치 개인정보처리방침 핵심 안내"}
        subtitle="팝업 오픈 시 배경 스크롤이 현재 위치에서 잠기며 닫을 때 복원됩니다."
        footer={
          <div className="ym-modal-actions">
            <Link
              href={modalKind === "TERMS" ? "/terms" : "/privacy"}
              className="signup-button ym-btn-inline"
              onClick={() => setModalKind(null)}
            >
              전체 원문 페이지 열기
            </Link>
            <button
              type="button"
              className="login-button ym-btn-inline"
              onClick={() => setModalKind(null)}
            >
              확인 후 닫기
            </button>
          </div>
        }
      >
        {modalKind === "TERMS" ? (
          <div className="ym-modal-prose">
            <p>
              <strong>제1조 (목적 및 서비스 성격)</strong> 요기망치는 가상 USDT(기본 10,000 USDT)를 활용한 암호화폐 선물 모의투자와 실시간 경제·암호화폐 뉴스, 트레이더 커뮤니티 기능을 제공합니다.
            </p>
            <p>
              <strong>제2조 (모의투자 원장 및 서버 기준 정합성)</strong> 모든 주문 가격, 체결, 증거금, 격리마진 강제청산은 Trading Server의 원장 기준으로 처리되며 실제 금전 입출금을 수반하지 않습니다.
            </p>
            <p>
              <strong>제3조 (계정 분리 원칙)</strong> Guest 체험 기록과 Google·Kakao 회원 계정의 모의투자 기록은 서로 독립되어 자동으로 병합되지 않습니다.
            </p>
          </div>
        ) : (
          <div className="ym-modal-prose">
            <p>
              <strong>1. 수집 항목</strong> Google 또는 Kakao OAuth2 식별자, 닉네임(1~8자), 프로필 소개, 필수 약관 동의 버전 및 동의 시각.
            </p>
            <p>
              <strong>2. 인증 및 보안</strong> 별도 비밀번호를 저장하지 않으며 RS256 Access JWT(메모리) 및 HttpOnly Refresh 쿠키 회전 정책을 적용합니다.
            </p>
            <p>
              <strong>3. 회원 탈퇴 시 처리</strong> 탈퇴 시 개인정보 및 OAuth 연결은 즉시 해지되며, 보존이 필요한 커뮤니티 작성물은 작성자 표기를 ‘탈퇴한회원’으로 전환하여 유지합니다.
            </p>
          </div>
        )}
      </DimModal>
    </>
  );
}
