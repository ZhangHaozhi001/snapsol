# Milestone 1 verification record

Verified 2026-11-16 (Asia/Shanghai) against Solana **mainnet** via the
public RPC (no API key), production build (`npm run build` ✅, Next.js
15.5.29) served with `npm run start`, plus a headless-browser screenshot
([screenshot-skeleton.png](screenshot-skeleton.png)).

## Live API tests

### 1. Vote Program — `Vote111111111111111111111111111111111111111`
- SOL balance: **0.000000001 SOL** (1 lamport — correct for this program account)
- SOL price at fetch: **$72.27** (CoinGecko)
- Token types found: **6** (merged per mint, zero balances excluded)

### 2. Raydium Authority V4 — `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- SOL balance: **6.395493637 SOL**
- SOL value: **$462.20** at $72.27/SOL (API run); **$460.92** at $72.07/SOL
  (browser run minutes later — price moves confirm live pricing)
- Token types found: **40**, top 20 shown in Panel 2

### 3. Invalid address — `not-a-real-address`
- HTTP **400**: "That doesn't look like a valid Solana address. Check for
  typos — addresses are base58, 32–44 characters, with no 0, O, I, or l."

### 4. Empty address
- HTTP **400**: "Please paste a Solana address first."

## Post-deployment recheck (2026-11-16, commit 450ae14)

Edge cases tested live: fresh zero-balance address (200, 0 SOL / 0 tokens),
System Program address (tokenCount 4,856 — spam airdrop accounts, handled),
USDC mint account (194 token types), malformed base58 (bad chars `0OIl`,
too short, too long, spaces-only, missing param — all 400 in <20 ms),
10× concurrent requests, and a dead-RPC instance.

Bugs found and fixed:
- **No RPC timeout**: a dead RPC took **41 s** to surface a 502. Added a
  15 s timeout around the RPC batch → dead RPC now 502s in **15.1 s**.
- **Price lost under load**: 10 concurrent snapshots all returned
  `solPriceUsd: null` (CoinGecko free-tier rate limit). SOL price is now
  cached 60 s and concurrent fetches share one in-flight request.
- **No request dedupe**: 10 concurrent same-address snapshots took ~31 s
  each and hit the RPC 10×. Same-address in-flight requests now share one
  upstream fetch → 10 concurrent returned in **~0.8 s each**, identical
  `fetchedAt`, price $72.19 for all.
- Token-2022 fetch failures were silently swallowed; they now log a
  server-side warning while degrading to legacy-only results.
- UI: stale-response race (slow earlier lookup could overwrite a newer
  one) fixed with a request sequence guard; dust amounts that round to 0
  now display as `<0.0001` instead of `0`; the second example now matches
  the README (Raydium Authority, not the USDC mint account); error box
  has `role="alert"`; oversized token amounts can wrap on mobile.

Final verification after fixes: production build ✅; Raydium Authority
**6.395493637 SOL, price $72.13, value $461.31, 40 token types** (200,
2.8 s); invalid address 400. Server logs clean throughout.

Known, not fixed (by design/scope): token amounts merge `uiAmount`
floats, so gigantic spam-token amounts can lose integer precision;
single-request latency is RPC-bound (~3–7 s on the public RPC — a Helius
key is the real fix); token USD pricing and Panels 3–4 remain MVP scope.
For token pricing, DexScreener's free token-profiles/pairs API or
Jupiter's price API (when reachable) are the candidates to evaluate at
MVP time — neither was reliable enough from this environment to wire in
during a recheck.

## Notes
- Jupiter's price API was unreachable/slow from the build environment, so
  the skeleton prices SOL via CoinGecko and shows token **amounts only**.
  Token USD pricing is MVP work, and Panel 2 says so in the UI.
- Public RPC is rate-limited; an optional `HELIUS_API_KEY` env var switches
  to Helius automatically (see `.env.example`).
