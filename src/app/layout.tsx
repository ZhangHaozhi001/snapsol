import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnapSOL — Solana Wallet Snapshot Card",
  description:
    "A free, read-only web tool that turns any Solana address into a one-page snapshot card. No wallet connection or signing required.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
