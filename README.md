# Signal — Robinhood Chain launch scanner

Watches for new token/ETH pairs on Robinhood Chain (4663), runs a battery
of checks, and scores each 0-100 on a weighted composite.

## What it checks

**Weighted into the score:**

| Signal | Weight | Reliability |
|---|---|---|
| Liquidity lock | 22% | Deterministic — reads LP balances directly |
| Contract risk | 22% | Mixed — proxy detection is exact, bytecode flags are hints |
| Bundle % | 18% | Deterministic — computed from Transfer logs |
| Holder concentration | 15% | Deterministic — from Blockscout holder data |
| Deployer history | 13% | Partial — only knows launches this scanner has seen |
| Volume momentum | 10% | Rough proxy — tx count, not decoded swap events |

**Sellability is a veto, not a weight.** If the sell simulation reverts,
the score is 0 regardless of everything else. If sellability can't be
determined, the score is capped at 70 — unknown is not safe.

**Display-only, deliberately unscored:**

- **X/Twitter mentions** — requires `X_BEARER_TOKEN` (paid API). Shown
  as context, never scored. Mention count is the easiest signal in this
  whole list to fake; a bot swarm produces exactly the spike you'd read
  as organic interest. Do not let it override a bad contract score.

## Reliability — read this before trusting a score

Ranked from most to least trustworthy:

1. **Proxy detection (`src/proxy.js`) — exact.** EIP-1967/1822/1167/7702
   are spec-defined storage slots and bytecode shapes. If it says
   "upgradeable", it is.
2. **Bundle % (`src/bundle.js`) — exact.** Real Transfer logs from the
   launch block window. Not an estimate.
3. **LP lock — exact for the burn case.** ">=90% burned" is certain. A
   time-locked (not burned) LP shows as 50/"verify manually" because
   detecting arbitrary locker contracts isn't reliable.
4. **Sell simulation (`src/simulate.js`) — reliable when it runs.**
   Requires the RPC to support `eth_call` state overrides. If your RPC
   doesn't, it returns `unavailable` and caps the score. It never
   reports "safe" on a failed check.
5. **Bytecode selector flags (`src/bytecode.js`) — hints only.**
   Selector presence proves a function EXISTS, not that it will be used
   against you. Plenty of legitimate tokens have `pause()`. Equally, a
   contract can block sells through logic no selector reveals — which is
   exactly why sell simulation exists and why these flags don't get a
   veto. Use them as "go read the source", nothing more.
6. **Launchpad detection (`src/launchpad.js`) — NOT PREFILLED.** I don't
   have verified factory addresses for hood.fun, pons, or any other pad,
   and guessing would mislabel every token. Fill in `LAUNCHPADS` yourself:
   open a token you know came from that pad, check its creation tx on
   Blockscout, use the factory address. Until then everything reads
   "unknown".

## Setup

```bash
npm install
cp .env.example .env    # nothing required — defaults are the official addresses
npm run discover        # optional: confirm V2 vs V3 launch activity
```

### DEX addresses — confirmed

Uniswap deployed **both V2 and V3** to Robinhood Chain officially
([deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments)).
All addresses in `config.js` are now set from official sources — no
manual discovery needed to start.

| Contract | Address |
|---|---|
| UniswapV2Factory | `0x8bcEaA40…17937f` |
| UniswapV2Router02 | `0x89e5DB8B…649eba` |
| UniswapV3Factory | `0x1f7d7550…FD2EfA` |
| V3 SwapRouter02 | `0xCaf681a6…9E5cb2` |
| L2 WETH (Robinhood docs) | `0x0Bd7D308…AcAD73` |

**Both V2 and V3 are scanned.** Each row shows a `v2` or `v3 0.3%`
badge so you know which venue the pool is on. A token listed on both
keeps its higher-scoring venue and shows `also on …`.

The LP lock check differs by version, and the V3 one is weaker:

- **V2** — LP is a fungible ERC-20. `balanceOf(burn) / totalSupply` is
  a direct, complete answer.
- **V3** — liquidity is an ERC-721 position NFT. There's no on-chain
  index from pool to positions, so `scoreV3LpLock()` scans
  `IncreaseLiquidity` events for 50 blocks after launch and matches each
  tokenId's `positions()` triple against the pool. Liquidity added later
  than that window is invisible to it, and it reports
  "no V3 positions found" (score 50) rather than guessing. A burned
  position NFT — `ownerOf` reverting — is treated as the strongest lock,
  since a position with no owner can never be withdrawn.

Run `npm run discover` to see the actual V2/V3 split in recent blocks.

### Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `RH_FACTORY_ADDRESS` | no | official V2 factory | Override only if scanning a different DEX. |
| `RH_RPC_URL` | no | Robinhood public RPC | Swap for a private RPC if you hit rate limits — also more likely to support the state overrides the sell simulation needs. |
| `PORT` | no | 3000 | Dashboard port |
| `RH_ROUTER_ADDRESS` | no | official V2 router | Override only if scanning a different DEX. |
| `X_BEARER_TOKEN` | no | none | Paid X API key. Unset = social chip greyed out. |

Requires Node 20.6+ — the npm scripts load `.env` natively via
`--env-file-if-exists`, so no `dotenv` dependency.

If pm2 runs the scanner instead of npm, pass the flag yourself:
`pm2 start src/scanner.js --node-args="--env-file-if-exists=.env"`

## Run

```bash
npm run scan    # scanner -> data/tokens.json
npm start       # dashboard on :3000
```

Or as services:

```bash
npm install -g pm2
pm2 start src/scanner.js --name signal-scanner
pm2 start src/server.js  --name signal-web
pm2 save && pm2 startup
```

## Still missing

- **Sell tax magnitude.** The sim checks whether a sell succeeds, not
  what percentage you lose to it. A 90% sell tax passes as "sellable".
- **LP unlock timing.** A locked LP with a 1-hour unlock scores the same
  as one locked for a year.
- **Decoded swap events.** Momentum counts raw tx against the pair.
- **This does not trade.** It's a triage dashboard. Keep it that way
  until the scoring has a track record you actually trust.
