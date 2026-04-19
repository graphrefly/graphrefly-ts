# framework / solid

Minimal SolidJS + GraphReFly counter.

- `useStore(node)` → `[Accessor<T>, setter]`.
- `useSubscribe(node)` → `Accessor<T>` — works for any node (here: a derived).

Cleanup is tied to the Solid reactive owner via `onCleanup`.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
