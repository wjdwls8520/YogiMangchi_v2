"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMember } from "./member-provider";
import { readPolicies, policyAccepted, type ConsentSelection, type PolicyBundle, type PolicyState, type PolicyType } from "../api/policies";
import { PolicyContent } from "./policy-content";
import { PolicyConsentFields, PolicyDialogContent } from "./policy-consent-views";
import { useDialogScrollLock } from "./dim-modal";

export function usePolicies() {
  const { origin } = useMember();
  return useQuery({ queryKey: ["public-policies", origin], queryFn: ({ signal }) => readPolicies(origin, signal), staleTime: 15_000 });
}
export function PublicPolicyPage({ type }: { type: PolicyType }) {
  const policies = usePolicies();
  if (policies.isPending) {
    return (
      <p role="status" className="member-message">
        약관 원문을 불러오는 중입니다.
      </p>
    );
  }
  return (
    <>
      {policies.isError && (
        <p role="alert" className="member-message mb-4">
          현재 약관 원문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.{" "}
          <button
            type="button"
            className="account-refresh"
            onClick={() => void policies.refetch()}
          >
            다시 조회
          </button>
        </p>
      )}
      <PolicyContent
        type={type}
        document={!policies.isError ? policies.data?.documents[type] : undefined}
      />
    </>
  );
}
export function PolicyConsentControl({ bundle, selection, onChange, pending, previous }: {
  bundle: PolicyBundle; selection: ConsentSelection; onChange: (value: ConsentSelection) => void; pending: boolean; previous?: PolicyState;
}) {
  const [active, setActive] = useState<PolicyType>("TERMS");
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  useDialogScrollLock(dialog);
  const versions = { TERMS: bundle.documents.TERMS.version, PRIVACY: bundle.documents.PRIVACY.version };
  const selected = { TERMS: policyAccepted(selection, "TERMS", versions.TERMS, previous), PRIVACY: policyAccepted(selection, "PRIVACY", versions.PRIVACY, previous) };
  const choose = (type: PolicyType, agreed: boolean) => onChange({ ...selection, [type]: { version: versions[type], agreed } });
  return <><PolicyConsentFields versions={versions} accepted={selected} disabled={pending} onChange={choose} onOpen={type => {
    trigger.current = document.activeElement as HTMLElement; setActive(type); dialog.current?.showModal();
  }} /><dialog ref={dialog} className="position-close-dialog policy-dialog" aria-labelledby="policy-dialog-title" onClose={() => trigger.current?.focus()}>
    <PolicyDialogContent document={bundle.documents[active]} accepted={selected[active]} onAccept={() => { choose(active, true); dialog.current?.close(); }} onRevoke={() => choose(active, false)} onClose={() => dialog.current?.close()} />
  </dialog></>;
}
