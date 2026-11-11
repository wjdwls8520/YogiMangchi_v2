"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ContentApiError, contentMessage } from "../api/client";
import { MemberErrorActions } from "./member-error-actions";
import { parseOwnProfile } from "../api/contracts";
import { nicknameIssue } from "../api/nickname";
import { useMember, MemberLogout } from "./member-provider";
import { MemberShell, ProfileEditForm } from "./member-views";
import { MemberWithdrawal } from "./member-withdrawal";
import { MemberConsents } from "./member-consents";
import { ProfileImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";
import { syncContestAccountNickname } from "../../contest/api/contest-client";

export function MemberAccount() {
  const { session, snapshot } = useMember();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const [requestError, setRequestError] = useState<ContentApiError | null>(null);
  const [selectedProfileImage, setSelectedProfileImage] = useState<SelectedS3File | null>(null);
  const [resetProfileImage, setResetProfileImage] = useState(false);

  const profile = useQuery({
    queryKey: ["member", "own", snapshot.memberId, snapshot.generation],
    enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) =>
      parseOwnProfile(await session.request("/members/me", { signal }), snapshot.memberId!),
  });

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || snapshot.phase !== "ready") return;
    const data = new FormData(event.currentTarget);
    const nickname = String(data.get("nickname") ?? "");
    const profileMessage = String(data.get("profileMessage") ?? "");
    const nicknameChanged = nickname !== profile.data?.nickname;
    const nicknameError = nicknameChanged ? nicknameIssue(nickname) : null;
    if (nicknameError || profileMessage.length > 255) {
      setError(nicknameError ?? "소개는 최대 255자로 입력해 주세요.");
      return;
    }
    active.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    setRequestError(null);
    try {
      let updated;
      if (selectedProfileImage?.rawFile) {
        const formData = new FormData();
        if (nicknameChanged) formData.append("nickname", nickname);
        formData.append("profileMessage", profileMessage);
        formData.append("profileImage", selectedProfileImage.rawFile);
        updated = parseOwnProfile(
          await session.request("/members/me/profile", {
            method: "PATCH",
            body: formData,
          }),
          snapshot.memberId!,
        );
      } else if (resetProfileImage) {
        updated = parseOwnProfile(
          await session.request("/members/me/profile", {
            method: "PATCH",
            body: {
              ...(nicknameChanged ? { nickname } : {}),
              profileMessage,
              resetProfileImage: true,
            },
          }),
          snapshot.memberId!,
        );
      } else {
        updated = parseOwnProfile(
          await session.request("/members/me/profile", {
            method: "PATCH",
            body: { ...(nicknameChanged ? { nickname } : {}), profileMessage },
          }),
          snapshot.memberId!,
        );
      }
      session.setNickname(updated.nickname, snapshot.memberId!, snapshot.generation);
      if (nicknameChanged) {
        await session
          .authorized(cred => syncContestAccountNickname(updated.nickname, cred.accessToken), false)
          .catch(() => {});
      }
      setSelectedProfileImage(null);
      setResetProfileImage(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["member"] }),
        client.invalidateQueries({ queryKey: ["community"] }),
        client.invalidateQueries({ queryKey: ["community-posts"] }),
        client.invalidateQueries({ queryKey: ["community-post-detail"] }),
        client.invalidateQueries({ queryKey: ["community-comments"] }),
        client.invalidateQueries({ queryKey: ["contest-sidebar-member-profile"] }),
        client.invalidateQueries({ queryKey: ["contest-member-profile"] }),
        client.invalidateQueries({ queryKey: ["community-sidebar-contest-top5"] }),
      ]);
      setMessage("프로필을 저장했습니다.");
    } catch (err) {
      setError(contentMessage(err));
      setRequestError(err instanceof ContentApiError ? err : null);
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return (
    <MemberShell
      title="회원정보 수정"
      subtitle="기본 프로필 이미지, 닉네임, 프로필 메시지 및 약관 동의·회원 탈퇴를 관리합니다."
      variant="default"
      hideCardHeading
    >
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
            회원정보 수정
          </h2>
        </div>

        {/* V1 기본 정보 카드 (아바타 업로더 + 닉네임 + 프로필 메시지) */}
        <section
          className="card rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 space-y-8"
          aria-label="기본 정보"
        >
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-black text-gray-900">
              <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
              기본 정보
            </h3>
          </div>

          <div className="flex flex-col items-center justify-center">
            <ProfileImageUploadSlot
              slotName="account-profile-image"
              currentImageUrl={profile.data?.profileImgUrl ?? null}
              memberId={profile.data?.memberId ?? snapshot.memberId}
              nickname={profile.data?.nickname}
              selectedFile={selectedProfileImage}
              resetRequested={resetProfileImage}
              onSelectFile={file => {
                setSelectedProfileImage(file);
                if (file) setResetProfileImage(false);
              }}
              onRequestReset={reset => {
                setResetProfileImage(reset);
                if (reset) setSelectedProfileImage(null);
              }}
            />
            <p className="mt-2 text-xs font-bold text-gray-400">
              앨범에서 사진 선택 또는 기본 이미지로 변경
            </p>
          </div>

          {snapshot.phase !== "ready" ? (
            <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-5 space-y-4">
              <p role="status" className="member-message text-sm font-bold text-gray-700">
                {snapshot.phase === "loading" || snapshot.phase === "authenticating"
                  ? "로그인 상태를 확인하는 중입니다."
                  : snapshot.phase === "recovering"
                    ? "세션 복구 대기 중입니다. 기존 회원 정보는 보존하며 보호 요청은 인증 확인 후 재개합니다."
                    : snapshot.phase === "error"
                      ? "회원 연결을 확인하지 못했습니다."
                      : snapshot.phase === "withdrawing"
                        ? "탈퇴 진행 상태를 확인하는 중입니다. 완료 전까지 회원 기능은 중단됩니다."
                        : "로그인이 필요합니다."}
              </p>
              {snapshot.phase !== "withdrawing" && (
                <div className="member-actions flex gap-2">
                  <Link
                    href="/login"
                    className="login-button inline-flex h-10 items-center justify-center rounded-xl bg-[#0058FF] px-5 text-xs font-bold text-white"
                  >
                    로그인
                  </Link>
                </div>
              )}
              {snapshot.phase === "error" && (
                <div className="member-actions flex gap-2">
                  <button
                    className="member-secondary rounded-xl border border-gray-300 bg-white px-4 py-2 text-xs font-bold"
                    onClick={() => void session.restore().catch(() => {})}
                  >
                    로그인 다시 확인
                  </button>
                  <MemberLogout />
                </div>
              )}
            </div>
          ) : (
            <>
              {profile.isPending && (
                <p role="status" className="member-message text-xs text-gray-500">
                  프로필을 불러오는 중입니다.
                </p>
              )}
              {profile.isError && (
                <p role="alert" className="member-message text-xs text-red-600">
                  {contentMessage(profile.error)}{" "}
                  <button className="account-refresh underline font-bold" onClick={() => void profile.refetch()}>
                    다시 조회
                  </button>
                </p>
              )}
              {profile.data && (
                <div className="space-y-6">
                  <ProfileEditForm
                    key={`${profile.data.nickname}:${profile.data.profileMessage}`}
                    nickname={profile.data.nickname}
                    message={profile.data.profileMessage}
                    pending={pending}
                    onSubmit={event => void save(event)}
                  />
                </div>
              )}
              {message && (
                <p role="status" className="member-message is-available rounded-xl bg-blue-50 p-3 text-xs font-bold text-[#0058FF]">
                  {message}
                </p>
              )}
              {error && (
                <>
                  <p role="alert" className="member-message rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">
                    {error}
                  </p>
                  <MemberErrorActions
                    error={requestError}
                    checking={pending || profile.isFetching}
                    onCheck={() => void profile.refetch()}
                  />
                </>
              )}
            </>
          )}
        </section>

        {/* 약관 동의 버전 관리 (로그인 시 표시) */}
        {snapshot.phase === "ready" && profile.data && (
          <section className="card rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
            <MemberConsents />
          </section>
        )}

        {/* 회원 탈퇴 섹션 */}
        <section
          id="withdrawal"
          className="card rounded-2xl border border-gray-200 bg-white p-6 sm:p-8"
        >
          <MemberWithdrawal />
        </section>
      </div>
    </MemberShell>
  );
}
