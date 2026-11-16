import { NextRequest, NextResponse } from "next/server";
import { fetchSnapshot, parseAddress } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";

  if (!address.trim()) {
    return NextResponse.json(
      { error: "Please paste a Solana address first." },
      { status: 400 },
    );
  }
  if (!parseAddress(address)) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a valid Solana address. Check for typos — addresses are base58, 32–44 characters, with no 0, O, I, or l.",
      },
      { status: 400 },
    );
  }

  try {
    const snapshot = await fetchSnapshot(address);
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("snapshot failed:", err);
    return NextResponse.json(
      {
        error:
          "Could not reach the Solana network just now. The public RPC can be rate-limited — wait a few seconds and try again.",
      },
      { status: 502 },
    );
  }
}
