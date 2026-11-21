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
import { DimModal } from "./dim-modal";
import { ProfileImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";
import { syncContestAccountNickname } from "../../contest/api/contest-client";
import { resolveTradingMarketBaseUrl } from "../api/market-overview";
import { tradingJson } from "../../trading/api/client";
import { parsePortfolioVisibility } from "../../trading/api/take-profit-contract";

export function MemberAccount() {
  const { session, snapshot, announce } = useMember();
  const tradingBase = resolveTradingMarketBaseUrl();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const [requestError, setRequestError] = useState<ContentApiError | null>(null);
  const [selectedProfileImage, setSelectedProfileImage] = useState<SelectedS3File | null>(null);
  const [resetProfileImage, setResetProfileImage] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityFeedback, setVisibilityFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [logoutAllBusy, setLogoutAllBusy] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: ["member", "own", snapshot.memberId, snapshot.generation],
    enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) =>
      parseOwnProfile(await session.request("/members/me", { signal }), snapshot.memberId!),
  });

  const portfolioVisibilityQuery = useQuery({
    queryKey: ["member", "portfolio-visibility", snapshot.memberId, snapshot.generation],
    enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) =>
      parsePortfolioVisibility(
        await session.authorized(cred =>
          tradingJson(tradingBase, "account/portfolio-visibility", {
            token: cred.accessToken,
            signal,
          }),
          true,
        ),
      ),
  });

  async function togglePortfolioVisibility(nextPublic: boolean) {
    if (visibilityBusy || snapshot.phase !== "ready") return;
    setVisibilityBusy(true);
    setVisibilityFeedback(null);
    try {
      const updated = parsePortfolioVisibility(
        await session.authorized(cred =>
          tradingJson(tradingBase, "account/portfolio-visibility", {
            method: "PUT",
            token: cred.accessToken,
            body: { portfolioPublic: nextPublic },
          }),
        ),
      );
      client.setQueryData(
        ["member", "portfolio-visibility", snapshot.memberId, snapshot.generation],
        updated,
      );
      await client.invalidateQueries({ queryKey: ["member", "public-portfolio"] });
      setVisibilityFeedback({
        kind: "ok",
        text: updated.portfolioPublic
          ? "공개 프로필에 모의투자 포트폴리오가 표시됩니다."
          : "공개 프로필에서 모의투자 포트폴리오를 비공개로 전환했습니다.",
      });
    } catch {
      setVisibilityFeedback({
        kind: "error",
        text: "포트폴리오 공개 설정을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function handleLogoutAll() {
    if (logoutAllBusy) return;
    setLogoutAllBusy(true);
    setLogoutAllError(null);
    try {
      const request = session.logoutAll();
      announce("ended");
      await request;
      setLogoutAllOpen(false);
    } catch (err) {
      setLogoutAllError(contentMessage(err));
    } finally {
      setLogoutAllBusy(false);
    }
  }

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

        {/* 공개 포트폴리오 노출 설정 & 세션 보안 (로그인 시 표시) */}
        {snapshot.phase === "ready" && (
          <section
            className="card rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 space-y-6"
            aria-label="공개 포트폴리오 및 세션 보안 설정"
          >
            <div>
              <h3 className="flex items-center gap-2 text-lg font-black text-gray-900">
                <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
                공개 포트폴리오 &amp; 보안 설정
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                다른 회원에게 보여지는 포트폴리오 공개 여부와 활성 로그인 기기 세션을 관리합니다.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-[#F9FAFB] p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900">
                  공개 프로필 모의투자 포트폴리오 공개
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  비공개로 전환하면 본인과 관리자를 제외한 다른 회원은 보유 포지션과 수익률을 볼 수 없습니다.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {portfolioVisibilityQuery.isPending ? (
                  <span className="text-xs font-bold text-gray-400">조회 중…</span>
                ) : portfolioVisibilityQuery.isError ? (
                  <button
                    type="button"
                    onClick={() => void portfolioVisibilityQuery.refetch()}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    다시 조회
                  </button>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={portfolioVisibilityQuery.data?.portfolioPublic ?? true}
                    disabled={visibilityBusy}
                    onClick={() =>
                      void togglePortfolioVisibility(!(portfolioVisibilityQuery.data?.portfolioPublic ?? true))
                    }
                    className={`inline-flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-bold transition-colors disabled:opacity-50 ${
                      (portfolioVisibilityQuery.data?.portfolioPublic ?? true)
                        ? "bg-[#0058FF] text-white hover:bg-blue-700"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <span>
                      {(portfolioVisibilityQuery.data?.portfolioPublic ?? true)
                        ? "공개 중 · 비공개로 전환"
                        : "비공개 중 · 공개로 전환"}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {visibilityFeedback && (
              <p
                role={visibilityFeedback.kind === "error" ? "alert" : "status"}
                className={`rounded-xl px-3.5 py-2.5 text-xs font-bold ${
                  visibilityFeedback.kind === "error"
                    ? "bg-red-50 text-red-600"
                    : "bg-blue-50 text-[#0058FF]"
                }`}
              >
                {visibilityFeedback.text}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-[#F9FAFB] p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900">모든 기기에서 로그아웃</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  현재 브라우저를 포함해 로그인된 모든 PC·모바일 기기의 로그인 상태를 즉시 해제합니다.
                </p>
              </div>
              <button
                type="button"
                disabled={logoutAllBusy}
                onClick={() => {
                  setLogoutAllError(null);
                  setLogoutAllOpen(true);
                }}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-xs font-bold text-[#F6465D] transition-colors hover:bg-rose-100 disabled:opacity-50"
              >
                모든 기기에서 로그아웃
              </button>
            </div>

            <DimModal
              open={logoutAllOpen}
              onClose={() => !logoutAllBusy && setLogoutAllOpen(false)}
              title="모든 기기에서 로그아웃할까요?"
              subtitle="모든 기기 로그인 해제"
              maxWidth="440px"
              footer={
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={logoutAllBusy}
                    onClick={() => setLogoutAllOpen(false)}
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-4 text-xs font-bold text-gray-700 hover:bg-gray-200"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={logoutAllBusy}
                    onClick={() => void handleLogoutAll()}
                    className="inline-flex h-9 items-center justify-center rounded-xl bg-[#F6465D] px-4 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {logoutAllBusy ? "로그아웃 중…" : "전체 기기 로그아웃"}
                  </button>
                </div>
              }
            >
              <div className="space-y-3 text-sm text-gray-600">
                <p>
                  확인 시 현재 기기를 포함한 모든 브라우저·모바일 기기의 로그인 세션이 즉시 만료됩니다. 다시 이용하려면 Google 또는 Kakao로 재로그인해야 합니다.
                </p>
                {logoutAllError && (
                  <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">
                    {logoutAllError}
                  </p>
                )}
              </div>
            </DimModal>
          </section>
        )}

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
