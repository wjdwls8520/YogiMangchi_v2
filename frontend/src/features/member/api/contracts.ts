import { ContentApiError } from "./client";
function invalid(): never { throw new ContentApiError(422); }
function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function text(value: unknown, max: number, empty = false): string {
  return typeof value === "string" && value.length <= max && (empty || value.length > 0) ? value : invalid();
}
function id(value: unknown) { return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : invalid(); }
function instant(value: unknown) {
  const parsed = text(value, 100);
  return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(parsed) && Number.isFinite(Date.parse(parsed)) ? parsed : invalid();
}
export const nicknamePattern = "[\\p{L}\\p{N}]{1,8}";
export function validNickname(value: string) { return /^[\p{L}\p{N}]{1,8}$/u.test(value); }
export type MemberRole = "MEMBER" | "ADMIN";
function decodeBase64Url(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    if (typeof globalThis.atob === "function") {
      const binary = globalThis.atob(padded);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(padded, "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}
export function parseJwtRole(accessToken: string, fallbackRole?: unknown): MemberRole {
  if (fallbackRole === "ADMIN" || fallbackRole === "ROLE_ADMIN") return "ADMIN";
  const segment = accessToken.split(".")[1];
  if (!segment) return "MEMBER";
  const decoded = decodeBase64Url(segment);
  if (!decoded) return "MEMBER";
  try {
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    if (
      Array.isArray(payload.roles) &&
      payload.roles.some(item => item === "ADMIN" || item === "ROLE_ADMIN")
    ) {
      return "ADMIN";
    }
    if (payload.role === "ADMIN" || payload.role === "ROLE_ADMIN") {
      return "ADMIN";
    }
  } catch {
    // Ignore non-JSON payload in synthetic test tokens
  }
  return "MEMBER";
}
export function parseAccess(value: unknown, _nowMs?: number) {
  void _nowMs;
  const data = row(value), accessToken = text(data.accessToken, 8192);
  if (data.tokenType !== "Bearer" || data.expiresIn !== 900 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) return invalid();
  const role = parseJwtRole(accessToken, data.role);
  return { memberId: id(data.memberId), nickname: text(data.nickname, 16), accessToken, expiresAt: instant(data.expiresAt), role };
}
export type MemberAccess = ReturnType<typeof parseAccess>;
export type AccessSession = MemberAccess;
export function parseCsrf(value: unknown) {
  const data = row(value);
  if (data.headerName !== "X-CSRF-TOKEN") return invalid();
  return text(data.token, 512);
}
export function parseFlow(value: unknown) {
  const data = row(value);
  if (!["SIGNUP_REQUIRED", "LOGIN_READY", "WITHDRAWAL_PENDING"].includes(String(data.status)) || !["GOOGLE", "KAKAO"].includes(String(data.provider))) return invalid();
  const email = text(data.email, 320), separator = email.lastIndexOf("@");
  return { status: data.status as "SIGNUP_REQUIRED" | "LOGIN_READY" | "WITHDRAWAL_PENDING", provider: data.provider as "GOOGLE" | "KAKAO",
    accountHint: separator > 0 ? `${email[0]}***${email.slice(separator)}` : "확인된 소셜 계정" };
}
export function parseProfile(value: unknown): {
  memberId: number;
  nickname: string;
  profileMessage: string;
  profileImgUrl?: string | null;
  createdAt: string;
} {
  const data = row(value);
  const profileImgUrl =
    data.profileImgUrl === null || data.profileImgUrl === undefined
      ? null
      : text(data.profileImgUrl, 1000, true) || null;
  return {
    memberId: id(data.memberId),
    nickname: text(data.nickname, 16),
    profileMessage: text(data.profileMessage, 300, true),
    ...(data.profileImgUrl !== undefined ? { profileImgUrl } : {}),
    createdAt: instant(data.createdAt),
  };
}
export type MemberProfile = ReturnType<typeof parseProfile>;
export function parseOwnProfile(value: unknown, memberId: number) {
  const data = row(value), profile = parseProfile(value);
  if (profile.memberId !== memberId || !["MEMBER", "ADMIN"].includes(String(data.role))) return invalid();
  return { ...profile, role: data.role as "MEMBER" | "ADMIN" };
}
function count(value: unknown) { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalid(); }
function boolean(value: unknown) { return typeof value === "boolean" ? value : invalid(); }
export function parseFollowSummary(value: unknown, memberId: number) {
  const data = row(value);
  if (id(data.memberId) !== memberId) return invalid();
  return { memberId, followerCount: count(data.followerCount), followingCount: count(data.followingCount),
    followed: boolean(data.followed), follower: boolean(data.follower), mine: boolean(data.mine) };
}
export function parseFollowPage(value: unknown) {
  const data = row(value);
  if (!Array.isArray(data.content) || data.content.length > 10) return invalid();
  const content = data.content.map(value => {
    const entry = row(value);
    const profileImgUrl =
      entry.profileImgUrl === null || entry.profileImgUrl === undefined
        ? null
        : text(entry.profileImgUrl, 1000, true) || null;
    return {
      memberId: id(entry.memberId),
      nickname: text(entry.nickname, 16),
      profileMessage: text(entry.profileMessage, 300, true),
      ...(entry.profileImgUrl !== undefined ? { profileImgUrl } : {}),
      followedAt: instant(entry.followedAt),
    };
  });
  if (new Set(content.map(entry => entry.memberId)).size !== content.length) return invalid();
  const hasNext = boolean(data.hasNext), nextCursorId = data.nextCursorId === null ? null : id(data.nextCursorId);
  if (hasNext && (nextCursorId === null || !content.length)) return invalid();
  return { content, nextCursorId, hasNext };
}
export function parseWithdrawal(value: unknown) {
  const data = row(value);
  return data.status === "PENDING" || data.status === "COMPLETED" || data.status === "NOT_REQUESTED" ? data.status : invalid();
}
export function parseNicknameAvailability(value: unknown) { return boolean(row(value).available); }
export function parseFollowChange(value: unknown, memberId: number) {
  const data = row(value);
  if (id(data.targetMemberId) !== memberId) return invalid();
  return { targetMemberId: memberId, followerCount: count(data.followerCount), followed: boolean(data.followed) };
}
