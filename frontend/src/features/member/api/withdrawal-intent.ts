// Non-credential navigation intent only. The Backend must verify the fresh same-member OAuth proof.
const key = "yogimangchi:withdrawal-return:v1";
export type WithdrawalIntent = { memberId: number; startedAt: number; returned: boolean };
export function readWithdrawalIntent(): WithdrawalIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    return value && Number.isSafeInteger(value.memberId) && value.memberId > 0 && Number.isFinite(value.startedAt)
      && Date.now() - value.startedAt >= 0 && Date.now() - value.startedAt < 300_000 && typeof value.returned === "boolean" ? value : null;
  } catch { return null; }
}
export function saveWithdrawalIntent(memberId: number, returned = false) {
  window.sessionStorage.setItem(key, JSON.stringify({ memberId, startedAt: Date.now(), returned }));
}
export function clearWithdrawalIntent() { try { window.sessionStorage.removeItem(key); } catch { /* No credential is retained. */ } }
