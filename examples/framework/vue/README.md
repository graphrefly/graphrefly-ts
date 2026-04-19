# framework / vue

Minimal Vue 3 + GraphReFly counter.

- `useStore(node)` → writable `Ref<T>` — ideal for `v-model` or direct
  assignment.
- `useSubscribe(node)` → read-only `Ref<T>` — works for any node (here: a
  derived).

Subscriptions are tied to the Vue effect scope and clean up automatically on
`onScopeDispose`.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
