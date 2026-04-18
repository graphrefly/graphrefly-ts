// Browser stub for `node:fs`. The demo transitively pulls in
// `src/extra/sources.ts` via `patterns/_internal.ts` → `patterns/demo-shell.ts`
// → `patterns/reactive-layout`. `sources.ts` has a top-level
// `import { existsSync, watch } from "node:fs"` for its file-watcher source.
// None of that runs in the browser — these no-op stubs just satisfy the
// import so the module loads.
export const existsSync = () => false;
export const watch = () => ({ close: () => {} });
