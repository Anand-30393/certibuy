import path from "node:path";
import type { NextConfig } from "next";

// Local development keeps one .env.local at the repo root (never committed). CI and Vercel
// provide variables directly, so a missing file is fine.
try {
  process.loadEnvFile(path.join(process.cwd(), "../../.env.local"));
} catch {
  // no local env file
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@certibuy/domain",
    "@certibuy/contracts",
    "@certibuy/application",
    "@certibuy/db",
    "@certibuy/integrations",
  ],
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
