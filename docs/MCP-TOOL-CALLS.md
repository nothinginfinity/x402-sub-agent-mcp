# Example MCP tool calls

All examples show the `tools/call` `arguments` object — an LLM (Claude,
Grok, etc.) connected to this MCP server would call these by name.

## Protect a route with a flat price

```json
{
  "name": "create_payment_rule",
  "arguments": {
    "pattern": "/api/premium/*",
    "method": "GET",
    "price_usd": 0.01,
    "asset": "USDC",
    "network": "base",
    "pay_to": "0xYourWalletAddressHere",
    "description": "Premium dataset access"
  }
}
```

## Issue a 7-day free trial coupon for one route

```json
{
  "name": "issue_coupon",
  "arguments": {
    "kind": "trial",
    "scope_pattern": "/api/premium/*",
    "expires_in_days": 7,
    "note": "Trial for launch-week signups"
  }
}
```
Response includes `coupon.code`, e.g. `TRIAL-7K2QANFH` — hand that to
the caller; they pass it back as `coupon_code` on future requests.

## Give one enterprise customer a flat discounted rate + require identity

```json
{
  "name": "create_pricing_tier",
  "arguments": {
    "name": "Acme Corp enterprise",
    "caller_id": "acme-corp",
    "scope_pattern": "/api/premium/*",
    "price_usd": 0.002,
    "requires_identity": true,
    "note": "Negotiated flat rate, June 2026"
  }
}
```

## Register an internal company token

```json
{
  "name": "register_internal_token",
  "arguments": {
    "name": "AFO Credits",
    "network": "base",
    "asset": "AFOC",
    "asset_address": "0xYourTokenContractAddress",
    "facilitator_url": "https://facilitator.internal.example.com",
    "note": "Internal settlement for AFO-to-AFO sub-agent calls"
  }
}
```

## Evaluate an incoming request (called by a protected Worker, per-request)

No payment attached yet — expect a 402 challenge:
```json
{
  "name": "evaluate_request",
  "arguments": {
    "path": "/api/premium/dataset.json",
    "method": "GET",
    "caller_id": "acme-corp"
  }
}
```

With a coupon:
```json
{
  "name": "evaluate_request",
  "arguments": {
    "path": "/api/premium/dataset.json",
    "method": "GET",
    "coupon_code": "TRIAL-7K2QANFH"
  }
}
```

With a payment already attached (client retried after a 402):
```json
{
  "name": "evaluate_request",
  "arguments": {
    "path": "/api/premium/dataset.json",
    "method": "GET",
    "caller_id": "acme-corp",
    "x_payment": "eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3Qi..."
  }
}
```

## Check spend / access patterns over the last 30 days

```json
{ "name": "get_usage_stats", "arguments": { "days": 30, "recent": 10 } }
```

## List active coupons

```json
{ "name": "list_coupons", "arguments": { "active_only": true } }
```

## Revoke a coupon early

```json
{ "name": "revoke_coupon", "arguments": { "code": "TRIAL-7K2QANFH" } }
```
