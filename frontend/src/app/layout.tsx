import type { Metadata } from "next";
import { SiteFooter } from "../components/site-footer";
import "./globals.css";
import { MemberProvider } from "../features/member/components/member-provider";

export const metadata: Metadata = {
  title: {
    default: "요기망치",
    template: "%s | 요기망치",
  },
  description: "요기망치 코인 정보와 선물 모의투자",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body><MemberProvider>{children}<SiteFooter /></MemberProvider></body>
    </html>
  );
}
