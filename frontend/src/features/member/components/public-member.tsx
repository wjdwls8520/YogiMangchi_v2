"use client";

import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ContentApiError, contentJson, contentMessage } from "../api/client";
import { parseFollowChange, parseFollowPage, parseFollowSummary, parseProfile } from "../api/contracts";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";

export function PublicMember({ memberId }: { memberId: number }) {
  const { origin, session, snapshot } = useMember(), client = useQueryClient();
  const [kind, setKind] = useState<"followers" | "followings">("followers"), [keyword, setKeyword] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), active = useRef(false);
  const identity = [snapshot.memberId, snapshot.generation] as const;
  const profile = useQuery({ queryKey: ["member", "public", memberId], queryFn: async ({ signal }) => {
    const value = parseProfile(await contentJson(origin, `/members/${memberId}`, { signal }));
    if (value.memberId !== memberId) throw new ContentApiError(422); return value;
  } });
  const summary = useQuery({ queryKey: ["member", "relationship", memberId, ...identity], queryFn: async ({ signal }) => parseFollowSummary(await (snapshot.phase === "ready"
    ? session.request(`/members/${memberId}/follows`, { signal }) : contentJson(origin, `/members/${memberId}/follows`, { signal })), memberId),
  });
  const list = useInfiniteQuery({ queryKey: ["member", "relations", memberId, kind, keyword], initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ size: "10", keyword }); if (pageParam) params.set("cursorId", String(pageParam));
      const page = parseFollowPage(await contentJson(origin, `/members/${memberId}/${kind}?${params}`, { signal }));
      if (page.hasNext && pageParam && page.nextCursorId! >= pageParam) throw new ContentApiError(422);
      return page;
    }, getNextPageParam: page => page.hasNext ? page.nextCursorId ?? undefined : undefined,
  });
  async function changeFollow() {
    if (active.current || snapshot.phase !== "ready" || !summary.data || summary.data.mine) return;
    active.current = true; setPending(true); setError(null);
    try { parseFollowChange(await session.request(`/members/${memberId}/follows`, { method: summary.data.followed ? "DELETE" : "PUT" }), memberId); await client.invalidateQueries({ queryKey: ["member"] }); }
    catch (error) { setError(contentMessage(error)); }
    finally { active.current = false; setPending(false); }
  }
  const entries = list.isError && !list.isFetchNextPageError ? undefined : list.data?.pages.flatMap(page => page.content).filter((entry, index, all) => all.findIndex(value => value.memberId === entry.memberId) === index);
  const currentProfile = profile.isError ? undefined : profile.data;
  return <MemberShell title={currentProfile?.nickname ?? "공개 프로필"}>
    {profile.isPending && <p role="status">프로필을 불러오는 중입니다.</p>}{profile.isError && <p role="alert" className="member-message">{contentMessage(profile.error)}</p>}
    {currentProfile && <><p className="member-profile-message">{currentProfile.profileMessage || "등록된 소개가 없습니다."}</p><p className="member-note">가입 {new Date(currentProfile.createdAt).toLocaleDateString("ko-KR")}</p>
      <div className="member-actions">{summary.data?.mine ? <Link href="/account">프로필 수정</Link> : snapshot.phase === "ready" ? <button type="button" className="member-primary" disabled={pending || !summary.data || summary.isFetching || summary.isError} onClick={() => void changeFollow()}>{pending ? "처리 중…" : summary.data?.followed ? "팔로우 취소" : "팔로우"}</button> : <Link href="/login">로그인하고 팔로우</Link>}</div>
      {summary.isError && <p role="alert" className="member-message">{contentMessage(summary.error)} <button className="account-refresh" onClick={() => void summary.refetch()}>다시 조회</button></p>}{error && <p role="alert" className="member-message">{error}</p>}
      <div className="member-actions" role="tablist" aria-label="팔로우 목록">{(["followers", "followings"] as const).map(value => <button key={value} type="button" className="member-secondary" role="tab" aria-selected={kind === value} id={`member-${value}-tab`} aria-controls="member-follow-panel" onClick={() => setKind(value)}>{value === "followers" ? "팔로워" : "팔로잉"} {summary.data ? value === "followers" ? summary.data.followerCount : summary.data.followingCount : "—"}</button>)}</div>
      <section id="member-follow-panel" role="tabpanel" aria-labelledby={`member-${kind}-tab`}><form className="member-search" onSubmit={event => { event.preventDefault(); setKeyword(String(new FormData(event.currentTarget).get("keyword") ?? "").trim()); }}><input name="keyword" aria-label="닉네임 검색" maxLength={12} placeholder="닉네임 검색" /><button type="submit" className="member-secondary">검색</button></form>
        {list.isPending && <p role="status">목록을 불러오는 중입니다.</p>}{list.isError && <p role="alert" className="member-message">{contentMessage(list.error)}</p>}
        {entries?.length === 0 && <p className="member-message">표시할 회원이 없습니다.</p>}
        <ul className="member-follow-list">{entries?.map(entry => <li key={entry.memberId}><Link href={`/members/${entry.memberId}`}>{entry.nickname}</Link><p className="member-profile-message">{entry.profileMessage}</p></li>)}</ul>
        <div className="member-actions">{list.hasNextPage && <button className="member-secondary" disabled={list.isFetching} onClick={() => void list.fetchNextPage()}>{list.isFetching ? "불러오는 중…" : "더 보기"}</button>}{list.isError && !list.isFetchNextPageError && <button className="member-secondary" disabled={list.isFetching} onClick={() => void list.refetch()}>다시 조회</button>}</div>
      </section></>}
  </MemberShell>;
}
