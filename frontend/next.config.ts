import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

// Non-secret source evidence for diagnosing an old checkout or bundle in a running server.
let revision = "unknown";
try {
  const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no", "--", "."], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (/^[a-f0-9]{12}$/.test(head)) revision = `${head}${dirty ? "-dirty" : ""}`;
} catch { /* Builds without Git metadata remain explicitly unknown. */ }

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Yogimangchi-Frontend-Revision", value: revision }] }];
  },
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
