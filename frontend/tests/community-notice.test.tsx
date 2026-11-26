import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { createMemberSession } from "../src/features/member/api/session";
import {
  COMMUNITY_CATEGORIES,
  communityCategoryLabel,
  formatCommunityPostTitleText,
  parseCommunityPost,
  stripNoticePrefix,
  type CommunityPost,
  type CommunityPostPage,
} from "../src/features/member/api/community-news";
import {
  CommunityBoard,
  getWritableCommunityCategories,
} from "../src/features/member/components/community-board";
import {
  formatNotificationDescription,
  formatNotificationTitle,
  getNotificationDetailFields,
  getNotificationNavigationTarget,
  getNotificationTradeMeta,
  getNotificationTypeLabel,
} from "../src/features/member/notifications/notification-utils";
import type { NotificationItem } from "../src/features/member/notifications/notification-types";

async function makeReadySession(role: "MEMBER" | "ADMIN", memberId = 7, nickname = "테스터") {
  const epoch = Date.parse("2026-11-25T00:00:00Z");
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: String(memberId), role })).toString("base64url")}.sig`;
  const session = createMemberSession(
    "http://localhost:8080",
    async url =>
      String(url).endsWith("csrf")
        ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf-token" })
        : Response.json({
            memberId,
            nickname,
            role,
            accessToken: jwt,
            tokenType: "Bearer",
            expiresIn: 900,
            expiresAt: new Date(epoch + 900_000).toISOString(),
          }),
    () => epoch,
    fn => fn(),
    () => true,
    () => null,
  );
  await session.refresh();
  return session;
}

function renderWithSession(
  element: ReactElement,
  session: ReturnType<typeof createMemberSession>,
): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <MemberProvider session={session} client={queryClient}>
      {element}
    </MemberProvider>,
  );
}

const sampleNoticePost: CommunityPost = {
  id: 30,
  memberId: 1,
  authorNickname: "구글정진",
  authorWithdrawn: false,
  category: "NOTICE",
  symbolTag: null,
  title: "점검 끝났습니다.",
  content: "모든 서비스가 정상 재개되었습니다.",
  likeCount: 5,
  commentCount: 2,
  likedByMe: false,
  reportedByMe: false,
  mine: true,
  files: [],
  sharedPosition: null,
  createdAt: "2026-11-25T04:00:00Z",
  updatedAt: "2026-11-25T04:00:00Z",
};

test("community-news parses NOTICE category, labels it 공지사항, and deduplicates [공지] prefix", () => {
  assert.equal(communityCategoryLabel("NOTICE"), "공지사항");
  assert.ok(COMMUNITY_CATEGORIES.some(item => item.key === "NOTICE"));

  const parsed = parseCommunityPost({
    id: 30,
    memberId: 1,
    authorNickname: "구글정진",
    authorWithdrawn: false,
    category: "NOTICE",
    symbolTag: null,
    title: "점검 끝났습니다.",
    content: "정상화 완료",
    likeCount: 0,
    commentCount: 0,
    likedByMe: false,
    mine: false,
    createdAt: "2026-11-25T04:00:00Z",
    updatedAt: "2026-11-25T04:00:00Z",
  });
  assert.equal(parsed.category, "NOTICE");

  assert.equal(stripNoticePrefix("점검 끝났습니다."), "점검 끝났습니다.");
  assert.equal(stripNoticePrefix("[공지] 점검 끝났습니다."), "점검 끝났습니다.");
  assert.equal(formatCommunityPostTitleText("NOTICE", "점검 끝났습니다."), "[공지] 점검 끝났습니다.");
  assert.equal(formatCommunityPostTitleText("NOTICE", "[공지] 점검 끝났습니다."), "[공지] 점검 끝났습니다.");
  assert.equal(formatCommunityPostTitleText("FREE", "일반글"), "일반글");
});

test("getWritableCommunityCategories hides NOTICE from non-admins and exposes it to admins only", () => {
  const memberWritable = getWritableCommunityCategories(false);
  assert.equal(memberWritable.includes("NOTICE"), false);
  assert.deepEqual([...memberWritable], ["MARKET", "ANALYSIS", "POSITION", "FREE"]);

  const adminWritable = getWritableCommunityCategories(true);
  assert.equal(adminWritable.includes("NOTICE"), true);
  assert.equal(adminWritable[0], "NOTICE");
});

test("CommunityBoard renders 공지사항 tab next to 주간 인기글, red [공지] prefix, and hides NOTICE option from member edit form", async () => {
  const memberSession = await makeReadySession("MEMBER", 2, "일반유저");
  const adminSession = await makeReadySession("ADMIN", 1, "구글정진");

  const pageWithNotice: CommunityPostPage = {
    items: [
      sampleNoticePost,
      {
        ...sampleNoticePost,
        id: 31,
        title: "[공지] 중복 말머리 방지 테스트",
      },
      {
        ...sampleNoticePost,
        id: 32,
        memberId: 2,
        authorNickname: "일반유저",
        category: "FREE",
        title: "일반 자유글입니다.",
        mine: true,
      },
    ],
    hasNext: false,
    nextCursorId: null,
  };

  // Feed renders all 3 tabs in order: 전체글 -> 주간 인기글 -> 공지사항
  const feedHtml = renderWithSession(
    <CommunityBoard initialPage={pageWithNotice} />,
    memberSession,
  );
  const allIdx = feedHtml.indexOf("전체글");
  const bestIdx = feedHtml.indexOf("주간 인기글");
  const noticeIdx = feedHtml.indexOf("공지사항");
  assert.ok(allIdx > -1 && bestIdx > allIdx && noticeIdx > bestIdx);

  // Red [공지] prefix renders automatically and never duplicates [공지] [공지]
  assert.match(feedHtml, /data-notice-prefix="true"[^>]*>\[공지\]<\/span><span>점검 끝났습니다\.<\/span>/);
  assert.match(feedHtml, /data-notice-prefix="true"[^>]*>\[공지\]<\/span><span>중복 말머리 방지 테스트<\/span>/);
  assert.ok(!feedHtml.includes("[공지] [공지]"));
  assert.match(feedHtml, /text-red-600[^>]*data-notice-prefix="true"/);

  // Non-admin editing own FREE post MUST NOT see <option value="NOTICE">
  const memberEditHtml = renderWithSession(
    <CommunityBoard initialPage={pageWithNotice} initialEditingPostId={32} />,
    memberSession,
  );
  assert.ok(!memberEditHtml.includes('value="NOTICE"'));

  // Admin editing own post MUST see <option value="NOTICE">
  const adminEditHtml = renderWithSession(
    <CommunityBoard initialPage={pageWithNotice} initialEditingPostId={30} />,
    adminSession,
  );
  assert.ok(adminEditHtml.includes('value="NOTICE"'));

  // Empty notice tab shows dedicated empty state copy
  const emptyNoticeHtml = renderWithSession(
    <CommunityBoard
      initialV1Tab="notice"
      initialCategory="NOTICE"
      initialPage={{ items: [], hasNext: false, nextCursorId: null }}
    />,
    memberSession,
  );
  assert.ok(emptyNoticeHtml.includes("아직 등록된 공지사항이 없습니다."));
});

test("notification-utils formats NOTICE_POST_CREATED title, description, badge, detail fields, and link", () => {
  const notif: NotificationItem = {
    uid: "CONTENT:99",
    source: "CONTENT",
    notificationId: 99,
    actorMemberId: 1,
    category: "COMMUNITY",
    type: "NOTICE_POST_CREATED",
    isRead: false,
    createdAt: "2026-11-25T04:00:00Z",
    lastEventAt: "2026-11-25T04:00:00Z",
    payload: {
      postId: 30,
      postTitle: "점검 끝났습니다.",
      postCategory: "NOTICE",
      contentPreview: "모든 서비스가 정상 재개되었습니다.",
      actorMemberId: 1,
      actorNickname: "구글정진",
    },
  };

  assert.equal(getNotificationTypeLabel(notif.type), "공지사항");
  assert.equal(formatNotificationTitle(notif), "[공지] 점검 끝났습니다.");
  assert.ok(formatNotificationDescription(notif).includes("새 공지사항이 등록되었습니다"));
  assert.deepEqual(getNotificationTradeMeta(notif), { sideLabel: "공지사항", tone: "sell" });
  assert.deepEqual(getNotificationNavigationTarget(notif), {
    href: "/community/notice/30",
    label: "공지사항 보러가기",
  });
  const fields = getNotificationDetailFields(notif);
  assert.ok(fields.some(f => f.label === "구분" && f.value === "운영 공지사항"));
  assert.ok(fields.some(f => f.label === "제목" && f.value === "[공지] 점검 끝났습니다."));
});
