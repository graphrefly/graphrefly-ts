# framework / react

Minimal React + GraphReFly counter.

- `useNodeInput(node)` -> `[value, setValue]` — tied to a state node.
- `useNodeValue(node)` -> `value` — works for any node (here: a derived).

Both hooks come from the focused `@graphrefly/ts/adapters/react` subpath.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
