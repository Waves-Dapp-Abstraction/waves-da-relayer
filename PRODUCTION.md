# Relayer — Production deployment

Use this checklist when running a relayer for **mainnet** or any public traffic.

---

## Required environment

| Variable | Production |
|----------|------------|
| `PRODUCTION` | `true` |
| `NODE_URL` | Mainnet or testnet node (must match `CHAIN_ID`) |
| `CHAIN_ID` | `87` mainnet, `84` testnet |
| `REGISTRY_ADDRESS` | Canonical registry for that network ([docs/REGISTRY.md](../docs/REGISTRY.md)) |
| `RELAYER_SEED` | Funded relayer account |
| `JWT_SECRET` | Random string, **32+ characters** (required when `PRODUCTION=true`) |
| `CORS_ORIGINS` | Comma-separated HTTPS origins of your dApp (required when `PRODUCTION=true`) |

## Strongly recommended

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Shared challenge store for multiple relayer instances |
| `RATE_LIMIT_MAX` | Max requests per IP per window (default `100`) |
| `RATE_LIMIT_WINDOW_MS` | Window in ms (default `60000`) |

Copy [`.env.mainnet.example`](.env.mainnet.example) as a starting point.

---

## Infrastructure

1. **HTTPS** — terminate TLS at reverse proxy (nginx, Caddy, cloud LB). Never send JWT over plain HTTP.
2. **Redis** — set `REDIS_URL` when running more than one instance; otherwise auth challenges are lost across pods.
3. **Secrets** — inject `JWT_SECRET` and `RELAYER_SEED` via secret manager, not git.
4. **Monitoring** — alert on 5xx, `BROADCAST_FAILED`, `REFUND_GUARD_FAILED`, high 401 rate.
5. **Funding** — relayer account needs WAVES for REGULAR invokes and network fees.

---

## `dappConfig.json`

- Whitelist only dApps and methods you operate
- Set `useVerifierMode: true` when the target dApp checks `originCaller`
- Never set `sponsorFee: true` with `useVerifierMode: true`

Reload requires process restart (config is loaded at startup).

---

## Security audit

Before mainnet: complete [internal/SECURITY_AUDIT.md](../internal/SECURITY_AUDIT.md) for contracts and relayer threat model.

---

## Dev / testnet (relaxed)

Use `.env.example` without `PRODUCTION=true`:

- In-memory challenges OK for local dev
- `CORS_ORIGINS` unset → allow all origins
- `JWT_SECRET` optional (dev fallback with warning)
