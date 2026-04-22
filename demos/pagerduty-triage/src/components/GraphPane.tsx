import { useEffect, useRef } from "react";
import { initMermaid, mermaid, nextMermaidId } from "../lib/mermaid-render";
import { attachPanZoom } from "../lib/pan-zoom";

export default function GraphPane({ text }: { text: string }) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		initMermaid();
		const el = containerRef.current;
		if (!el) return;
		const detachPanZoom = attachPanZoom(el);
		return () => detachPanZoom();
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		if (!text) {
			el.innerHTML = "";
			return;
		}
		let cancelled = false;
		mermaid
			.render(nextMermaidId(), text)
			.then(({ svg, bindFunctions }) => {
				if (cancelled || !containerRef.current) return;
				containerRef.current.innerHTML = svg;
				bindFunctions?.(containerRef.current);
			})
			.catch((err) => {
				if (cancelled || !containerRef.current) return;
				console.warn("[GraphPane] mermaid render failed:", err);
				containerRef.current.textContent = text;
			});
		return () => {
			cancelled = true;
		};
	}, [text]);

	return <div ref={containerRef} className="mermaid-graph" />;
}
