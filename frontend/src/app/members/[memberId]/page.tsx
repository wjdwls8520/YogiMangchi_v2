import { notFound } from "next/navigation";
import { PublicMember } from "../../../features/member/components/public-member";
export default async function MemberPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params, id = Number(memberId);
  if (!/^[1-9][0-9]*$/.test(memberId) || !Number.isSafeInteger(id)) notFound();
  return <PublicMember memberId={id} />;
}
