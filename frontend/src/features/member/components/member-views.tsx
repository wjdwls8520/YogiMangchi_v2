"use client";

import Link from "next/link";
import { useState, type ReactNode, type FormEventHandler } from "react";
import { NicknameCheck } from "./nickname-check";
import { NicknameInput } from "./nickname-input";
import { DimModal } from "./dim-modal";
import { V1Header } from "./v1-ui";
export { SignupForm } from "./signup-form";

export function MemberShell({
  title,
  subtitle,
  variant = "default",
  hideCardHeading = false,
  children,
}: {
  title: string;
  subtitle?: string;
  variant?: "auth" | "signup" | "default" | "wide" | "portal";
  hideCardHeading?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={`member-shell ym-shell-${variant} min-h-screen bg-[#F9FAFB] text-gray-900`} data-shell-variant={variant}>
      <V1Header theme="light" />

      <div className={`ym-page-container ym-container-${variant} mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 md:py-12`}>
        <section className={`member-card ym-card-${variant}`}>
          {!hideCardHeading && (
            <div className="ym-card-heading mb-6">
              <h1 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">{title}</h1>
              {subtitle && <p className="ym-card-subtitle mt-1.5 break-keep text-sm font-medium text-gray-500">{subtitle}</p>}
            </div>
          )}
          {hideCardHeading && <h1 className="sr-only">{title}</h1>}
          {children}
        </section>
      </div>
    </main>
  );
}

export function MemberLoginView({ google, kakao }: { google: string; kakao: string }) {
  const [rememberSession, setRememberSession] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="member-fields ym-login-container mx-auto w-full max-w-[520px] break-keep rounded-[24px] border border-gray-200 bg-white p-6 sm:px-10 sm:py-9">
      <div className="ym-login-logo-wrap mb-4 flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.webp" alt="요기망치 로고" className="ym-login-logo-img h-10 w-auto object-contain" />
      </div>

      <div className="ym-login-intro mb-6 text-center">
        <p className="ym-login-lead break-keep text-lg font-black text-gray-900 sm:whitespace-nowrap">
          Google 또는 Kakao 계정으로 간편하게 시작하세요
        </p>
        <p className="ym-login-sub mt-1.5 break-keep text-xs font-medium leading-relaxed text-gray-500">
          요기망치는 별도 비밀번호를 저장하지 않고 소셜 계정으로 모의투자·커뮤니티·뉴스·자산을 연결합니다.
        </p>
      </div>

      <div className="ym-login-primary-buttons flex flex-col gap-3">
        <a
          className="member-secondary ym-kakao-cta flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] px-5 text-sm font-bold text-[#191919] transition-colors hover:bg-[#E6CF00]"
          href={kakao}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#191919] text-[10px] font-black text-[#FEE500]">
            K
          </span>
          Kakao로 계속하기
        </a>
        <a
          className="member-primary login-button flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
          href={google}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-black text-[#0058FF]">
            G
          </span>
          Google로 계속하기
        </a>
      </div>

      <div className="ym-login-option-box mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 sm:flex-nowrap">
        <label className="ym-custom-check flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            name="rememberSession"
            checked={rememberSession}
            onChange={event => setRememberSession(event.currentTarget.checked)}
          />
          <span className="sm:whitespace-nowrap">로그인 상태 유지</span>
        </label>
        <button
          type="button"
          className="ym-text-link-btn shrink-0 whitespace-nowrap font-bold text-[#0058FF] hover:underline"
          onClick={() => setHelpOpen(true)}
        >
          이용 안내 / 도움말
        </button>
      </div>

      <div className="ym-login-bottom mt-6 flex flex-col gap-3 border-t border-gray-100 pt-5 text-center">
        <p className="member-note break-keep text-xs leading-relaxed text-gray-400">
          최초 소셜 로그인 시 약관 동의 및 닉네임 설정 단계로 자동 연결됩니다.{" "}
          <br className="hidden sm:block" />
          Guest 모의투자 기록은 회원 계정에 자동으로 합쳐지지 않습니다.
        </p>
        <Link href="/trading" className="ym-guest-return-link text-xs font-bold text-[#0058FF] hover:underline">
          게스트 모의투자로 바로 체험하기 →
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
            <strong>1. 지원 로그인 수단</strong> 요기망치는 Google 및 Kakao 소셜 로그인만 지원하며, 별도의 아이디/비밀번호 입력을 요구하지 않습니다.
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

  return (
    <form className="member-fields ym-profile-edit-form space-y-6" onSubmit={onSubmit}>
      <fieldset disabled={pending} className="space-y-6">
        <div className="ym-field-group">
          <span className="ym-field-title mb-2 block text-sm font-bold text-gray-900">닉네임</span>
          <div className="ym-input-btn-row flex gap-2">
            <label className="ym-input-grow flex-1">
              <span className="sr-only">닉네임</span>
              <NicknameInput initialValue={nickname} />
            </label>
            <NicknameCheck />
          </div>
          <small className="ym-helper-violet mt-1.5 block text-xs font-medium text-gray-500">
            최대 8자 · 공백·특수문자 제외
          </small>
        </div>

        <div className="ym-field-group">
          <label className="ym-label-block block">
            <span className="ym-field-title-row mb-2 flex items-center justify-between">
              <span className="ym-field-title text-sm font-bold text-gray-900">프로필 메시지 (소개)</span>
              <span className="ym-char-counter text-xs font-bold text-gray-400">{bioLength} / 255자</span>
            </span>
            <textarea
              name="profileMessage"
              className="myTextarea w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
              defaultValue={message}
              maxLength={255}
              rows={3}
              placeholder="나를 표현하는 한 줄 메시지를 적어주세요"
              onChange={event => setBioLength(Array.from(event.currentTarget.value).length)}
            />
            <small className="mt-1.5 block text-xs text-gray-400">
              최대 255자 · 비워서 저장하면 소개를 지웁니다.
            </small>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <Link
            href="/me"
            className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-gray-300 bg-white text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            취소
          </Link>
          <button
            className="member-primary login-button flex h-12 flex-1 items-center justify-center rounded-2xl bg-[#0058FF] text-sm font-bold text-white transition-colors hover:bg-blue-700"
            type="submit"
          >
            {pending ? "저장 중…" : "변경사항 저장"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
