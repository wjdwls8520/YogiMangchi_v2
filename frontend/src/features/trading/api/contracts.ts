import { TradingApiError } from "./client";

export function invalidContract(): never { throw new TradingApiError(422, "서버 응답 형식을 확인할 수 없습니다."); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidContract();
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 200) return invalidContract();
  return value;
}
export function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return invalidContract();
  return value as number;
}
export function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^-?\d{1,30}(\.\d{1,18})?$/.test(value)) return invalidContract();
  return value;
}
export function instant(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) return invalidContract();
  return result;
}
export function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
export function list<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalidContract();
  return value.map(parse);
}

export type GuestCredential = { accountId: number; accessToken: string; expiresAt: string };
export function parseCredential(value: unknown): GuestCredential {
  const row = record(value);
  const token = text(row.accessToken);
  if (!/^guest_[A-Za-z0-9_-]{43}$/.test(token)) return invalidContract();
  return { accountId: id(row.accountId), accessToken: token, expiresAt: instant(row.expiresAt) };
}
export function parseGuest(value: unknown): GuestCredential {
  const row = record(value);
  if (row.tokenType !== "Bearer" || row.quoteAsset !== "USDT" || row.status !== "ACTIVE") return invalidContract();
  decimal(row.initialBalance);
  return parseCredential(row);
}
