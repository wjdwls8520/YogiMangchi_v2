import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { MemberLoginView, ProfileEditForm, SignupForm } from "../src/features/member/components/member-views";
import { GuestStartDialog } from "../src/features/trading/components/guest-access";
import { AccountQueryState } from "../src/features/trading/components/account-query-state";
import { TradingDataProvider } from "../src/features/trading/components/trading-data-provider";
import { TradingAccountTabs } from "../src/features/trading/components/trading-account-tabs";
import { WithdrawalConfirmation } from "../src/features/member/components/withdrawal-confirmation";
test("signup waits for the versioned original policies and blocks duplicate pending submissions", () => {
  const html = renderToStaticMarkup(<MemberProvider><SignupForm onSubmit={() => {}} pending={false}/></MemberProvider>);
  assert.match(html, /disabled=""[^>]*>동의하고 가입하기/);
  assert.equal(html.includes('checked=""'), false); assert.equal(html.includes('type="password"'), false);
  assert.match(html, /필수 동의 문서를 확인/);
  assert.match(html, /최대 8자/);
  const pending = renderToStaticMarkup(<MemberProvider><SignupForm onSubmit={() => {}} pending /></MemberProvider>);
  assert.match(pending, /fieldset disabled=""/);
  assert.match(pending, /disabled=""[^>]*>가입 처리 중/);
});
test("login exposes only supported providers and profile content is escaped", () => {
  const login = renderToStaticMarkup(<MemberLoginView google="http://localhost:8080/oauth2/authorization/google" kakao="http://localhost:8080/oauth2/authorization/kakao"/>);
  assert.match(login, /Google로 계속하기/); assert.match(login, /Kakao로 계속하기/);
  const html = renderToStaticMarkup(<MemberProvider><ProfileEditForm nickname="회원" message="<script>alert(1)</script>" pending={false} onSubmit={() => {}} /></MemberProvider>);
  assert.equal(html.includes("<script>"), false); assert.match(html, /&lt;script&gt;/);
});
test("an unchanged legacy nickname remains readable and does not prevent message-only profile edits", () => {
  const html = renderToStaticMarkup(<MemberProvider><ProfileEditForm nickname="legacyname12" message="" pending={false} onSubmit={() => {}} /></MemberProvider>);
  assert.match(html, /value="legacyname12"/);
  assert.equal(html.includes('pattern="[\\p{L}\\p{N}]{1,8}"'), false);
});
test("Member account opening describes server initial grant and preserves existing account and Guest separation", () => {
  const html = renderToStaticMarkup(<GuestStartDialog member dialogRef={createRef<HTMLDialogElement>()} creating={false} failed={false} onStart={() => {}} onCancel={() => {}} onClose={() => {}} />);
  assert.match(html, /1회차 시작 자금은 10,000 USDT/); assert.match(html, /기존 계정 잔액은 자동 변경하지 않습니다/);
  assert.match(html, /Guest의 체험 자산과 금융 이력을 가져오거나 초기화하지 않습니다/);
});
test("failed member preparation directs a read-only lookup instead of offering another creation", () => {
  const html = renderToStaticMarkup(<GuestStartDialog member dialogRef={createRef<HTMLDialogElement>()} creating={false} failed onStart={() => {}} onCancel={() => {}} onClose={() => {}} />);
  assert.match(html, /창을 닫고 계정을 다시 조회/);
  assert.match(html, /disabled=""[^>]*>10,000 USDT로 시작하기/);
  assert.doesNotMatch(html, /서버 연결과 인증 설정/);
  const error = renderToStaticMarkup(<AccountQueryState loading={false} error onRetry={() => {}} />);
  assert.match(error, /잔액과 거래 상태를 알 수 없습니다/);
  assert.doesNotMatch(error, /저장소|0 USDT/);
});
test("account tabs wait for login and account lookup without asking the user to open another account", () => {
  let client: QueryClient | undefined;
  function Tabs() { client = useQueryClient(); return <TradingAccountTabs symbols={[]} />; }
  const html = renderToStaticMarkup(<MemberProvider><TradingDataProvider><Tabs /></TradingDataProvider></MemberProvider>);
  client?.clear();
  assert.match(html, /로그인과 거래 계정을 확인하는 중/);
  assert.doesNotMatch(html, /계정을 열면|로그인 또는 게스트로 참여하면/);
});
test("withdrawal explains irreversible identity removal and preserved records, requires explicit confirmation and blocks the unsupported API", () => {
  const html = renderToStaticMarkup(<WithdrawalConfirmation onSubmit={event => event.preventDefault()} onCancel={() => {}} />);
  for (const text of ["복구할 수 없", "새로운 회원", "이전되지 않", "관리상 종료", "새로운 체결·손익·수수료", "게시글·댓글·대댓글", "탈퇴한회원", "Guest 기록", "서버의 확인 문구 검증과 즉시 거래 차단"])
    assert.equal(html.includes(text), true, text);
  assert.match(html, /<input(?=[^>]*name="acknowledged")(?=[^>]*required="")[^>]*>/);
  assert.match(html, /<input(?=[^>]*name="confirmation")(?=[^>]*required="")(?=[^>]*pattern="탈퇴합니다")[^>]*>/);
  assert.match(html, /disabled=""[^>]*>본인 확인 필요/);
  assert.equal(html.includes('checked=""'), false);
  assert.equal(html.includes("모든 정보가 완전히 삭제"), false);
  assert.equal(html.includes("공인된 전자서명"), false);
});
