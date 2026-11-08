"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname() ?? "";

  if (pathname === "/login" || pathname === "/signup") {
    return null;
  }

  const isTrading = pathname.startsWith("/trading");
  const linkClass = isTrading
    ? "transition-colors hover:text-white"
    : "transition-colors hover:text-gray-900";

  return (
    <footer
      className={
        isTrading
          ? "w-full border-t border-white/10 bg-[#0B0E11] py-8 text-center text-sm text-gray-400"
          : "w-full border-t border-gray-200 bg-white py-8 text-center text-sm text-gray-500"
      }
    >
      <nav aria-label="Footer">
        <ul className="flex items-center justify-center gap-6">
          <li>
            <Link href="/terms" className={linkClass}>
              이용약관
            </Link>
          </li>
          <li>
            <Link href="/privacy" className={linkClass}>
              개인정보처리방침
            </Link>
          </li>
          <li>
            <Link href="/community/all" className={linkClass}>
              고객센터
            </Link>
          </li>
        </ul>
      </nav>
      <small className="block pt-5 text-xs text-gray-400">
        © 2026 Yogi-Mangchi. All rights reserved.
      </small>
    </footer>
  );
}
