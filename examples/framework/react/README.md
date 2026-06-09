# framework / react

Minimal React + GraphReFly counter.

- `useStore(node)` -> `[value, setValue]` — tied to a state node.
- `useSubscribe(node)` -> `value` — works for any node (here: a derived).

Both hooks are example-local glue over `@graphrefly/ts/adapters`
`reactExternalStore`, so no framework-specific public subpath is required.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
