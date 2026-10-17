import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Smaller dev graphs; helps Turbopack if you use `npm run dev:turbo`.
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
