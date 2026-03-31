/**
 * Compat layer: compatibility wrappers for other state management libraries (Phase 5.1b).
 *
 * Framework adapters are optional peers. Install only what you use:
 * - `@graphrefly/graphrefly-ts/compat/react` -> `react`, `react-dom`
 * - `@graphrefly/graphrefly-ts/compat/vue` -> `vue`
 * - `@graphrefly/graphrefly-ts/compat/svelte` -> `svelte`
 * - `@graphrefly/graphrefly-ts/compat/solid` -> `solid-js`
 */
export * as jotai from "./jotai/index.js";
export * as nanostores from "./nanostores/index.js";
export * as react from "./react/index.js";
export * as signals from "./signals/index.js";
export * as solid from "./solid/index.js";
export * as svelte from "./svelte/index.js";
export * as vue from "./vue/index.js";
export * as zustand from "./zustand/index.js";
