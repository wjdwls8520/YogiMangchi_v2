"use client";

import { useState } from "react";
import Link from "next/link";
import { DimModal } from "../features/member/components/dim-modal";

export function SiteFooter() {
  const [modalKind, setModalKind] = useState<"TERMS" | "PRIVACY" | null>(null);

  return (
    <>
      <footer className="site-footer" aria-label="사이트 안내">
        <div className="site-footer-content">
          <div className="site-footer-brand">
            <p className="site-footer-title">
              요기망치 <span>YOGIMANGCHI</span>
            </p>
            <p>실시간 글로벌 경제·암호화폐 속보와 트레이더 커뮤니티, 10,000 USDT 선물 모의투자를 한곳에서 제공합니다.</p>
          </div>
          <div className="site-footer-info">
            <p className="site-footer-heading">
              주요 서비스 <span>바로가기</span>
            </p>
            <ul>
              <li><Link href="/">실시간 메인 포털</Link></li>
              <li><Link href="/news">24시 코인·경제 속보</Link></li>
              <li><Link href="/community">트레이더 커뮤니티 피드</Link></li>
              <li><Link href="/trading">가상 USDT 선물 모의투자</Link></li>
            </ul>
          </div>
          <div className="site-footer-info">
            <p className="site-footer-heading">
              이용 정책 <span>안내</span>
            </p>
            <ul>
              <li>
                <Link href="/terms">이용약관</Link>{" "}
                <button
                  type="button"
                  className="ym-footer-modal-btn"
                  onClick={() => setModalKind("TERMS")}
                >
                  (요약 팝업)
                </button>
              </li>
              <li>
                <Link href="/privacy">개인정보처리방침</Link>{" "}
                <button
                  type="button"
                  className="ym-footer-modal-btn"
                  onClick={() => setModalKind("PRIVACY")}
                >
                  (요약 팝업)
                </button>
              </li>
              <li><Link href="/account">계정·동의 버전 관리</Link></li>
            </ul>
          </div>
          <p className="site-footer-copyright">
            © YOGIMANGCHI. All rights reserved. 본 서비스의 선물 거래는 가상 USDT 기반 모의투자이며 실제 금융투자상품 중개가 아닙니다.
          </p>
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
