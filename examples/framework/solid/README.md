# framework / solid

Minimal SolidJS + GraphReFly counter.

- `createNodeInput(node)` -> `[Accessor<T>, setter]`.
- `createNodeValue(node)` -> `Accessor<T>` — works for any node (here: a derived).

The helpers come from the D238-focused `@graphrefly/ts/adapters/solid` subpath; cleanup is
tied to the Solid reactive owner via `onCleanup`.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
