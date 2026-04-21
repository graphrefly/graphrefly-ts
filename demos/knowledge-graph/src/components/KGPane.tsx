import { useEffect, useRef, useState } from "react";
import type { Entity, Relation } from "../lib/types";

type Edge = { from: string; to: string; relation: Relation };

type SimNode = {
	id: string;
	label: string;
	kind: Entity["kind"];
	x: number;
	y: number;
	vx: number;
	vy: number;
	fx: number | null;
	fy: number | null;
};

const W = 540;
const H = 380;
const CENTER_X = W / 2;
const CENTER_Y = H / 2;
const REPULSION = 1800;
const SPRING = 0.04;
const SPRING_LENGTH = 120;
const GRAVITY = 0.012;
const DAMPING = 0.82;
const MAX_SPEED = 6;
const NODE_RADIUS = 22;

/**
 * Tiny Verlet-ish force-directed layout. Built from scratch so the demo has
 * zero d3 dependency. The simulation runs continuously (rAF) and consumes
 * `entities` / `edges` props reactively — adding a node nudges the layout,
 * doesn't reset it.
 */
export default function KGPane({
	entities,
	edges,
	hoverId,
	onHover,
}: {
	entities: ReadonlyArray<Entity>;
	edges: ReadonlyArray<Edge>;
	hoverId: string | null;
	onHover: (id: string | null) => void;
}) {
	const simRef = useRef<Map<string, SimNode>>(new Map());
	const svgRef = useRef<SVGSVGElement | null>(null);
	const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
	// Latest edges stashed in a ref so the rAF tick reads the current value
	// without triggering loop re-creation on every KG update.
	const edgesRef = useRef(edges);
	edgesRef.current = edges;
	const [, force] = useState(0);

	// Sync entities into the simulation as a side effect (not a memo). New
	// nodes get random-ish initial positions near the center; existing
	// nodes keep their (x, y, v). Run on every entities change — React's
	// Strict Mode double-invoke is idempotent here because the work is
	// an upsert against a Map keyed on entity id.
	useEffect(() => {
		const map = simRef.current;
		const seenIds = new Set(entities.map((e) => e.id));
		for (const e of entities) {
			const existing = map.get(e.id);
			if (!existing) {
				const angle = (map.size * 137.5 * Math.PI) / 180; // golden-angle sprinkle
				const r = 60 + Math.random() * 40;
				map.set(e.id, {
					id: e.id,
					label: e.label,
					kind: e.kind,
					x: CENTER_X + Math.cos(angle) * r,
					y: CENTER_Y + Math.sin(angle) * r,
					vx: 0,
					vy: 0,
					fx: null,
					fy: null,
				});
			} else {
				existing.label = e.label;
				existing.kind = e.kind;
			}
		}
		for (const id of [...map.keys()]) {
			if (!seenIds.has(id)) map.delete(id);
		}
	}, [entities]);

	// rAF loop — integrate forces, then trigger a re-render. Depends on
	// nothing so the loop runs once per mount; it reads the latest edges
	// through `edgesRef.current` on each tick.
	useEffect(() => {
		let raf = 0;
		const tick = () => {
			step(simRef.current, edgesRef.current);
			force((n) => n + 1);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, []);

	// Pointer drag on nodes. Capture on `e.currentTarget` (the <g>) so events
	// continue routing to it even when the pointer leaves the inner <circle>
	// or <text>. `release` mirrors the same element.
	function onPointerDown(e: React.PointerEvent<SVGGElement>, id: string) {
		const svg = svgRef.current;
		if (!svg) return;
		dragRef.current = { id, pointerId: e.pointerId };
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			// some browsers throw if capture can't be acquired; drag will still
			// work via the svg-level pointermove below.
		}
		const node = simRef.current.get(id);
		if (node) {
			const pt = clientToSvg(svg, e.clientX, e.clientY);
			node.fx = pt.x;
			node.fy = pt.y;
		}
	}
	function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
		const drag = dragRef.current;
		if (!drag) return;
		const svg = svgRef.current;
		if (!svg) return;
		const node = simRef.current.get(drag.id);
		if (!node) return;
		const pt = clientToSvg(svg, e.clientX, e.clientY);
		node.fx = pt.x;
		node.fy = pt.y;
	}
	function onPointerUp(e: React.PointerEvent<SVGGElement>, id: string) {
		const drag = dragRef.current;
		if (!drag || drag.id !== id) return;
		const node = simRef.current.get(id);
		if (node) {
			node.fx = null;
			node.fy = null;
		}
		dragRef.current = null;
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			// already released (e.g., pointercancel fired) — fine
		}
	}
	// Safety-net cleanup if a drag ends outside any node element (mouse
	// leaves the window, tab switch, etc.). Releases the sticky pin.
	useEffect(() => {
		const onGlobalUp = () => {
			const drag = dragRef.current;
			if (!drag) return;
			const node = simRef.current.get(drag.id);
			if (node) {
				node.fx = null;
				node.fy = null;
			}
			dragRef.current = null;
		};
		window.addEventListener("pointerup", onGlobalUp);
		window.addEventListener("pointercancel", onGlobalUp);
		return () => {
			window.removeEventListener("pointerup", onGlobalUp);
			window.removeEventListener("pointercancel", onGlobalUp);
		};
	}, []);

	const sim = simRef.current;
	const isEmpty = entities.length === 0;

	return (
		<div className="kg-canvas" data-kg-pane>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${W} ${H}`}
				preserveAspectRatio="xMidYMid meet"
				onPointerMove={onPointerMove}
				role="img"
				aria-label="Knowledge graph: nodes and directional relations rendered with a force-directed layout"
			>
				<title>Knowledge graph (force-directed)</title>
				<defs>
					<marker
						id="kg-arrow"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#4de8c2" />
					</marker>
					<marker
						id="kg-arrow-dim"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#1e2444" />
					</marker>
				</defs>
				<g>
					{edges.map((edge) => {
						const a = sim.get(edge.from);
						const b = sim.get(edge.to);
						if (!a || !b) return null;
						const isHover = hoverId === edge.from || hoverId === edge.to;
						// Pull both endpoints back to each node's circle edge so
						// the line + arrowhead don't sit inside the node.
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const dist = Math.hypot(dx, dy) || 1;
						const ux = dx / dist;
						const uy = dy / dist;
						const x1 = a.x + ux * NODE_RADIUS;
						const y1 = a.y + uy * NODE_RADIUS;
						const x2 = b.x - ux * (NODE_RADIUS + 2);
						const y2 = b.y - uy * (NODE_RADIUS + 2);
						const mx = (x1 + x2) / 2;
						const my = (y1 + y2) / 2;
						return (
							<g
								key={`${edge.from}-${edge.to}-${edge.relation}`}
								className={`kg-edge${isHover ? " hover" : ""}`}
							>
								<line
									x1={x1}
									y1={y1}
									x2={x2}
									y2={y2}
									markerEnd={isHover ? "url(#kg-arrow)" : "url(#kg-arrow-dim)"}
								/>
								<text x={mx} y={my} textAnchor="middle" dy="-2">
									{edge.relation}
								</text>
							</g>
						);
					})}
				</g>
				<g>
					{[...sim.values()].map((n) => {
						const isHover = hoverId === n.id;
						const isDragging = dragRef.current?.id === n.id;
						return (
							<g
								key={n.id}
								className={`kg-node kind-${n.kind}${isHover ? " hover" : ""}${isDragging ? " dragging" : ""}`}
								onPointerDown={(e) => onPointerDown(e, n.id)}
								onPointerUp={(e) => onPointerUp(e, n.id)}
								onPointerEnter={() => onHover(n.id)}
								onPointerLeave={() => onHover(null)}
							>
								<circle cx={n.x} cy={n.y} r={NODE_RADIUS} />
								<text x={n.x} y={n.y + 3.5} textAnchor="middle">
									{n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
								</text>
							</g>
						);
					})}
				</g>
			</svg>
			{isEmpty && <div className="kg-empty">Empty graph — extract a paragraph to populate it.</div>}
		</div>
	);
}

function clientToSvg(svg: SVGSVGElement, cx: number, cy: number): { x: number; y: number } {
	const ctm = svg.getScreenCTM();
	if (!ctm) {
		// No CTM → svg not rendered. Fall back to an offset-relative approximation
		// so drags during chapter transitions don't jump to absurd coordinates.
		const rect = svg.getBoundingClientRect();
		return { x: cx - rect.left, y: cy - rect.top };
	}
	const pt = svg.createSVGPoint();
	pt.x = cx;
	pt.y = cy;
	const t = pt.matrixTransform(ctm.inverse());
	return { x: t.x, y: t.y };
}

function step(sim: Map<string, SimNode>, edges: ReadonlyArray<Edge>) {
	const nodes = [...sim.values()];
	if (nodes.length === 0) return;

	// Coulomb-ish repulsion: O(n²), fine for ≤30 nodes.
	for (let i = 0; i < nodes.length; i += 1) {
		const a = nodes[i]!;
		if (a.fx != null) continue;
		for (let j = i + 1; j < nodes.length; j += 1) {
			const b = nodes[j]!;
			let dx = a.x - b.x;
			let dy = a.y - b.y;
			let d2 = dx * dx + dy * dy;
			if (d2 < 1) {
				dx = Math.random() - 0.5;
				dy = Math.random() - 0.5;
				d2 = 1;
			}
			const force = REPULSION / d2;
			const inv = 1 / Math.sqrt(d2);
			const fx = dx * inv * force;
			const fy = dy * inv * force;
			a.vx += fx;
			a.vy += fy;
			if (b.fx == null) {
				b.vx -= fx;
				b.vy -= fy;
			}
		}
	}

	// Spring forces along edges.
	for (const edge of edges) {
		const a = sim.get(edge.from);
		const b = sim.get(edge.to);
		if (!a || !b) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const d = Math.sqrt(dx * dx + dy * dy) || 1;
		const force = SPRING * (d - SPRING_LENGTH);
		const fx = (dx / d) * force;
		const fy = (dy / d) * force;
		if (a.fx == null) {
			a.vx += fx;
			a.vy += fy;
		}
		if (b.fx == null) {
			b.vx -= fx;
			b.vy -= fy;
		}
	}

	// Gravity + integrate.
	for (const n of nodes) {
		if (n.fx != null) {
			n.x = n.fx;
			n.y = n.fy ?? n.y;
			n.vx = 0;
			n.vy = 0;
			continue;
		}
		n.vx += (CENTER_X - n.x) * GRAVITY;
		n.vy += (CENTER_Y - n.y) * GRAVITY;
		n.vx *= DAMPING;
		n.vy *= DAMPING;
		const speed = Math.hypot(n.vx, n.vy);
		if (speed > MAX_SPEED) {
			n.vx = (n.vx / speed) * MAX_SPEED;
			n.vy = (n.vy / speed) * MAX_SPEED;
		}
		n.x += n.vx;
		n.y += n.vy;
		// Soft walls.
		const m = NODE_RADIUS + 4;
		if (n.x < m) n.x = m;
		if (n.y < m) n.y = m;
		if (n.x > W - m) n.x = W - m;
		if (n.y > H - m) n.y = H - m;
	}
}
