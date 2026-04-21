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
	const onHoverNodeRef = useRef(onHoverNode);
	useEffect(() => {
		onHoverNodeRef.current = onHoverNode;
	}, [onHoverNode]);

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

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const all = el.querySelectorAll<SVGGElement>("g.node[data-hover-id]");
		all.forEach((n) => {
			const id = n.getAttribute("data-hover-id") ?? "";
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
