/** Light mermaid palette — matches demos/shared/styles/tokens.css + homepage. */

export const MERMAID_THEME_VARIABLES = {
	background: "#f4f7f9",
	primaryColor: "#ffffff",
	primaryBorderColor: "rgba(7, 18, 30, 0.22)",
	primaryTextColor: "#07121e",
	lineColor: "#9bc400",
	secondaryColor: "#eceff2",
	tertiaryColor: "#f4f7f9",
	nodeBorder: "rgba(7, 18, 30, 0.22)",
	clusterBkg: "#eceff2",
	clusterBorder: "rgba(7, 18, 30, 0.22)",
	edgeLabelBackground: "#ffffff",
} as const;

/** GraphPane node highlight strokes (use with `data-hover-id` matching). */
export const MERMAID_NODE_STROKE_MATCH = "#9bc400";
export const MERMAID_NODE_STROKE_DEFAULT = "rgba(7, 18, 30, 0.22)";

export type MermaidLike = {
	initialize: (config: {
		startOnLoad: boolean;
		theme: string;
		securityLevel: string;
		fontFamily: string;
		themeVariables: Record<string, string>;
	}) => void;
};

let initialized = false;

/** One-time mermaid init — call from each demo with its local `mermaid` import. */
export function initMermaidRenderer(mermaid: MermaidLike): void {
	if (initialized) return;
	mermaid.initialize({
		startOnLoad: false,
		theme: "base",
		securityLevel: "loose",
		fontFamily: '"Sora", system-ui, sans-serif',
		themeVariables: { ...MERMAID_THEME_VARIABLES },
	});
	initialized = true;
}

const idCounters = new Map<string, number>();

/** Per-demo unique DOM ids for `mermaid.render(id, text)`. */
export function createNextMermaidId(prefix: string): () => string {
	return () => {
		const n = (idCounters.get(prefix) ?? 0) + 1;
		idCounters.set(prefix, n);
		return `${prefix}-mermaid-${n}`;
	};
}
