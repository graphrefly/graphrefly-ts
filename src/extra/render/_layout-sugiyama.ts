/**
 * Sugiyama-style layered DAG layout on an integer grid.
 *
 * Pipeline:
 *   1. Longest-path layer assignment (sources at layer 0).
 *   2. Virtual-node splitting — every edge spanning more than one layer
 *      becomes a chain of synthetic nodes on intermediate layers. Downstream
 *      passes treat real and virtual nodes identically; crossing
 *      minimization therefore works on wide + deep DAGs, not only
 *      adjacent-layer cases.
 *   3. Crossing minimization — barycenter heuristic with alternating up /
 *      down sweeps plus an adjacent-transposition polish pass.
 *   4. Coordinate assignment — greedy median-aligned packing with collision
 *      resolution. Straightens vertical runs of virtual nodes so long edges
 *      become straight lines where topology allows.
 *   5. Orthogonal edge routing — per-gutter x-track assignment; horizontal
 *      segments sit at endpoint centerlines, vertical segments pack into the
 *      gutter column range without overlap. Remaining crossings are
 *      topologically unavoidable and will render as `┼` at draw time.
 *
 * Output coordinates are cell-grid integers (LR direction). TD rendering
 * swaps axes at draw time — the layout is direction-agnostic by
 * construction.
 *
 * Used only by [to-ascii.ts](./to-ascii.ts); not part of the public
 * `extra/render/index.ts` surface (underscore-prefixed).
 */

export type LayoutDirection = "LR" | "TD";

export type LayoutInput = {
	/** Node ids in stable iteration order. Determines initial tie-break. */
	readonly nodes: readonly string[];
	/** Edges by (from, to) path. Endpoints must be present in `nodes`. */
	readonly edges: ReadonlyArray<{ from: string; to: string }>;
	/** Label width in cells for each node (independent of direction). */
	readonly widthCells: (id: string) => number;
	/** Label height in cells for each node (independent of direction). */
	readonly heightCells: (id: string) => number;
	/**
	 * Gap between layer "columns" (LR) or "rows" (TD), in cells.
	 * Must allow enough room for per-gutter edge tracks.
	 */
	readonly layerGap: number;
	/**
	 * Gap between neighboring nodes *within* a layer, in cells.
	 * LR: vertical gap; TD: horizontal gap.
	 */
	readonly nodeGap: number;
	/**
	 * Axis orientation. LR: layers = columns (x grows), order = rows (y grows).
	 * TD: layers = rows (y grows), order = columns (x grows).
	 */
	readonly direction: LayoutDirection;
};

export type LayoutBox = {
	readonly id: string;
	readonly layer: number;
	readonly order: number;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
};

export type LayoutEdgePoint = { readonly x: number; readonly y: number };

export type LayoutEdge = {
	readonly from: string;
	readonly to: string;
	/** Polyline of waypoints (start → corners → end). Minimum 2 entries. */
	readonly points: readonly LayoutEdgePoint[];
};

export type LayoutResult = {
	readonly boxes: readonly LayoutBox[];
	readonly edges: readonly LayoutEdge[];
	readonly width: number;
	readonly height: number;
};

// ---------------------------------------------------------------------------
// Internal types — carried through the pipeline
// ---------------------------------------------------------------------------

type Hop = {
	chainId: number;
	chainFrom: string;
	chainTo: string;
	fromId: string;
	toId: string;
	/** 0-based hop index along the chain. */
	hopIndex: number;
	/** Total hops in the chain (1 = direct, 2+ = spans virtuals). */
	chainLen: number;
};

type InternalNode = {
	id: string;
	isVirtual: boolean;
	layer: number;
	order: number;
	x: number;
	y: number;
	w: number;
	h: number;
	in: Hop[];
	out: Hop[];
};

type Layer = InternalNode[];

type PipelineState = {
	nodes: Map<string, InternalNode>;
	layers: Layer[];
	hops: Hop[];
};

// ---------------------------------------------------------------------------
// Pipeline entry
// ---------------------------------------------------------------------------

export function sugiyamaLayout(input: LayoutInput): LayoutResult {
	const state = buildInitial(input);
	assignLayers(state);
	insertVirtualNodes(state);
	minimizeCrossings(state);
	assignCoordinates(state, input);
	const edges = routeEdges(state, input);
	const { width, height } = boundingBox(state);
	const boxes: LayoutBox[] = [];
	for (const layer of state.layers) {
		for (const n of layer) {
			if (n.isVirtual) continue;
			boxes.push({
				id: n.id,
				layer: n.layer,
				order: n.order,
				x: n.x,
				y: n.y,
				w: n.w,
				h: n.h,
			});
		}
	}
	return { boxes, edges, width, height };
}

// ---------------------------------------------------------------------------
// 1. Build internal graph
// ---------------------------------------------------------------------------

function buildInitial(input: LayoutInput): PipelineState {
	const nodes = new Map<string, InternalNode>();
	for (const id of input.nodes) {
		nodes.set(id, {
			id,
			isVirtual: false,
			layer: -1,
			order: 0,
			x: 0,
			y: 0,
			w: input.widthCells(id),
			h: input.heightCells(id),
			in: [],
			out: [],
		});
	}
	const hops: Hop[] = [];
	let chainId = 0;
	for (const e of input.edges) {
		if (e.from === e.to) continue; // drop self-loops
		const f = nodes.get(e.from);
		const t = nodes.get(e.to);
		if (!f || !t) continue; // drop dangling endpoints
		const hop: Hop = {
			chainId: chainId++,
			chainFrom: e.from,
			chainTo: e.to,
			fromId: e.from,
			toId: e.to,
			hopIndex: 0,
			chainLen: 1,
		};
		f.out.push(hop);
		t.in.push(hop);
		hops.push(hop);
	}
	return { nodes, layers: [], hops };
}

// ---------------------------------------------------------------------------
// 2. Longest-path layer assignment (Kahn's algorithm)
// ---------------------------------------------------------------------------

function assignLayers(state: PipelineState): void {
	const indeg = new Map<string, number>();
	for (const n of state.nodes.values()) indeg.set(n.id, n.in.length);

	const queue: InternalNode[] = [];
	for (const n of state.nodes.values()) {
		if ((indeg.get(n.id) ?? 0) === 0) {
			n.layer = 0;
			queue.push(n);
		}
	}

	// Cursor-based BFS — `Array.prototype.shift` is O(n), so the naive form
	// is O(n²) and degrades past ~1000 nodes. Cursor keeps it linear.
	const visited = new Set<string>();
	let head = 0;
	while (head < queue.length) {
		const n = queue[head++]!;
		if (visited.has(n.id)) continue;
		visited.add(n.id);
		for (const hop of n.out) {
			const t = state.nodes.get(hop.toId)!;
			t.layer = Math.max(t.layer, n.layer + 1);
			const d = (indeg.get(t.id) ?? 0) - 1;
			indeg.set(t.id, d);
			if (d <= 0) queue.push(t);
		}
	}
	// Nodes trapped in a cycle default to layer 0. The edges that would
	// close the cycle are dropped in `insertVirtualNodes` (any hop whose
	// span is not a positive integer). GraphReFly graphs are DAGs by spec;
	// this path is defensive against malformed describe snapshots.
	for (const n of state.nodes.values()) if (n.layer < 0) n.layer = 0;
}

// ---------------------------------------------------------------------------
// 3. Virtual-node insertion — critical for scaling past adjacent-layer edges
// ---------------------------------------------------------------------------

function insertVirtualNodes(state: PipelineState): void {
	const maxLayer = Math.max(0, ...Array.from(state.nodes.values(), (n) => n.layer));
	const layers: Layer[] = Array.from({ length: maxLayer + 1 }, () => []);
	for (const n of state.nodes.values()) layers[n.layer]!.push(n);

	const newHops: Hop[] = [];
	let virtCounter = 0;
	for (const hop of state.hops) {
		const f = state.nodes.get(hop.fromId)!;
		const t = state.nodes.get(hop.toId)!;
		const span = t.layer - f.layer;
		if (span <= 0) {
			// Same-layer or back-edge — the input violated the DAG invariant
			// (self-loop was already dropped in `buildInitial`; this catches
			// cycles whose nodes collapsed to layer 0 in `assignLayers`).
			// Drop from both endpoints so routing never sees the hop; same
			// render-best-effort policy as the self-loop / dangling-endpoint
			// filters in `buildInitial`.
			f.out = f.out.filter((h) => h !== hop);
			t.in = t.in.filter((h) => h !== hop);
			continue;
		}
		if (span === 1) {
			hop.hopIndex = 0;
			hop.chainLen = 1;
			newHops.push(hop);
			continue;
		}
		// Multi-hop: f → v1 → v2 → ... → t
		// Detach the original edge from f.out / t.in; we rewrite as chain.
		f.out = f.out.filter((h) => h !== hop);
		t.in = t.in.filter((h) => h !== hop);

		let prev = f;
		for (let i = 1; i < span; i += 1) {
			const vid = `__virt_${virtCounter++}__`;
			const v: InternalNode = {
				id: vid,
				isVirtual: true,
				layer: f.layer + i,
				order: 0,
				x: 0,
				y: 0,
				w: 0,
				h: 1,
				in: [],
				out: [],
			};
			state.nodes.set(vid, v);
			layers[v.layer]!.push(v);
			const h: Hop = {
				chainId: hop.chainId,
				chainFrom: hop.chainFrom,
				chainTo: hop.chainTo,
				fromId: prev.id,
				toId: vid,
				hopIndex: i - 1,
				chainLen: span,
			};
			prev.out.push(h);
			v.in.push(h);
			newHops.push(h);
			prev = v;
		}
		const finalHop: Hop = {
			chainId: hop.chainId,
			chainFrom: hop.chainFrom,
			chainTo: hop.chainTo,
			fromId: prev.id,
			toId: t.id,
			hopIndex: span - 1,
			chainLen: span,
		};
		prev.out.push(finalHop);
		t.in.push(finalHop);
		newHops.push(finalHop);
	}

	// Stable initial order within each layer.
	for (const layer of layers) {
		for (let i = 0; i < layer.length; i += 1) layer[i]!.order = i;
	}
	state.layers = layers;
	state.hops = newHops;
}

// ---------------------------------------------------------------------------
// 4. Crossing minimization
// ---------------------------------------------------------------------------

function minimizeCrossings(state: PipelineState): void {
	const SWEEPS = 4;
	for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
		// Down-sweep
		for (let li = 1; li < state.layers.length; li += 1) {
			sortByBarycenter(state, state.layers[li]!, "in");
			reindex(state.layers[li]!);
		}
		// Up-sweep
		for (let li = state.layers.length - 2; li >= 0; li -= 1) {
			sortByBarycenter(state, state.layers[li]!, "out");
			reindex(state.layers[li]!);
		}
	}
	// Polish — adjacent-transposition pass, bounded iterations.
	for (let iter = 0; iter < 2; iter += 1) {
		let improved = false;
		for (let li = 1; li < state.layers.length; li += 1) {
			const layer = state.layers[li]!;
			for (let i = 0; i + 1 < layer.length; i += 1) {
				const before = pairCrossings(state, layer[i]!, layer[i + 1]!, "in");
				[layer[i], layer[i + 1]] = [layer[i + 1]!, layer[i]!];
				reindex(layer);
				const after = pairCrossings(state, layer[i]!, layer[i + 1]!, "in");
				if (after < before) {
					improved = true;
				} else {
					[layer[i], layer[i + 1]] = [layer[i + 1]!, layer[i]!];
					reindex(layer);
				}
			}
		}
		if (!improved) break;
	}
}

function sortByBarycenter(state: PipelineState, layer: Layer, direction: "in" | "out"): void {
	const bary = new Map<string, number>();
	for (const n of layer) {
		const neighbors = direction === "in" ? n.in : n.out;
		if (neighbors.length === 0) {
			bary.set(n.id, n.order);
			continue;
		}
		let sum = 0;
		let count = 0;
		for (const h of neighbors) {
			const other = state.nodes.get(direction === "in" ? h.fromId : h.toId);
			if (!other) continue;
			sum += other.order;
			count += 1;
		}
		bary.set(n.id, count === 0 ? n.order : sum / count);
	}
	layer.sort((a, b) => {
		const ba = bary.get(a.id)!;
		const bb = bary.get(b.id)!;
		if (ba !== bb) return ba - bb;
		return a.order - b.order;
	});
}

function reindex(layer: Layer): void {
	for (let i = 0; i < layer.length; i += 1) layer[i]!.order = i;
}

function pairCrossings(
	state: PipelineState,
	a: InternalNode,
	b: InternalNode,
	direction: "in" | "out",
): number {
	const aEdges = direction === "in" ? a.in : a.out;
	const bEdges = direction === "in" ? b.in : b.out;
	let crossings = 0;
	for (const ea of aEdges) {
		for (const eb of bEdges) {
			const oa = state.nodes.get(direction === "in" ? ea.fromId : ea.toId)?.order ?? 0;
			const ob = state.nodes.get(direction === "in" ? eb.fromId : eb.toId)?.order ?? 0;
			if ((a.order < b.order && oa > ob) || (a.order > b.order && oa < ob)) {
				crossings += 1;
			}
		}
	}
	return crossings;
}

// ---------------------------------------------------------------------------
// 5. Coordinate assignment (direction-aware)
// ---------------------------------------------------------------------------

function assignCoordinates(state: PipelineState, input: LayoutInput): void {
	if (input.direction === "LR") assignCoordinatesLR(state, input);
	else assignCoordinatesTD(state, input);
}

function assignCoordinatesLR(state: PipelineState, input: LayoutInput): void {
	// x: per-layer column based on cumulative max width.
	const layerX: number[] = [];
	let cursorX = 0;
	for (let li = 0; li < state.layers.length; li += 1) {
		layerX.push(cursorX);
		let maxW = 0;
		for (const n of state.layers[li]!) maxW = Math.max(maxW, n.w);
		cursorX += maxW + input.layerGap;
	}
	for (let li = 0; li < state.layers.length; li += 1) {
		for (const n of state.layers[li]!) n.x = layerX[li]!;
	}
	// y: greedy pack per layer.
	for (const layer of state.layers) {
		let y = 0;
		for (const n of layer) {
			n.y = y;
			y += n.h + input.nodeGap;
		}
	}
	// Median alignment — straightens chains through virtuals.
	runMedianPasses(state, input, "y");
}

function assignCoordinatesTD(state: PipelineState, input: LayoutInput): void {
	// y: per-layer row based on cumulative max height.
	const layerY: number[] = [];
	let cursorY = 0;
	for (let li = 0; li < state.layers.length; li += 1) {
		layerY.push(cursorY);
		let maxH = 0;
		for (const n of state.layers[li]!) maxH = Math.max(maxH, n.h);
		cursorY += maxH + input.layerGap;
	}
	for (let li = 0; li < state.layers.length; li += 1) {
		for (const n of state.layers[li]!) n.y = layerY[li]!;
	}
	// x: greedy pack per layer.
	for (const layer of state.layers) {
		let x = 0;
		for (const n of layer) {
			n.x = x;
			x += n.w + input.nodeGap;
		}
	}
	runMedianPasses(state, input, "x");
}

/**
 * Median alignment passes — pulls each node toward the median position of
 * its in-layer neighbors along the private axis ("y" for LR, "x" for TD),
 * then resolves collisions greedily while preserving layer order.
 */
function runMedianPasses(state: PipelineState, input: LayoutInput, axis: "x" | "y"): void {
	const sizeOf = (n: InternalNode) => (axis === "y" ? n.h : n.w);
	const gap = input.nodeGap;
	for (let pass = 0; pass < 2; pass += 1) {
		const walk = pass === 0 ? state.layers.slice(1) : state.layers.slice(0, -1).reverse();
		for (const layer of walk) {
			const preferred = new Map<string, number>();
			for (const n of layer) {
				const neighbors = pass === 0 ? n.in : n.out;
				if (neighbors.length === 0) continue;
				const centers: number[] = [];
				for (const h of neighbors) {
					const other = state.nodes.get(pass === 0 ? h.fromId : h.toId);
					if (!other) continue;
					const base = axis === "y" ? other.y : other.x;
					centers.push(base + Math.floor(sizeOf(other) / 2));
				}
				if (centers.length === 0) continue;
				centers.sort((a, b) => a - b);
				const mid = centers[Math.floor(centers.length / 2)]!;
				preferred.set(n.id, mid - Math.floor(sizeOf(n) / 2));
			}
			let floor = 0;
			for (const n of layer) {
				const p = preferred.get(n.id);
				const current = axis === "y" ? n.y : n.x;
				const target = p ?? current;
				const clamped = Math.max(target, floor);
				if (axis === "y") n.y = clamped;
				else n.x = clamped;
				floor = clamped + sizeOf(n) + gap;
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 6. Orthogonal edge routing (direction-aware)
//
// For both LR and TD the algorithm is symmetric — it just operates on a
// different pair of "primary" vs "cross" axes:
//
//   LR: primary = x (layer axis); cross = y. Gutters are vertical strips
//       between columns; tracks within a gutter are distinct x-values.
//   TD: primary = y (layer axis); cross = x. Gutters are horizontal strips
//       between rows; tracks within a gutter are distinct y-values.
// ---------------------------------------------------------------------------

function routeEdges(state: PipelineState, input: LayoutInput): LayoutEdge[] {
	// Group hops by chainId → one LayoutEdge per user-facing edge.
	const byChain = new Map<number, Hop[]>();
	for (const h of state.hops) {
		const arr = byChain.get(h.chainId);
		if (arr) arr.push(h);
		else byChain.set(h.chainId, [h]);
	}
	for (const arr of byChain.values()) arr.sort((a, b) => a.hopIndex - b.hopIndex);

	const isLR = input.direction === "LR";
	const primary = (n: InternalNode): number => (isLR ? n.x : n.y);
	const primarySize = (n: InternalNode): number => (isLR ? n.w : n.h);
	const crossCenter = (n: InternalNode): number =>
		isLR ? n.y + Math.floor(n.h / 2) : n.x + Math.floor(n.w / 2);

	// Per-gutter cross-axis track assignment. Two passes:
	//   1. Assign each hop to a track INDEX using disjoint-interval packing
	//      (an existing track may host multiple hops as long as their
	//      cross-axis ranges don't overlap pairwise).
	//   2. Map each track index to a primary-axis position using the final
	//      track count so the distribution is uniform across the gutter —
	//      per-hop recomputation (old behavior) collapsed late tracks onto
	//      `gEnd`, producing bundled overlaps in dense gutters.
	const hopTrackCross = new Map<Hop, number>();
	for (let g = 0; g + 1 < state.layers.length; g += 1) {
		const srcLayer = state.layers[g]!;
		const dstLayer = state.layers[g + 1]!;

		let gutterStart = 0;
		for (const n of srcLayer) gutterStart = Math.max(gutterStart, primary(n) + primarySize(n));
		let gutterEnd = Number.POSITIVE_INFINITY;
		for (const n of dstLayer) gutterEnd = Math.min(gutterEnd, primary(n));
		const gEnd = Number.isFinite(gutterEnd) ? (gutterEnd as number) - 1 : gutterStart;
		const gutterWidth = Math.max(1, gEnd - gutterStart + 1);

		const gutterHops: Hop[] = [];
		for (const n of srcLayer) for (const h of n.out) gutterHops.push(h);
		gutterHops.sort((a, b) => {
			const sa = crossCenter(state.nodes.get(a.fromId)!);
			const sb = crossCenter(state.nodes.get(b.fromId)!);
			if (sa !== sb) return sa - sb;
			const da = crossCenter(state.nodes.get(a.toId)!);
			const db = crossCenter(state.nodes.get(b.toId)!);
			return da - db;
		});

		// Pass 1: assign track indexes. Each track is an ARRAY of disjoint
		// intervals — two hops share a track iff their cross-axis ranges
		// don't overlap any existing interval on that track.
		const tracks: Array<Array<{ lo: number; hi: number }>> = [];
		const hopToTrackIdx = new Map<Hop, number>();
		for (const h of gutterHops) {
			const sc = crossCenter(state.nodes.get(h.fromId)!);
			const dc = crossCenter(state.nodes.get(h.toId)!);
			const lo = Math.min(sc, dc);
			const hi = Math.max(sc, dc);
			let idx = -1;
			for (let t = 0; t < tracks.length; t += 1) {
				const intervals = tracks[t]!;
				let fits = true;
				for (const iv of intervals) {
					if (iv.lo <= hi && lo <= iv.hi) {
						fits = false;
						break;
					}
				}
				if (fits) {
					intervals.push({ lo, hi });
					idx = t;
					break;
				}
			}
			if (idx < 0) {
				tracks.push([{ lo, hi }]);
				idx = tracks.length - 1;
			}
			hopToTrackIdx.set(h, idx);
		}

		// Pass 2: distribute track indexes uniformly across the gutter's
		// **interior** (reserve 1-cell margin from each boundary when the
		// gutter is wide enough). A track placed exactly at `gutterStart`
		// or `gEnd` collapses the final turn-segment into the adjacent
		// node's border row, producing a visually misleading arrow; the
		// margin avoids that whenever geometry allows.
		const count = tracks.length;
		const hasMargin = gutterWidth >= Math.max(3, count + 2);
		const usableStart = hasMargin ? gutterStart + 1 : gutterStart;
		const usableEnd = hasMargin ? gEnd - 1 : gEnd;
		const usableWidth = Math.max(1, usableEnd - usableStart + 1);
		for (const h of gutterHops) {
			const idx = hopToTrackIdx.get(h)!;
			let trackPrimary: number;
			if (count <= 1) {
				trackPrimary = usableStart + Math.floor(usableWidth / 2);
			} else {
				const step = (usableWidth - 1) / (count - 1);
				trackPrimary = usableStart + Math.floor(idx * step);
			}
			hopTrackCross.set(h, Math.max(gutterStart, Math.min(gEnd, trackPrimary)));
		}
	}

	// Build polylines.
	const out: LayoutEdge[] = [];
	for (const [, hops] of byChain) {
		const points: LayoutEdgePoint[] = [];
		for (let i = 0; i < hops.length; i += 1) {
			const h = hops[i]!;
			const src = state.nodes.get(h.fromId)!;
			const dst = state.nodes.get(h.toId)!;
			const track = hopTrackCross.get(h)!;
			// Endpoints in (primary, cross) space.
			const srcPrimary = src.isVirtual ? primary(src) : primary(src) + primarySize(src);
			const dstPrimary = dst.isVirtual ? primary(dst) : primary(dst) - 1;
			const sc = crossCenter(src);
			const dc = crossCenter(dst);
			if (i === 0) pushPoint(points, isLR, srcPrimary, sc);
			if (sc !== dc) {
				pushPoint(points, isLR, track, sc);
				pushPoint(points, isLR, track, dc);
			}
			pushPoint(points, isLR, dstPrimary, dc);
		}
		const chain = hops[0]!;
		out.push({
			from: chain.chainFrom,
			to: chain.chainTo,
			points: dedupWaypoints(points),
		});
	}
	return out;
}

function pushPoint(acc: LayoutEdgePoint[], isLR: boolean, primary: number, cross: number): void {
	acc.push(isLR ? { x: primary, y: cross } : { x: cross, y: primary });
}

function dedupWaypoints(points: readonly LayoutEdgePoint[]): LayoutEdgePoint[] {
	const out: LayoutEdgePoint[] = [];
	for (const p of points) {
		const last = out[out.length - 1];
		if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

function boundingBox(state: PipelineState): { width: number; height: number } {
	let w = 0;
	let h = 0;
	for (const layer of state.layers) {
		for (const n of layer) {
			w = Math.max(w, n.x + n.w);
			h = Math.max(h, n.y + n.h);
		}
	}
	return { width: w, height: h };
}
