/**
 * `toMermaidUrl(g, opts?)` — encode a {@link GraphDescribeOutput} as a
 * `https://mermaid.live/edit#base64:…` deep link.
 *
 * Round-trip with the mermaid.live editor's `/edit#base64:` share format —
 * payload is `base64url(JSON({code, mermaid: {theme}, ...}))`. No network
 * calls; the payload is encoded into the URL fragment.
 *
 * @category extra
 */

import type { GraphDescribeOutput } from "../../graph/graph.js";
import { type ToMermaidOptions, toMermaid } from "./to-mermaid.js";

export type MermaidLiveTheme = "default" | "dark" | "forest" | "neutral" | "base";

export type ToMermaidUrlOptions = ToMermaidOptions & {
	theme?: MermaidLiveTheme;
	autoSync?: boolean;
};

/**
 * Encode an arbitrary mermaid source string to a `mermaid.live` deep link.
 * Exported separately so callers that already rendered mermaid text can
 * upgrade to a live-editor URL without re-rendering.
 */
export function mermaidLiveUrl(
	mermaidSrc: string,
	opts?: { theme?: MermaidLiveTheme; autoSync?: boolean },
): string {
	const theme = opts?.theme ?? "default";
	const autoSync = opts?.autoSync ?? true;
	const payload = { code: mermaidSrc, mermaid: { theme }, autoSync };
	const json = JSON.stringify(payload);
	// Browsers + Node both expose globalThis.btoa; encode UTF-8 bytes first so
	// non-ASCII node names don't explode btoa. Then url-safe base64 (`+/=`→`-_` strip).
	const bytes = new TextEncoder().encode(json);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
	const b64 = globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `https://mermaid.live/edit#base64:${b64}`;
}

export function toMermaidUrl(g: GraphDescribeOutput, opts?: ToMermaidUrlOptions): string {
	const mermaidSrc = toMermaid(g, opts);
	return mermaidLiveUrl(mermaidSrc, opts);
}
