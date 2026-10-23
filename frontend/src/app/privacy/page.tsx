import { MemberShell } from "../../features/member/components/member-views";
import { PublicPolicyPage } from "../../features/member/components/policy-controls";
export default function PrivacyPage() { return <MemberShell title="개인정보처리방침"><PublicPolicyPage type="PRIVACY" /></MemberShell>; }
