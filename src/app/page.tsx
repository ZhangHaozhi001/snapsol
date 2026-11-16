"use client";

import { useRef, useState } from "react";
import type { Snapshot } from "@/lib/solana";

const EXAMPLES = [
  { label: "Solana Vote Program", address: "Vote111111111111111111111111111111111111111" },
  { label: "Raydium Authority V4", address: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8" },
];

function fmt(n: number, digits = 4): string {
  // A non-zero amount that rounds to 0 at this precision shows as "<0.0001",
  // not "0" — otherwise a 1-lamport balance looks like an empty account.
  if (n > 0 && Number(n.toFixed(digits)) === 0) {
    return `<${(10 ** -digits).toFixed(digits)}`;
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function shortMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-4)}` : mint;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  async function lookup(target: string) {
    // Guard against out-of-order responses: a slow earlier lookup must not
    // overwrite the result of a newer one.
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const res = await fetch(
        `/api/snapshot?address=${encodeURIComponent(target.trim())}`,
      );
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setSnapshot(data as Snapshot);
      }
    } catch {
      if (seq === requestSeq.current) {
        setError("Network error — could not reach the server. Try again.");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <h1>SnapSOL</h1>
        <p>
          Turn any Solana address into a one-page snapshot card — balances,
          holdings, and activity in plain language.
        </p>
        <span className="badge">Read-only · No wallet connection · No signing</span>
      </header>

      <form
        className="lookup"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(address);
        }}
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Paste a Solana address, e.g. Vote1111…"
          aria-label="Solana address"
          spellCheck={false}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Loading…" : "Snapshot"}
        </button>
      </form>
      <div className="examples">
        Try:{" "}
        {EXAMPLES.map((ex, i) => (
          <span key={ex.address}>
            {i > 0 && " · "}
            <button
              type="button"
              onClick={() => {
                setAddress(ex.address);
                lookup(ex.address);
              }}
            >
              {ex.label}
            </button>
          </span>
        ))}
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {snapshot && (
        <>
          <p className="mono" style={{ color: "var(--muted)" }}>
            {snapshot.address}
          </p>
          <div className="grid">
            <section className="panel">
              <h2>Panel 1 · Balance &amp; Value</h2>
              <div className="big">{fmt(snapshot.solBalance)} SOL</div>
              <div className="sub">
                {snapshot.solValueUsd !== null ? (
                  <>
                    ≈ ${fmt(snapshot.solValueUsd, 2)} USD
                    {snapshot.solPriceUsd !== null &&
                      ` · SOL price $${fmt(snapshot.solPriceUsd, 2)}`}
                  </>
                ) : (
                  "USD price unavailable right now."
                )}
                <br />
                Total portfolio value (SOL):{" "}
                {snapshot.totalValueUsd !== null
                  ? `$${fmt(snapshot.totalValueUsd, 2)}`
                  : "—"}
                <br />
                <em>Token USD pricing arrives with the MVP.</em>
              </div>
            </section>

            <section className="panel">
              <h2>Panel 2 · Token Holdings</h2>
              {snapshot.tokens.length === 0 ? (
                <div className="sub">
                  No SPL token balances found for this address.
                </div>
              ) : (
                <>
                  <table className="tokens">
                    <thead>
                      <tr>
                        <th>Mint</th>
                        <th className="amount">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.tokens.map((t) => (
                        <tr key={t.mint}>
                          <td className="mono">{shortMint(t.mint)}</td>
                          <td className="amount">{fmt(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sub" style={{ marginTop: 8 }}>
                    {snapshot.tokenCount} token{snapshot.tokenCount === 1 ? "" : "s"}
                    {snapshot.tokenCount > snapshot.tokens.length &&
                      ` (showing top ${snapshot.tokens.length})`}
                    . Full names &amp; USD prices arrive with the MVP.
                  </div>
                </>
              )}
            </section>

            <section className="panel placeholder">
              <span className="tag">Coming in MVP</span>
              <h2>Panel 3 · Recent Activity</h2>
              <div className="sub">
                The 10 most recent transactions, classified in plain language —
                transfer, swap, mint, or other. Not yet built; no data is shown
                here until it is real.
              </div>
            </section>

            <section className="panel placeholder">
              <span className="tag">Coming in MVP</span>
              <h2>Panel 4 · Snapshot Card</h2>
              <div className="sub">
                A downloadable, shareable image summarising this address.
                Not yet built.
              </div>
            </section>
          </div>
          <p className="sub" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
            Fetched {new Date(snapshot.fetchedAt).toLocaleString()} via{" "}
            {snapshot.rpc === "public"
              ? "the public Solana RPC"
              : snapshot.rpc === "helius"
                ? "Helius RPC"
                : "a custom RPC"}
            . Data is read live from Solana mainnet.
          </p>
        </>
      )}

      <footer>
        SnapSOL is strictly read-only: it never asks you to connect a wallet,
        sign a message, or enter a private key.
        <br />
        Skeleton build (Milestone 1) — Panels 1–2 live, Panels 3–4 in the MVP.
      </footer>
    </main>
  );
}
