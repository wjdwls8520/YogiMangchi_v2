"use client";

import { useState, type FormEventHandler } from "react";
import { usePolicies, PolicyConsentControl } from "./policy-controls";
import type { ConsentSelection } from "../api/policies";
import { NicknameInput } from "./nickname-input";
import { NicknameCheck } from "./nickname-check";
import { ProfileImageUploadSlot } from "./s3-upload-slot";

export function SignupForm({ onSubmit, pending }: { onSubmit: FormEventHandler<HTMLFormElement>; pending: boolean }) {
  const policies = usePolicies(), [selection, setSelection] = useState<ConsentSelection>({});
  const [bioLength, setBioLength] = useState(0);

  return (
    <form className="member-fields ym-signup-form" onSubmit={onSubmit}>
      <fieldset disabled={pending}>
        <div className="ym-field-group">
          <span className="ym-field-title">닉네임 <em className="ym-required-dot" aria-hidden="true">*</em></span>
          <div className="ym-input-btn-row">
            <label className="ym-input-grow">
              <span className="sr-only">닉네임</span>
              <NicknameInput />
            </label>
            <NicknameCheck />
          </div>
          <small className="ym-helper-violet">최대 8자 · 공백·특수문자 제외</small>
        </div>

        <div className="ym-field-group">
          <span className="ym-field-title">프로필 이미지 등록</span>
          <ProfileImageUploadSlot slotName="signup-profile-image" compact />
        </div>

        <div className="ym-field-group">
          <label className="ym-label-block">
            <span className="ym-field-title-row">
              <span className="ym-field-title">트레이더 한줄 소개</span>
              <span className="ym-char-counter">{bioLength} / 255자</span>
            </span>
            <textarea
              name="profileMessage"
              className="myTextarea"
              maxLength={255}
              rows={3}
              placeholder="관심 종목이나 선호하는 트레이딩 스타일을 입력해 주세요."
              onChange={event => setBioLength(Array.from(event.currentTarget.value).length)}
            />
            <small>선택 · 최대 255자</small>
          </label>
        </div>

        <div className="ym-policy-box">
          <span className="ym-field-title">필수 약관 및 개인정보 동의</span>
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
        </div>

        <button
          type="submit"
          className="member-primary login-button"
          disabled={pending || policies.isFetching || !policies.data || policies.isError}
        >
          {pending ? "가입 처리 중…" : "동의하고 가입하기"}
        </button>
      </fieldset>
    </form>
  );
}
