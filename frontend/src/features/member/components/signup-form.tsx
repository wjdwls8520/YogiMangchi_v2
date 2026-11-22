"use client";

import { useState, type FormEventHandler } from "react";
import { usePolicies, PolicyConsentControl } from "./policy-controls";
import type { ConsentSelection } from "../api/policies";
import { NicknameInput } from "./nickname-input";
import { NicknameCheck } from "./nickname-check";
import { ProfileImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";

export function SignupForm({
  onSubmit,
  pending,
  defaultNickname = "",
  defaultProfileMessage = "",
  selectedProfileImage,
  onSelectProfileImage,
  showAvatarUpload = true,
  previewOnly = false,
}: {
  onSubmit: FormEventHandler<HTMLFormElement>;
  pending: boolean;
  defaultNickname?: string;
  defaultProfileMessage?: string;
  selectedProfileImage?: SelectedS3File | null;
  onSelectProfileImage?: (file: SelectedS3File | null) => void;
  showAvatarUpload?: boolean;
  previewOnly?: boolean;
}) {
  const policies = usePolicies(), [selection, setSelection] = useState<ConsentSelection>({});
  const [bioLength, setBioLength] = useState(() => Array.from(defaultProfileMessage).length);

  return (
    <form className="member-fields ym-signup-form" onSubmit={onSubmit}>
      <fieldset disabled={pending} className="space-y-6">
        <section
          className="card rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 space-y-6"
          aria-label="기본 정보"
        >
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-black text-gray-900">
              <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
              기본 정보
            </h3>
          </div>

          {showAvatarUpload ? (
            <div className="flex flex-col items-center justify-center">
              <ProfileImageUploadSlot
                slotName="signup-profile-image"
                selectedFile={selectedProfileImage}
                onSelectFile={onSelectProfileImage}
              />
              <p className="mt-2 text-xs font-bold text-gray-400">
                앨범에서 사진 선택 또는 기본 이미지로 시작
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs font-medium text-gray-700">
              프로필 이미지 등록과 최종 약관 동의는 1단계 소셜 본인인증 완료 직후(2단계)에서 안전하게 저장됩니다.
            </div>
          )}

          <div className="ym-field-group">
            <span className="ym-field-title mb-2 block text-sm font-bold text-gray-900">
              닉네임 <em className="ym-required-dot" aria-hidden="true">*</em>
            </span>
            <div className="ym-input-btn-row">
              <label className="ym-input-grow">
                <span className="sr-only">닉네임</span>
                <NicknameInput initialValue={defaultNickname} enforcePattern />
              </label>
              <NicknameCheck />
            </div>
            <small className="ym-helper-primary mt-1.5 block text-xs font-medium">
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
                defaultValue={defaultProfileMessage}
                maxLength={255}
                rows={3}
                placeholder="관심 종목이나 선호하는 트레이딩 스타일을 입력해 주세요."
                onChange={event => setBioLength(Array.from(event.currentTarget.value).length)}
              />
              <small className="mt-1.5 block text-xs text-gray-400">
                선택 · 최대 255자
              </small>
            </label>
          </div>
        </section>

        {!previewOnly && (
          <section
            className="card rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 space-y-5"
            aria-label="필수 약관 및 개인정보 동의"
          >
            <h3 className="flex items-center gap-2 text-lg font-black text-gray-900">
              <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
              필수 약관 및 개인정보 동의
            </h3>
            {policies.isPending && <p role="status" className="member-message">필수 동의 문서를 확인하는 중입니다.</p>}
            {policies.isError && (
              <p role="alert" className="member-message">
                동의 원문과 버전을 확인하지 못해 가입할 수 없습니다.{" "}
                <button type="button" className="account-refresh" onClick={() => void policies.refetch()}>
                  다시 조회
                </button>
              </p>
            )}
            {!policies.isError && policies.data && (
              <PolicyConsentControl
                bundle={policies.data}
                selection={selection}
                onChange={setSelection}
                pending={pending || policies.isFetching}
              />
            )}
          </section>
        )}

        <button
          type="submit"
          className="member-primary login-button"
          disabled={previewOnly ? pending : (pending || policies.isFetching || !policies.data || policies.isError)}
        >
          {previewOnly ? "입력값 임시 저장 후 상단 소셜 인증 안내" : pending ? "가입 처리 중…" : "동의하고 가입하기"}
        </button>
      </fieldset>
    </form>
  );
}
