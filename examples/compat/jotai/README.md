# compat / jotai

Jotai-style atom facades over caller-owned GraphReFly nodes. Primitive
writes use `g.state(...)`, derived reads use `g.derived(...)`, and
`jotaiAtom(node)` exposes the tiny atom-like surface plus `._node`.

## Run

```bash
pnpm install
pnpm start
```
