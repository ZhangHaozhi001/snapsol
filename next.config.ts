import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No serverExternalPackages: the snapshot logic uses plain fetch-based
  // JSON-RPC (see src/lib/solana.ts) and needs no externalized packages.
};

export default nextConfig;
