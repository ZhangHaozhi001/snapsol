import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

/**
 * SnapSOL is strictly read-only: this module only ever *reads* public
 * on-chain data. It never creates keypairs, connects wallets, or signs.
 */

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export function rpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

export function getConnection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

/** Returns a PublicKey if the input is a valid base58 Solana address, else null. */
export function parseAddress(input: string): PublicKey | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const key = new PublicKey(trimmed);
    // PublicKey accepts some non-canonical forms; require an exact round-trip.
    if (key.toBase58() !== trimmed) return null;
    return key;
  } catch {
    return null;
  }
}

export interface TokenHolding {
  mint: string;
  amount: number; // human units (already divided by decimals)
  decimals: number;
  tokenAccounts: number; // how many token accounts hold this mint
}

export interface Snapshot {
  address: string;
  solBalance: number;
  solPriceUsd: number | null;
  solValueUsd: number | null;
  /** SOL value only in this skeleton; token USD pricing lands in the MVP. */
  totalValueUsd: number | null;
  tokens: TokenHolding[];
  tokenCount: number;
  fetchedAt: string;
  rpc: "helius" | "custom" | "public";
}

/**
 * SOL/USD spot price from CoinGecko's free public API. Returns null on any failure.
 * Cached for 60s (and concurrent callers share one in-flight request): CoinGecko's
 * free tier rate-limits quickly, and without the cache a burst of snapshots
 * loses the price entirely (verified in the 2026-11-16 recheck).
 */
const PRICE_CACHE_TTL_MS = 60_000;
let priceCache: { value: number; at: number } | null = null;
let priceInFlight: Promise<number | null> | null = null;

export function fetchSolPriceUsd(): Promise<number | null> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) {
    return Promise.resolve(priceCache.value);
  }
  if (priceInFlight) return priceInFlight;
  priceInFlight = (async () => {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { solana?: { usd?: number } };
      const value = typeof data.solana?.usd === "number" ? data.solana.usd : null;
      if (value !== null) priceCache = { value, at: Date.now() };
      return value;
    } catch {
      return null;
    } finally {
      priceInFlight = null;
    }
  })();
  return priceInFlight;
}

/** Reject if `promise` does not settle within `ms` — a hung RPC must not hang the page. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RPC_TIMEOUT")), ms),
    ),
  ]);
}

const RPC_TIMEOUT_MS = 15_000;

/** Concurrent requests for the same address share one upstream fetch. */
const snapshotInFlight = new Map<string, Promise<Snapshot>>();

export function fetchSnapshot(addressInput: string): Promise<Snapshot> {
  const owner = parseAddress(addressInput);
  if (!owner) return Promise.reject(new Error("INVALID_ADDRESS"));
  const key = owner.toBase58();
  const existing = snapshotInFlight.get(key);
  if (existing) return existing;
  const promise = fetchSnapshotUncached(owner).finally(() => {
    snapshotInFlight.delete(key);
  });
  snapshotInFlight.set(key, promise);
  return promise;
}

async function fetchSnapshotUncached(owner: PublicKey): Promise<Snapshot> {
  const connection = getConnection();
  const rpc = process.env.SOLANA_RPC_URL
    ? "custom"
    : process.env.HELIUS_API_KEY
      ? "helius"
      : "public";

  const [lamports, tokenAccountsLegacy, tokenAccounts2022, solPriceUsd] =
    await withTimeout(
      Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID,
        }),
        connection
          .getParsedTokenAccountsByOwner(owner, {
            programId: TOKEN_2022_PROGRAM_ID,
          })
          .catch((err) => {
            // Degrade to legacy-only results, but never silently: log it.
            console.warn("Token-2022 account fetch failed:", err);
            return { value: [] as never[] };
          }),
        fetchSolPriceUsd(),
      ]),
      RPC_TIMEOUT_MS,
    );

  // Merge balances per mint (a wallet can hold one mint in several accounts).
  const byMint = new Map<string, TokenHolding>();
  for (const { account } of [...tokenAccountsLegacy.value, ...tokenAccounts2022.value]) {
    const info = account.data.parsed?.info;
    const amount = info?.tokenAmount?.uiAmount;
    if (!info?.mint || typeof amount !== "number" || amount <= 0) continue;
    const existing = byMint.get(info.mint);
    if (existing) {
      existing.amount += amount;
      existing.tokenAccounts += 1;
    } else {
      byMint.set(info.mint, {
        mint: info.mint,
        amount,
        decimals: info.tokenAmount.decimals ?? 0,
        tokenAccounts: 1,
      });
    }
  }

  const tokens = [...byMint.values()].sort((a, b) => b.amount - a.amount);
  const solBalance = lamports / LAMPORTS_PER_SOL;
  const solValueUsd = solPriceUsd !== null ? solBalance * solPriceUsd : null;

  return {
    address: owner.toBase58(),
    solBalance,
    solPriceUsd,
    solValueUsd,
    totalValueUsd: solValueUsd,
    tokens: tokens.slice(0, 20),
    tokenCount: tokens.length,
    fetchedAt: new Date().toISOString(),
    rpc,
  };
}
