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

## Notes
- Jupiter's price API was unreachable/slow from the build environment, so
  the skeleton prices SOL via CoinGecko and shows token **amounts only**.
  Token USD pricing is MVP work, and Panel 2 says so in the UI.
- Public RPC is rate-limited; an optional `HELIUS_API_KEY` env var switches
  to Helius automatically (see `.env.example`).
