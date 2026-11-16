/**
 * SnapSOL is strictly read-only: this module only ever *reads* public
 * on-chain data. It never creates keypairs, connects wallets, or signs.
 *
 * Implementation note: this talks to Solana JSON-RPC with plain `fetch`
 * instead of @solana/web3.js. web3.js pulls in rpc-websockets, which
 * require()s an ESM-only uuid build — Vercel's serverless Node runtime
 * refuses it (ERR_REQUIRE_ESM, HTTP 500 on /api/snapshot). Plain fetch
 * keeps the server bundle free of that dependency chain entirely.
 */

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function rpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

/* ------------------------------------------------------------------ */
/* Base58 (tiny in-file codec; avoids adding a dependency for this)    */
/* ------------------------------------------------------------------ */

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_DIGITS = new Map<string, number>(
  [...BASE58_ALPHABET].map((ch, i) => [ch, i]),
);

/** Decodes a base58 string to bytes, or returns null on any invalid character. */
function base58Decode(input: string): Uint8Array | null {
  if (!input) return null;
  // Leading '1's are leading zero bytes.
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === "1") {
    leadingZeros++;
  }
  // Little-endian accumulator.
  const bytes: number[] = [];
  for (let i = leadingZeros; i < input.length; i++) {
    const digit = BASE58_DIGITS.get(input[i]);
    if (digit === undefined) return null;
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      const v = bytes[j] * 58 + carry;
      bytes[j] = v & 0xff;
      carry = v >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[out.length - 1 - i] = bytes[i];
  }
  return out;
}

function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros++;
  }
  const digits: number[] = []; // little-endian base58 digits
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      const v = digits[j] * 256 + carry;
      digits[j] = v % 58;
      carry = Math.floor(v / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out;
}

/**
 * Returns the canonical address string if the input is a valid Solana
 * address, else null. Equivalent to the previous PublicKey check: the
 * input must be base58, decode to exactly 32 bytes, and be the canonical
 * encoding of those bytes (exact round-trip).
 */
export function parseAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const decoded = base58Decode(trimmed);
  if (!decoded || decoded.length !== 32) return null;
  if (base58Encode(decoded) !== trimmed) return null;
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

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

interface ParsedTokenAccount {
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {
            uiAmount?: number | null;
            decimals?: number;
          };
        };
      };
    };
  };
}

/* ------------------------------------------------------------------ */
/* JSON-RPC over fetch                                                 */
/* ------------------------------------------------------------------ */

let rpcRequestId = 0;

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcRequestId,
      method,
      params,
    }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} for ${method}`);
  const data = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (data.error) {
    throw new Error(`RPC error for ${method}: ${data.error.message ?? "unknown"}`);
  }
  if (data.result === undefined) throw new Error(`RPC empty result for ${method}`);
  return data.result;
}

function getBalanceLamports(owner: string): Promise<number> {
  return rpcCall<{ value: number }>("getBalance", [
    owner,
    { commitment: "confirmed" },
  ]).then((r) => r.value);
}

function getParsedTokenAccounts(
  owner: string,
  programId: string,
): Promise<ParsedTokenAccount[]> {
  return rpcCall<{ value: ParsedTokenAccount[] }>(
    "getTokenAccountsByOwner",
    [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
  ).then((r) => r.value);
}

/* ------------------------------------------------------------------ */
/* SOL price (CoinGecko)                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

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
  const existing = snapshotInFlight.get(owner);
  if (existing) return existing;
  const promise = fetchSnapshotUncached(owner).finally(() => {
    snapshotInFlight.delete(owner);
  });
  snapshotInFlight.set(owner, promise);
  return promise;
}

async function fetchSnapshotUncached(owner: string): Promise<Snapshot> {
  const rpc = process.env.SOLANA_RPC_URL
    ? "custom"
    : process.env.HELIUS_API_KEY
      ? "helius"
      : "public";

  const [lamports, tokenAccountsLegacy, tokenAccounts2022, solPriceUsd] =
    await withTimeout(
      Promise.all([
        getBalanceLamports(owner),
        getParsedTokenAccounts(owner, TOKEN_PROGRAM_ID),
        getParsedTokenAccounts(owner, TOKEN_2022_PROGRAM_ID).catch((err) => {
          // Degrade to legacy-only results, but never silently: log it.
          console.warn("Token-2022 account fetch failed:", err);
          return [] as ParsedTokenAccount[];
        }),
        fetchSolPriceUsd(),
      ]),
      RPC_TIMEOUT_MS,
    );

  // Merge balances per mint (a wallet can hold one mint in several accounts).
  const byMint = new Map<string, TokenHolding>();
  for (const { account } of [...tokenAccountsLegacy, ...tokenAccounts2022]) {
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
        decimals: info.tokenAmount?.decimals ?? 0,
        tokenAccounts: 1,
      });
    }
  }

  const tokens = [...byMint.values()].sort((a, b) => b.amount - a.amount);
  const solBalance = lamports / LAMPORTS_PER_SOL;
  const solValueUsd = solPriceUsd !== null ? solBalance * solPriceUsd : null;

  return {
    address: owner,
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
