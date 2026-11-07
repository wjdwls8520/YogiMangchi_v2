"use client";

import Link from "next/link";
import { useState, type ReactNode, type FormEventHandler } from "react";
import { NicknameCheck } from "./nickname-check";
import { NicknameInput } from "./nickname-input";
import { DimModal } from "./dim-modal";
export { SignupForm } from "./signup-form";

export function MemberShell({
  title,
  subtitle,
  variant = "default",
  children,
}: {
  title: string;
  subtitle?: string;
  variant?: "auth" | "signup" | "default" | "wide" | "portal";
  children: ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <main className={`member-shell ym-shell-${variant}`} data-shell-variant={variant}>
      <header className="ym-gnb-header">
        <div className="ym-gnb-inner">
          <div className="ym-gnb-left">
            <Link href="/" className="member-logo">
              요기망치 <span className="ym-logo-en">YOGIMANGCHI</span>
            </Link>
            <nav aria-label="회원 메뉴" className="ym-gnb-nav">
              <Link href="/">홈</Link>
              <Link href="/news">실시간 뉴스</Link>
              <Link href="/community">커뮤니티</Link>
              <Link href="/trading">모의투자</Link>
              <Link href="/account">내 계정</Link>
            </nav>
          </div>
          <div className="ym-gnb-right">
            <Link href="/trading" className="ym-gnb-SimBadge">
              10,000 USDT 모의선물
            </Link>
            <Link href="/login" className="ym-gnb-login-pill">
              로그인
            </Link>
            <Link href="/signup" className="ym-gnb-signup-link">
              회원가입
            </Link>
            <button
              type="button"
              className="ym-gnb-hamburger"
              aria-label="전체 메뉴 열기"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(true)}
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      <div className={`ym-page-container ym-container-${variant}`}>
        <section className={`member-card ym-card-${variant}`}>
          <div className="ym-card-heading">
            <h1>{title}</h1>
            {subtitle && <p className="ym-card-subtitle">{subtitle}</p>}
          </div>
          {children}
        </section>
      </div>

      <DimModal
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        title="요기망치 전체 메뉴"
        subtitle="원하시는 서비스 화면으로 빠르게 이동하세요."
        maxWidth="420px"
      >
        <nav aria-label="모바일 전체 메뉴" className="ym-mobile-drawer-nav">
          <Link href="/" onClick={() => setMobileMenuOpen(false)}>홈 · 실시간 마켓 포털</Link>
          <Link href="/news" onClick={() => setMobileMenuOpen(false)}>실시간 뉴스 · 24시 코인니스형 속보</Link>
          <Link href="/community" onClick={() => setMobileMenuOpen(false)}>커뮤니티 · 토스증권형 트레이더 피드</Link>
          <Link href="/trading" onClick={() => setMobileMenuOpen(false)}>모의투자 · 10,000 USDT 선물 터미널</Link>
          <Link href="/account" onClick={() => setMobileMenuOpen(false)}>내 계정 · 프로필 및 회차 관리</Link>
          <div className="ym-mobile-drawer-auth">
            <Link href="/login" className="login-button" onClick={() => setMobileMenuOpen(false)}>
              로그인
            </Link>
            <Link href="/signup" className="signup-button" onClick={() => setMobileMenuOpen(false)}>
              회원가입
            </Link>
          </div>
        </nav>
      </DimModal>
    </main>
  );
}

export function MemberLoginView({ google, kakao }: { google: string; kakao: string }) {
  const [rememberSession, setRememberSession] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="member-fields ym-login-container">
      <div className="ym-login-intro">
        <p className="ym-login-lead">Google 또는 Kakao 계정으로 로그인하세요.</p>
        <p className="ym-login-sub">
          요기망치는 별도 비밀번호를 저장하지 않고 OAuth2 인증으로 실시간 속보·커뮤니티·선물 모의투자를 연결합니다.
        </p>
      </div>

      <div className="ym-login-primary-buttons">
        <a className="member-primary login-button" href={google}>
          Google로 계속하기
        </a>
        <a className="member-secondary ym-kakao-cta" href={kakao}>
          Kakao로 계속하기
        </a>
      </div>

      <div className="ym-login-option-box">
        <label className="ym-custom-check">
          <input
            type="checkbox"
            name="rememberSession"
            checked={rememberSession}
            onChange={event => setRememberSession(event.currentTarget.checked)}
          />
          <span>로그인 상태 유지 안내 확인 (7일 Refresh 쿠키)</span>
        </label>
        <button
          type="button"
          className="ym-text-link-btn"
          onClick={() => setHelpOpen(true)}
        >
          이용 안내 / 도움말
        </button>
      </div>

      <div className="ym-sns-divider" role="separator" aria-label="SNS 간편로그인">
        <span>SNS 간편로그인</span>
      </div>

      <div className="ym-sns-icon-row">
        <a
          href={kakao}
          className="ym-sns-circle is-kakao"
          aria-label="카카오 간편로그인"
          title="Kakao 간편로그인"
        >
          <span aria-hidden="true">K</span>
        </a>
        <a
          href={google}
          className="ym-sns-circle is-google"
          aria-label="구글 간편로그인"
          title="Google 간편로그인"
        >
          <span aria-hidden="true">G</span>
        </a>
      </div>

      <div className="ym-login-bottom">
        <Link href="/signup" className="signup-button">
          회원가입
        </Link>
        <p className="member-note">Guest 모의투자 기록은 회원 계정에 자동으로 합쳐지지 않습니다.</p>
        <Link href="/trading" className="ym-guest-return-link">
          게스트 모의투자로 돌아가기
        </Link>
      </div>

      <DimModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="소셜 로그인 및 계정 이용 안내"
        subtitle="요기망치 회원 인증 및 Guest 계정 분리 정책"
        footer={
          <button type="button" className="login-button ym-btn-inline" onClick={() => setHelpOpen(false)}>
            확인
          </button>
        }
      >
        <div className="ym-modal-prose">
          <p>
            <strong>1. 지원 로그인 수단</strong> 요기망치는 Google 및 Kakao 공식 OAuth2 인증만 지원하며, 별도의 아이디/비밀번호 입력을 요구하지 않습니다.
          </p>
          <p>
            <strong>2. 신규 가입 절차</strong> 처음 로그인하는 소셜 계정은 약관 동의 및 닉네임(1~8자) 설정 화면으로 자동 이동합니다.
          </p>
          <p>
            <strong>3. 모의투자 자산 분리</strong> 비회원(Guest)으로 진행한 10,000 USDT 체험 기록과 회원 계정의 선물 모의투자 원장은 서로 독립적으로 관리됩니다.
          </p>
        </div>
      </DimModal>
    </div>
  );
}

const INTEREST_SYMBOLS = ["BTC", "ETH", "SOL", "XRP"] as const;

export function ProfileEditForm({
  nickname,
  message,
  pending,
  onSubmit,
}: {
  nickname: string;
  message: string;
  pending: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const [bioLength, setBioLength] = useState(() => Array.from(message).length);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["BTC", "ETH"]);

  function toggleSymbol(symbol: string) {
    setSelectedSymbols(current =>
      current.includes(symbol) ? current.filter(item => item !== symbol) : [...current, symbol],
    );
  }

  return (
    <form className="member-fields ym-profile-edit-form" onSubmit={onSubmit}>
      <fieldset disabled={pending}>
        <div className="ym-field-group">
          <span className="ym-field-title">닉네임</span>
          <div className="ym-input-btn-row">
            <label className="ym-input-grow">
              <span className="sr-only">닉네임</span>
              <NicknameInput initialValue={nickname} />
            </label>
            <NicknameCheck />
          </div>
          <small className="ym-helper-violet">최대 8자 · 공백·특수문자 제외</small>
        </div>

        <div className="ym-field-group">
          <label className="ym-label-block">
            <span className="ym-field-title-row">
              <span className="ym-field-title">소개</span>
              <span className="ym-char-counter">{bioLength} / 255자</span>
            </span>
            <textarea
              name="profileMessage"
              className="myTextarea"
              defaultValue={message}
              maxLength={255}
              rows={4}
              placeholder="트레이딩 관점이나 자기소개를 입력해 주세요."
              onChange={event => setBioLength(Array.from(event.currentTarget.value).length)}
            />
            <small>최대 255자 · 비워서 저장하면 소개를 지웁니다.</small>
          </label>
        </div>

        <div className="ym-field-group">
          <span className="ym-field-title">관심 선물 종목 배지 설정</span>
          <div className="ym-chip-row" role="group" aria-label="관심 선물 종목 선택">
            {INTEREST_SYMBOLS.map(symbol => {
              const active = selectedSymbols.includes(symbol);
              return (
                <button
                  key={symbol}
                  type="button"
                  aria-pressed={active}
                  className={active ? "ym-tag-chip is-active" : "ym-tag-chip"}
                  onClick={() => toggleSymbol(symbol)}
                >
                  #{symbol}
                </button>
              );
            })}
          </div>
          <small>커뮤니티 피드와 뉴스 필터에서 기본 관심 종목으로 활용됩니다.</small>
        </div>

        <button className="member-primary login-button" type="submit">
          {pending ? "저장 중…" : "프로필 저장"}
        </button>
      </fieldset>
    </form>
  );
}
