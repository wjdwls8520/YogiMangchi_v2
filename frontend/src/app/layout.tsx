import type { Metadata } from "next";
import { SiteFooter } from "../components/site-footer";
import "./globals.css";
import { MemberProvider } from "../features/member/components/member-provider";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
  ),
  title: {
    default: "요기망치",
    template: "%s | 요기망치",
  },
  description: "나의 욕망을 실현할 곳 — 요기망치 코인 정보와 선물 모의투자",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/logo.png",
  },
  openGraph: {
    title: "요기망치",
    description: "나의 욕망을 실현할 곳 — 요기망치 코인 정보와 선물 모의투자",
    siteName: "요기망치",
    locale: "ko_KR",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "요기망치 로고",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "요기망치",
    description: "나의 욕망을 실현할 곳 — 요기망치 코인 정보와 선물 모의투자",
    images: ["/og-image.png"],
  },
};

const HEADER_AUTH_HINT_INIT_SCRIPT = `(function(){try{var r=window.localStorage.getItem("yogimangchi:header-auth-hint:v1");var h=r?JSON.parse(r):null;document.documentElement.dataset.ymAuthHint=h&&h.loggedIn?(h.role==="ADMIN"?"admin":"member"):"anon";}catch(e){document.documentElement.dataset.ymAuthHint="anon";}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEADER_AUTH_HINT_INIT_SCRIPT }} />
      </head>
      <body><MemberProvider>{children}<SiteFooter /></MemberProvider></body>
    </html>
  );
}
