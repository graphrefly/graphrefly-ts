// Browser stub for `node:fs`. The demo pulls in `src/extra/sources.ts` via
// `patterns/_internal.ts` → `patterns/reactive-layout/reactive-layout.ts` → `demo-shell.ts`.
// `sources.ts` has a top-level `import { existsSync, watch } from "node:fs"` for its file-watcher
// source. The demo never calls the file-watcher, so these no-op stubs keep the
// module from throwing at import time in the browser.
export const existsSync = () => false;
export const watch = () => ({ close: () => {} });
