# compat / nanostores

Nanostores-style atom facades over caller-owned GraphReFly nodes.
Computed values are ordinary `g.derived(...)` nodes wrapped with
`nanoAtom(node)`. Demonstrates `subscribe` (fires with initial value) vs
`listen` (changes only).

## Run

```bash
pnpm install
pnpm start
```
