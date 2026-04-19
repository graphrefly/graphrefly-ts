import { DATA } from "@graphrefly/graphrefly/core";
import { fromRaf } from "@graphrefly/graphrefly/extra/sources";
import type {
	FlowContainer,
	Obstacle,
	PositionedLine,
} from "@graphrefly/graphrefly/reactive-layout";
import { useEffect, useRef, useState } from "react";
import { buildFlowChapter, type FlowChapter } from "../../lib/chapters/flow.js";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types.js";
import { useNodeValue } from "../../lib/use-node-value.js";

let cached: FlowChapter | null = null;
export function getFlowChapter(): FlowChapter {
	if (!cached) cached = buildFlowChapter();
	return cached;
}

type CircleAscii = {
	grid: string;
	left: number;
	top: number;
	width: number;
	height: number;
};

// ASCII art: obstacles rendered as monospace character grids. `CELL_W` is
// the ACTUAL rendered glyph width of the obstacle font — measured once via
// canvas so the DOM box and visible grid line up. Hardcoding CELL_W=7 when
// Fira Code 14px actually renders at ~8.4px/char caused the rect's right `│`
// column to sit past the geometric obstacle edge, where text would overlap it.
const CELL_H = 14;
const CELL_W: number = (() => {
	if (typeof document === "undefined") return 8.4;
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) return 8.4;
	// Match the font used by `.flow-obstacle pre` in layout.css.
	ctx.font = '14px "Fira Code", ui-monospace, "JetBrains Mono", monospace';
	const w = ctx.measureText("M").width;
	return Number.isFinite(w) && w > 0 ? w : 8.4;
})();
const CIRCLE_CHARS = {
	fill: "·",
	mid: "∙",
	edge: "●",
};

function renderCircleAscii(cx: number, cy: number, r: number): CircleAscii {
	// Cell-grid for the inner <pre>. The grid is a square array of cells; the
	// outer cells beyond the visible dot threshold render as spaces. The DOM
	// container sized below uses the GEOMETRIC diameter (2r × 2r), not the
	// cell grid size, so the hit target and dev-tools outline match the
	// obstacle's actual circular shape. The cell grid is flex-centered inside
	// the container and clipped via `overflow: hidden` + `border-radius: 50%`.
	const gridR = Math.max(1, Math.floor((r + CELL_W * 0.5) / CELL_W));
	const rowsHalf = Math.max(1, Math.floor((r + CELL_W * 0.5) / CELL_H));
	const lines: string[] = [];
	for (let row = -rowsHalf; row <= rowsHalf; row++) {
		let line = "";
		for (let col = -gridR; col <= gridR; col++) {
			const dx = col * CELL_W;
			const dy = row * CELL_H;
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d < r - CELL_W * 1.3) line += CIRCLE_CHARS.fill;
			else if (d < r - CELL_W * 0.3) line += CIRCLE_CHARS.mid;
			else if (d < r + CELL_W * 0.5) line += CIRCLE_CHARS.edge;
			else line += " ";
		}
		lines.push(line);
	}
	return {
		grid: lines.join("\n"),
		left: cx - r,
		top: cy - r,
		width: 2 * r,
		height: 2 * r,
	};
}

type RectAscii = {
	grid: string;
	left: number;
	top: number;
	width: number;
	height: number;
};

function renderRectAscii(x: number, y: number, w: number, h: number): RectAscii {
	const cols = Math.max(3, Math.round(w / CELL_W));
	const rows = Math.max(3, Math.round(h / CELL_H));
	const lines: string[] = [];
	for (let r = 0; r < rows; r++) {
		let line = "";
		for (let c = 0; c < cols; c++) {
			const isCorner =
				(r === 0 && c === 0) ||
				(r === 0 && c === cols - 1) ||
				(r === rows - 1 && c === 0) ||
				(r === rows - 1 && c === cols - 1);
			const isEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
			if (isCorner) line += "+";
			else if (isEdge && (r === 0 || r === rows - 1)) line += "─";
			else if (isEdge) line += "│";
			else line += " ";
		}
		lines.push(line);
	}
	return {
		grid: lines.join("\n"),
		left: x,
		top: y,
		width: cols * CELL_W,
		height: rows * CELL_H,
	};
}

type Drift = { vx: number; vy: number };
type DragState = {
	obstacleIndex: number;
	startClientX: number;
	startClientY: number;
	startObstacleX: number;
	startObstacleY: number;
	capturedElement: HTMLElement;
	pointerId: number;
};

// Pure drift step — reads current obstacles + container, returns next-frame
// positions. Velocities in `drifts[]` are mutated on wall hits (bounce), which
// is why the caller clones a fresh drift array per effect lifetime.
function driftObstacles(
	prev: Obstacle[],
	drifts: Drift[],
	dt: number,
	container: FlowContainer,
	draggedIdx: number,
): Obstacle[] {
	const padX = container.paddingX ?? 0;
	const padY = container.paddingY ?? 0;
	return prev.map((o, i) => {
		if (i === draggedIdx) return o;
		const drift = drifts[i]!;
		if (o.kind === "circle") {
			let cx = o.cx + drift.vx * dt * 0.06;
			let cy = o.cy + drift.vy * dt * 0.04;
			const minX = padX + o.r;
			const maxX = container.width - padX - o.r;
			const minY = padY + o.r;
			const maxY = container.height - padY - o.r;
			if (cx <= minX || cx >= maxX) {
				drift.vx *= -1;
				cx = Math.max(minX, Math.min(maxX, cx));
			}
			if (cy <= minY || cy >= maxY) {
				drift.vy *= -1;
				cy = Math.max(minY, Math.min(maxY, cy));
			}
			return { ...o, cx, cy };
		}
		let x = o.x + drift.vx * dt * 0.06;
		let y = o.y + drift.vy * dt * 0.04;
		const minX = padX;
		const maxX = container.width - padX - o.w;
		const minY = padY;
		const maxY = container.height - padY - o.h;
		if (x <= minX || x >= maxX) {
			drift.vx *= -1;
			x = Math.max(minX, Math.min(maxX, x));
		}
		if (y <= minY || y >= maxY) {
			drift.vy *= -1;
			y = Math.max(minY, Math.min(maxY, y));
		}
		return { ...o, x, y };
	});
}

export default function FlowChapterUI({ onHover }: ChapterProps) {
	const chapter = getFlowChapter();
	const lines = useNodeValue(chapter.bundle.flowLines) as PositionedLine[] | null;
	// Obstacles live in the graph — the demo reads them reactively and writes
	// back via chapter.bundle.setObstacles. No React state for obstacles.
	const obstacles =
		(useNodeValue(chapter.bundle.graph.node("obstacles")) as Obstacle[] | null) ??
		chapter.initialObstacles;

	const [paused, setPaused] = useState(false);
	const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
	const [frameSize, setFrameSize] = useState<{ width: number; height: number }>(() => {
		const c = chapter.bundle.graph.get("container") as FlowContainer;
		return { width: c.width, height: c.height };
	});
	const dragRef = useRef<DragState | null>(null);
	const frameHostRef = useRef<HTMLDivElement | null>(null);

	// Observe the host's available width; resize the flow container so the
	// layout stays within the pane. Fixed height (vertical scroll in the pane
	// handles the rest).
	useEffect(() => {
		const host = frameHostRef.current;
		if (!host) return;
		const apply = (w: number) => {
			const width = Math.max(240, Math.floor(w));
			setFrameSize((prev) => (prev.width === width ? prev : { ...prev, width }));
			chapter.setContainerSize(width, 540);
		};
		apply(host.clientWidth);
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			apply(entry.contentRect.width);
		});
		ro.observe(host);
		return () => ro.disconnect();
	}, [chapter]);

	// Reactive animation driver: fromRaf() emits per frame; each tick reads the
	// CURRENT container (so post-resize bounds are used) + CURRENT obstacles
	// from the graph, computes drift, writes back. The cursor for drift state
	// (velocities) is a fresh clone per effect run so pause/resume resets
	// cleanly instead of reusing mid-bounce velocities.
	useEffect(() => {
		if (paused) return;
		const drifts: Drift[] = chapter.initialObstacles.map((_, i) => ({
			vx: 0.18 + (i % 2 === 0 ? 0.05 : -0.04),
			vy: 0.12 + (i % 2 === 0 ? -0.03 : 0.05),
		}));
		const raf = fromRaf();
		let lastT = -1;
		const unsub = raf.subscribe((msgs) => {
			// Collect the latest DATA timestamp in this batch (rAF is single-
			// emission per tick, but batches can in principle coalesce).
			let t = -1;
			for (const m of msgs) {
				if (m[0] === DATA) t = m[1] as number;
			}
			if (t < 0) return;
			if (lastT < 0) {
				lastT = t;
				return;
			}
			const dt = Math.min(50, t - lastT);
			lastT = t;
			// Read current state each tick — avoids stale-closure bugs when
			// the container is resized mid-animation.
			const prev = chapter.bundle.graph.get("obstacles") as Obstacle[];
			const container = chapter.bundle.graph.get("container") as FlowContainer;
			const draggedIdx = dragRef.current?.obstacleIndex ?? -1;
			const next = driftObstacles(prev, drifts, dt, container, draggedIdx);
			chapter.bundle.setObstacles(next);
		});
		return () => unsub();
	}, [paused, chapter]);

	const onObstaclePointerDown = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
		e.preventDefault();
		e.stopPropagation();
		const ob = obstacles[i]!;
		const captured = e.currentTarget;
		dragRef.current = {
			obstacleIndex: i,
			startClientX: e.clientX,
			startClientY: e.clientY,
			startObstacleX: ob.kind === "circle" ? ob.cx : ob.x,
			startObstacleY: ob.kind === "circle" ? ob.cy : ob.y,
			capturedElement: captured,
			pointerId: e.pointerId,
		};
		setDraggingIdx(i);
		try {
			captured.setPointerCapture(e.pointerId);
		} catch {
			// Some browsers refuse capture on synthetic pointer events — fine,
			// drag still works via window-level move handlers.
		}
	};

	const onObstaclePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const s = dragRef.current;
		if (!s) return;
		const dx = e.clientX - s.startClientX;
		const dy = e.clientY - s.startClientY;
		const current = chapter.bundle.graph.get("obstacles") as Obstacle[];
		const next = [...current];
		const o = next[s.obstacleIndex]!;
		if (o.kind === "circle") {
			next[s.obstacleIndex] = { ...o, cx: s.startObstacleX + dx, cy: s.startObstacleY + dy };
		} else {
			next[s.obstacleIndex] = { ...o, x: s.startObstacleX + dx, y: s.startObstacleY + dy };
		}
		chapter.bundle.setObstacles(next);
	};

	const onObstaclePointerUp = (_e: React.PointerEvent<HTMLDivElement>) => {
		const s = dragRef.current;
		dragRef.current = null;
		setDraggingIdx(null);
		if (!s) return;
		try {
			s.capturedElement.releasePointerCapture(s.pointerId);
		} catch {
			// Capture may have been released implicitly — safe to ignore.
		}
	};

	const container = frameSize;

	return (
		<div className="chapter flow-chapter">
			<p className="chapter-lede">
				Two columns of essay text flowing around moving ASCII obstacles. Every frame,{" "}
				<code>flow-lines</code> recomputes per-line slots from obstacle intersections and fills each
				slot via a shared cursor — the cursor carries seamlessly between slots and between columns,
				so no text is duplicated and no gap appears at handoff. <code>segments</code> stays cached
				across frames. Drag obstacles to move them; click <em>Pause</em> to freeze drift.
			</p>

			<div className="controls">
				<button type="button" onClick={() => setPaused((p) => !p)}>
					{paused ? "Resume" : "Pause"}
				</button>
				<div className="flow-metrics" data-flow="metrics" {...hoverProps(onHover, "flow-lines")}>
					lines: <strong>{lines?.length ?? 0}</strong>
					{"  "}
					obstacles: <strong>{obstacles.length}</strong>
				</div>
			</div>

			<div className="flow-host" ref={frameHostRef} style={{ width: "100%", maxWidth: 720 }}>
				<div
					className="flow-frame"
					data-flow="container"
					style={{ width: container.width, height: container.height }}
					{...hoverProps(onHover, "container")}
				>
					<div className="flow-lines" data-flow="lines">
						{(lines ?? []).map((l, i, arr) => {
							const isLast = i === arr.length - 1;
							const textAlign = l.flushToRight ? "right" : "justify";
							const textAlignLast = isLast ? "left" : l.flushToRight ? "right" : "justify";
							return (
								<div
									key={`${i}-${l.y}-${l.x}`}
									className="flow-line"
									style={{
										left: l.x,
										top: l.y,
										width: l.slotWidth,
										textAlign,
										textAlignLast,
									}}
								>
									{l.text || "\u00a0"}
								</div>
							);
						})}
					</div>

					<div className="flow-obstacles" data-flow="obstacles">
						{obstacles.map((o, i) => {
							if (o.kind === "circle") {
								const ascii = renderCircleAscii(o.cx, o.cy, o.r);
								return (
									<div
										key={`circle-${i}`}
										className={`flow-obstacle flow-obstacle-circle${draggingIdx === i ? " dragging" : ""}`}
										style={{
											left: ascii.left,
											top: ascii.top,
											width: ascii.width,
											height: ascii.height,
										}}
										onPointerDown={(e) => onObstaclePointerDown(e, i)}
										onPointerMove={onObstaclePointerMove}
										onPointerUp={onObstaclePointerUp}
										onPointerCancel={onObstaclePointerUp}
									>
										<pre>{ascii.grid}</pre>
									</div>
								);
							}
							const ascii = renderRectAscii(o.x, o.y, o.w, o.h);
							// No `width` / `height` styles — let the <pre> define its
							// own rendered size (monospace glyph width isn't exactly
							// CELL_W, so a cell-grid-based width would clip the left/
							// right `│` column).
							return (
								<div
									key={`rect-${i}`}
									className={`flow-obstacle flow-obstacle-rect${draggingIdx === i ? " dragging" : ""}`}
									style={{ left: ascii.left, top: ascii.top }}
									onPointerDown={(e) => onObstaclePointerDown(e, i)}
									onPointerMove={onObstaclePointerMove}
									onPointerUp={onObstaclePointerUp}
									onPointerCancel={onObstaclePointerUp}
								>
									<pre>{ascii.grid}</pre>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
