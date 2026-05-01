/**
 * Renderers barrel — pure functions over `GraphDescribeOutput` (Tier 2.1 A2).
 *
 * Each function takes a describe snapshot and returns a formatted string.
 * Compose with `derived` for live formatted output:
 *
 * ```ts
 * import { graphSpecToMermaid } from "@graphrefly/graphrefly/extra/render";
 * import { derived } from "@graphrefly/graphrefly";
 *
 * const live = derived(
 *   [graph.describe({ reactive: true }).node],
 *   ([g]) => graphSpecToMermaid(g),
 * );
 * ```
 *
 * Replaces the old `describe({ format })` dispatch — the `format` sugar option
 * was removed in the D1 three-layer-view refactor (pre-1.0 breaking, no shim).
 *
 * @module
 */

export type { DiagramDirection } from "./_internal.js";
export type { LayoutDirection } from "./_layout-sugiyama.js";
export { type GraphSpecToAsciiOptions, graphSpecToAscii } from "./graph-spec-to-ascii.js";
export { type GraphSpecToD2Options, graphSpecToD2 } from "./graph-spec-to-d2.js";
export { type GraphSpecToJsonOptions, graphSpecToJson } from "./graph-spec-to-json.js";
export { type GraphSpecToMermaidOptions, graphSpecToMermaid } from "./graph-spec-to-mermaid.js";
export {
	type GraphSpecToMermaidUrlOptions,
	graphSpecToMermaidUrl,
	type MermaidLiveTheme,
	mermaidLiveUrl,
} from "./graph-spec-to-mermaid-url.js";
export { type GraphSpecToPrettyOptions, graphSpecToPretty } from "./graph-spec-to-pretty.js";
export {
	type LayoutFrameToSvgOptions,
	layoutFrameToSvg,
} from "./layout-frame-to-svg.js";
