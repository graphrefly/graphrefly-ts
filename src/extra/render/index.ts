/**
 * Renderers barrel — pure functions over `GraphDescribeOutput` (Tier 2.1 A2).
 *
 * Each function takes a describe snapshot and returns a formatted string.
 * Compose with `derived` for live formatted output:
 *
 * ```ts
 * import { toMermaid } from "@graphrefly/graphrefly/extra/render";
 * import { derived } from "@graphrefly/graphrefly";
 *
 * const live = derived(
 *   [graph.describe({ reactive: true }).node],
 *   ([g]) => toMermaid(g),
 * );
 * ```
 *
 * Replaces the old `describe({ format })` dispatch — see Tier 1.5.1 deferred
 * "format option removal" entry in the implementation plan.
 *
 * @module
 */

export type { DiagramDirection } from "./_internal.js";
export type { LayoutDirection } from "./_layout-sugiyama.js";
export { type ToAsciiOptions, toAscii } from "./to-ascii.js";
export { type ToD2Options, toD2 } from "./to-d2.js";
export { type ToJsonOptions, toJson } from "./to-json.js";
export { type ToMermaidOptions, toMermaid } from "./to-mermaid.js";
export {
	type MermaidLiveTheme,
	mermaidLiveUrl,
	type ToMermaidUrlOptions,
	toMermaidUrl,
} from "./to-mermaid-url.js";
export { type ToPrettyOptions, toPretty } from "./to-pretty.js";
