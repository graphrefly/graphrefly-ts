# framework / vue

Minimal Vue 3 + GraphReFly counter.

- `useNodeInput(node)` -> `[Ref<T>, setter]` — tied to a writable node.
- `useNodeValue(node)` -> read-only `Ref<T>` — works for any node (here: a
  derived).

The helpers come from the focused `@graphrefly/ts/adapters/vue` subpath; subscriptions
clean up automatically on `onScopeDispose`.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
