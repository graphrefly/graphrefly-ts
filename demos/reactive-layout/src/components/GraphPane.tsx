import { useEffect, useRef } from "react";
import { initMermaid, mermaid, nextMermaidId } from "../lib/mermaid-render";
import { attachPanZoom } from "../lib/pan-zoom";

export default function GraphPane({
	text,
	hoverId,
	onHoverNode,
}: {
	text: string;
	hoverId: string | null;
	onHoverNode: (id: string | null) => void;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Keep the latest `onHoverNode` in a ref so the delegated listeners below
	// never go stale without us having to re-add them on every render.
	const onHoverNodeRef = useRef(onHoverNode);
	useEffect(() => {
		onHoverNodeRef.current = onHoverNode;
	}, [onHoverNode]);

	// One-time setup: pan/zoom + delegated hover listeners on the container.
	// Mermaid replaces the inner SVG on every text change, so per-node
	// `addEventListener`s would need re-binding (and their cleanup is
	// error-prone). Delegation sidesteps both issues: one pair of listeners
	// survives any number of mermaid re-renders.
	useEffect(() => {
		initMermaid();
		const el = containerRef.current;
		if (!el) return;
		const detachPanZoom = attachPanZoom(el);

		const nodeFor = (target: EventTarget | null): SVGGElement | null => {
			const t = target as Element | null;
			return (t?.closest("g.node[data-hover-id]") as SVGGElement | null) ?? null;
		};

		const onOver = (e: MouseEvent) => {
			const node = nodeFor(e.target);
			if (!node) return;
			const id = node.getAttribute("data-hover-id");
			if (id) onHoverNodeRef.current(id);
		};
		const onOut = (e: MouseEvent) => {
			const from = nodeFor(e.target);
			const to = nodeFor(e.relatedTarget);
			// Only clear when the pointer actually leaves a hover node (or
			// moves to a different one, in which case `onOver` fires first
			// with the new id — this clear is redundant and harmless).
			if (from && from !== to) onHoverNodeRef.current(null);
		};

		el.addEventListener("mouseover", onOver);
		el.addEventListener("mouseout", onOut);

		return () => {
			detachPanZoom();
			el.removeEventListener("mouseover", onOver);
			el.removeEventListener("mouseout", onOut);
		};
	}, []);

	// Render / re-render the mermaid diagram. After every successful render
	// we tag each `g.node` with `data-hover-id = label text` so both directions
	// of cross-highlighting (mouse ↔ highlight) can key off the GraphReFly
	// node path instead of Mermaid's synthetic `flowchart-n6-6` ids.
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
				const nodes = containerRef.current.querySelectorAll<SVGGElement>("g.node");
				nodes.forEach((n) => {
					const label = n.textContent?.trim() ?? "";
					if (label) {
						n.setAttribute("data-hover-id", label);
						n.style.cursor = "pointer";
					}
				});
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

	// Apply highlight style whenever hoverId changes.
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const all = el.querySelectorAll<SVGGElement>("g.node[data-hover-id]");
		all.forEach((n) => {
			const id = n.getAttribute("data-hover-id") ?? "";
			// Match either exact, or containment in either direction so that
			// hovering "segments" in the main pane also lights up the
			// `segments::__meta__::cache-hit-rate` meta node.
			const match =
				hoverId != null && (id === hoverId || id.includes(hoverId) || hoverId.includes(id));
			const rect = n.querySelector("rect, circle, polygon, path");
			if (rect) {
				(rect as SVGElement).setAttribute("stroke", match ? "#4de8c2" : "#1e2444");
				(rect as SVGElement).setAttribute("stroke-width", match ? "2.5" : "1");
			}
		});
	}, [hoverId]);

	return <div ref={containerRef} className="mermaid-graph" />;
}
