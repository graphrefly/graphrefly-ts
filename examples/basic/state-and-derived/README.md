# basic / state-and-derived

The simplest possible GraphReFly example: a source `state()` node feeding a
`derived()` node, observed through `subscribe()`.

## Run

```bash
pnpm install
pnpm start
```

## Use as a starter

Inside this monorepo the example links `@graphrefly/graphrefly` via
`workspace:*`. To copy this folder into your own project, replace
`workspace:*` with a published version:

```json
"dependencies": {
  "@graphrefly/graphrefly": "^0.24.0"
}
```
