import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @solana/web3.js ships ESM that Next handles fine server-side;
  // the snapshot logic runs only in API routes, never in the browser bundle.
  serverExternalPackages: ["@solana/web3.js"],
};

export default nextConfig;
