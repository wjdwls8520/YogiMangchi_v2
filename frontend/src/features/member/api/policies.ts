import { ContentApiError, contentJson } from "./client";

export type PolicyType = "TERMS" | "PRIVACY";
export type PolicyDocument = { type: PolicyType; version: string; documentStatus: "DEVELOPMENT_DRAFT"; sha256: string; text: string };
export type Policy = { type: PolicyType; version: string; required: boolean; accepted: boolean; lastAcceptedVersion: string | null; lastAgreedAt: string | null; documentUrl: string };
export type PolicyState = { policies: Policy[]; reconsentRequired: boolean };
export type PolicyBundle = { state: PolicyState; documents: Record<PolicyType, PolicyDocument> };
export type ConsentSelection = Partial<Record<PolicyType, { version: string; agreed: boolean }>>;
const fail = (): never => { throw new ContentApiError(422); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
export const validPolicyVersion = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
export function parsePolicyState(value: unknown): PolicyState {
  const row = object(value);
  if (!Array.isArray(row.policies) || row.policies.length !== 2 || typeof row.reconsentRequired !== "boolean") return fail();
  const policies = row.policies.map(value => {
    const p = object(value);
    if (!["TERMS", "PRIVACY"].includes(String(p.type)) || !validPolicyVersion(p.version) || typeof p.required !== "boolean" || typeof p.accepted !== "boolean"
      || p.documentUrl !== `/api/v1/policies/${p.type}/${p.version}` || p.lastAcceptedVersion !== null && !validPolicyVersion(p.lastAcceptedVersion)
      || p.lastAgreedAt !== null && (typeof p.lastAgreedAt !== "string" || !Number.isFinite(Date.parse(p.lastAgreedAt)))) return fail();
    return { type: p.type as PolicyType, version: p.version, required: p.required, accepted: p.accepted,
      lastAcceptedVersion: p.lastAcceptedVersion as string | null, lastAgreedAt: p.lastAgreedAt as string | null, documentUrl: p.documentUrl as string };
  });
  if (new Set(policies.map(p => p.type)).size !== 2 || row.reconsentRequired !== policies.some(p => p.required && !p.accepted)) return fail();
  return { policies, reconsentRequired: row.reconsentRequired };
}
export async function readPolicies(origin: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<PolicyBundle> {
  const state = parsePolicyState(await contentJson(origin, "/policies/current", { signal }, transport));
  const documents = {} as Record<PolicyType, PolicyDocument>;
  await Promise.all(state.policies.map(async p => {
    const d = object(await contentJson(origin, p.documentUrl.slice("/api/v1".length), { signal }, transport));
    if (d.type !== p.type || d.version !== p.version || d.documentStatus !== "DEVELOPMENT_DRAFT" || typeof d.text !== "string" || !d.text.length || d.text.length > 100000
      || typeof d.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(d.sha256)) return fail();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(d.text)))).map(v => v.toString(16).padStart(2, "0")).join("");
    if (hash !== d.sha256 || signal.aborted) return fail();
    documents[p.type] = { type: p.type, version: p.version, documentStatus: d.documentStatus, text: d.text, sha256: d.sha256 };
  }));
  return { state, documents };
}
export function policyAccepted(selection: ConsentSelection, type: PolicyType, version: string, previous?: PolicyState) {
  const choice = selection[type];
  return choice ? choice.version === version && choice.agreed : !!previous?.policies.some(p => p.type === type && p.version === version && p.accepted);
}
export function acceptance(bundle: PolicyBundle, selection: ConsentSelection, previous?: PolicyState) {
  const termsVersion = bundle.documents.TERMS.version, privacyVersion = bundle.documents.PRIVACY.version;
  if (!policyAccepted(selection, "TERMS", termsVersion, previous) || !policyAccepted(selection, "PRIVACY", privacyVersion, previous)) throw new ContentApiError(409, "POLICY_VERSION_OR_CONSENT_INVALID");
  return { termAgree: true, privateAgree: true, termsVersion, privacyVersion };
}
