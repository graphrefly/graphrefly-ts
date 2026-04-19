# framework / react

Minimal React + GraphReFly counter.

- `useStore(node)` → `[value, setValue]` — tied to a state node.
- `useSubscribe(node)` → `value` — works for any node (here: a derived).

Both are powered by `useSyncExternalStore` so they integrate cleanly with
concurrent React.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
