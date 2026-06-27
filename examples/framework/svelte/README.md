# framework / svelte

Minimal Svelte 5 (runes mode) + GraphReFly counter.

- `nodeWritable(node)` -> a Svelte writable store. `$value` reads it; assigning to
  `$value` writes back to the node.
- `nodeReadable(node)` -> a Svelte readable store for any node (here: a
  derived). Read as `$dbl`.

Both helpers come from the D238-focused `@graphrefly/ts/adapters/svelte` subpath. The `$`-prefix
auto-subscription is the idiomatic Svelte path and stays clean in runes mode.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
