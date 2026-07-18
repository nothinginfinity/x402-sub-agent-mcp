# Deploying x402-sub-agent-mcp from an iPhone

Everything here is tap/paste — no local terminal or laptop needed.
Deploys run via GitHub Actions (`.github/workflows/deploy.yml`), the same
pattern as the rest of the AFO fleet.

## 1. One-time Cloudflare setup

1. In Safari, go to the Cloudflare dashboard → **Workers & Pages → D1**.
2. Tap **Create database**, name it `x402-sub-agent-db`. After it's
   created, tap into it and copy the **Database ID** shown at the top.
3. Paste that ID into `wrangler.jsonc` in this repo, replacing
   `REPLACE_WITH_D1_DATABASE_ID` (edit the file directly on
   github.com — tap the pencil icon on the file page, paste, commit).
4. Still on the D1 database page, tap **Console**, and paste in the
   contents of `migrations/0001_initial.sql`, then run it. This creates
   the five tables the worker needs. (You can re-run this safely later —
   every statement is `CREATE TABLE IF NOT EXISTS`.)

## 2. One-time GitHub Actions secrets

This repo already has `.github/workflows/deploy.yml`, which deploys on
every push to `main`. It needs two repo secrets:

1. On github.com, open this repo → **Settings → Secrets and variables →
   Actions → New repository secret**.
2. Add `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with **Workers
   Scripts: Edit** and **D1: Edit** permissions (create one at
   dash.cloudflare.com → My Profile → API Tokens → Create Token).
3. Add `CLOUDFLARE_ACCOUNT_ID` — found on the right-hand sidebar of any
   page in your Cloudflare dashboard.

## 3. First deploy

Push any small change to `main` (even editing a comment in `README.md`
via the GitHub web editor works), or trigger it manually:

1. Go to this repo → **Actions** tab → **Deploy x402-sub-agent-mcp** →
   **Run workflow** → **Run workflow** button.
2. Watch the run. On success, your worker is live at
   `x402-sub-agent-mcp.<your-subdomain>.workers.dev`.

## 4. Verify it's alive

In Safari, open:

```
https://x402-sub-agent-mcp.<your-subdomain>.workers.dev/status
```

You should see `"ok": true` and `"bindings": { "DB": true, ... }`. If
`DB` is `false`, the D1 binding in `wrangler.jsonc` didn't take — re-check
step 1.3 and re-deploy.

## 5. Connect it as an MCP server

Add the worker's `/mcp` URL as a connector wherever you're calling it
from (Claude, another MCP client, etc):

```
https://x402-sub-agent-mcp.<your-subdomain>.workers.dev/mcp
```

It also answers plain `POST /call` with `{"name": "...", "arguments":
{...}}` if you'd rather call it as a plain REST API from another Worker
via a service binding or `fetch()`.

## 6. Point a protected Worker at it

In whatever Worker actually serves the paywalled resource, add a check
at the top of `fetch()`:

```js
const decision = await fetch('https://x402-sub-agent-mcp.<sub>.workers.dev/call', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'evaluate_request',
    arguments: {
      path: url.pathname,
      method: req.method,
      caller_id: req.headers.get('x-caller-id') || null,
      coupon_code: req.headers.get('x-coupon-code') || null,
      x_payment: req.headers.get('x-payment') || null
    }
  })
}).then(r => r.json());

if (decision.status === 402) {
  return new Response(JSON.stringify({
    x402Version: decision.x402Version, error: decision.error, accepts: decision.accepts
  }), { status: 402, headers: { 'content-type': 'application/json' } });
}
if (decision.status === 401) {
  return new Response(JSON.stringify({ error: decision.reason }), { status: 401 });
}
// decision.status === 200 -> serve the real resource
```

For lowest latency between two Workers on the same account, swap the
`fetch()` above for a **Cloudflare Service Binding** in the protected
Worker's `wrangler.jsonc` instead of a public URL — same pattern used
elsewhere in the AFO fleet to avoid the `*.workers.dev` → `*.workers.dev`
`fetch()` restriction (error 1042).

## 7. Choosing a facilitator

- `https://x402.org/facilitator` (the default in `wrangler.jsonc`) is a
  public facilitator good for **Base Sepolia testnet** development.
- For mainnet Base traffic, use Coinbase's CDP facilitator (requires a
  CDP API key) or run your own. Either way, set
  `X402_FACILITATOR_URL` in `wrangler.jsonc` → `vars`, or pass
  `facilitator_url` per-call to `evaluate_request` / `verify_payment` /
  `settle_payment` to override per-route.
- For an **internal/company token**, register it with
  `register_internal_token` (include your own `facilitator_url`), then
  point a `payment_rule` or `pricing_tier` at that network/asset.

## Version 2 follow-ups (not built in V1)

- **Cloudflare Rules expressions / Monetization Gateway** — currently
  route matching is a simple glob (`matchPattern` in `worker.js`); a V2
  could compile rules into real Cloudflare ruleset expressions for
  edge-level enforcement before the request even reaches a Worker.
- **Web Bot Auth verification** — V1 trusts a `bot_auth_verified` flag
  passed in by the caller; V2 should verify the HTTP Message Signatures
  directive itself (Cloudflare's Bot Management can supply this).
- **Signed coupon tokens** — V1 coupons are DB rows looked up by code;
  a signed JWT-style coupon would let edge logic validate trials without
  a DB round-trip.
- **Per-tier rate limiting** — a Durable Object per `caller_id` to cap
  requests/sec independent of payment.
- **Multi-facilitator failover** — retry against a secondary facilitator
  if the primary times out or is degraded.
- **Settlement webhooks** — notify a Slack/Discord/email target on large
  or failed settlements.
- **Variable/"upto" pricing enforcement** — `mode: 'upto'` is stored on
  `payment_rules` but V1's `evaluate_request` treats it the same as
  `exact`; V2 should let the resource Worker report actual usage after
  the fact and settle a variable amount.
