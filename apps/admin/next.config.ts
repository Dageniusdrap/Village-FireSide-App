import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@village-fireside/shared"],
  // Pin the workspace root to this monorepo. Without it, Next infers the root
  // from the outermost lockfile it finds, which for a git worktree under
  // .worktrees/ is the main checkout rather than the worktree itself.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
