import mermaid from "mermaid";

let initialized = false;

/** One-time mermaid init with the same dark palette the other demos use. */
export function initMermaid(): void {
	if (initialized) return;
	mermaid.initialize({
		startOnLoad: false,
		theme: "dark",
		securityLevel: "loose",
		fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
		themeVariables: {
			background: "#0a0a1a",
			primaryColor: "#14162a",
			primaryBorderColor: "#1e2444",
			primaryTextColor: "#f0f4ff",
			lineColor: "#4de8c2",
			secondaryColor: "#0e1020",
			tertiaryColor: "#0a0a1a",
			nodeBorder: "#1e2444",
			clusterBkg: "#0e1020",
			clusterBorder: "#1e2444",
			edgeLabelBackground: "#0e1020",
		},
	});
	initialized = true;
}

let renderCounter = 0;
export function nextMermaidId(): string {
	return `reactive-layout-mermaid-${++renderCounter}`;
}

export { mermaid };
