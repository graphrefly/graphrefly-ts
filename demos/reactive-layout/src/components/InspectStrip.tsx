import type { Graph } from "@graphrefly/graphrefly/graph";
import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { useEffect, useState } from "react";

type NodeDetail = {
	path: string;
	kind?: string;
	value?: unknown;
	status?: string;
	depth?: number;
};

type MetaSnapshot = {
	cacheHitRate: number | null;
	segmentCount: number | null;
	layoutTimeNs: bigint | null;
};

function readMetaSnapshot(graph: Graph | null): MetaSnapshot {
	if (!graph) return { cacheHitRate: null, segmentCount: null, layoutTimeNs: null };
	try {
		const seg = graph.resolve("segments");
		const meta = seg.meta ?? {};
		return {
			cacheHitRate: (meta["cache-hit-rate"]?.cache as number | null) ?? null,
			segmentCount: (meta["segment-count"]?.cache as number | null) ?? null,
			layoutTimeNs: (meta["layout-time-ns"]?.cache as bigint | null) ?? null,
		};
	} catch {
		return { cacheHitRate: null, segmentCount: null, layoutTimeNs: null };
	}
}

function fmtNs(ns: bigint | null): string {
	if (ns == null) return "—";
	const n = Number(ns);
	if (n < 1_000) return `${n} ns`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} µs`;
	return `${(n / 1_000_000).toFixed(2)} ms`;
}

export default function InspectStrip({
	shell,
	activeGraph,
}: {
	shell: DemoShellHandle;
	activeGraph: Graph | null;
}) {
	const [detail, setDetail] = useState<NodeDetail | null>(null);
	const [meta, setMeta] = useState<MetaSnapshot>(() => readMetaSnapshot(activeGraph));

	useEffect(() => {
		const nd = shell.graph.resolve("inspect/node-detail");
		const u = nd.subscribe(() => {
			setDetail((nd.cache as NodeDetail | null) ?? null);
		});
		setDetail((nd.cache as NodeDetail | null) ?? null);
		return u;
	}, [shell]);

	useEffect(() => {
		setMeta(readMetaSnapshot(activeGraph));
		if (!activeGraph) return;
		// Subscribe to meta nodes on `segments` if present.
		try {
			const segs = activeGraph.resolve("segments");
			const unsubs: Array<() => void> = [];
			const m = segs.meta;
			if (m) {
				for (const n of Object.values(m)) {
					unsubs.push(n.subscribe(() => setMeta(readMetaSnapshot(activeGraph))));
				}
			}
			return () => {
				for (const u of unsubs) u();
			};
		} catch {
			return;
		}
	}, [activeGraph]);

	return (
		<div className="inspect-strip">
			<div className="inspect-meta">
				<span title="Fraction of segment measurements served from cache">
					cache-hit-rate:{" "}
					<strong>
						{meta.cacheHitRate == null ? "—" : `${(meta.cacheHitRate * 100).toFixed(1)}%`}
					</strong>
				</span>
				<span>
					segments: <strong>{meta.segmentCount ?? "—"}</strong>
				</span>
				<span>
					last layout: <strong>{fmtNs(meta.layoutTimeNs)}</strong>
				</span>
			</div>
			<div className="inspect-detail">
				{detail ? (
					<>
						<code>{detail.path}</code>
						<span className="pill">{detail.kind ?? "node"}</span>
						<span className="value">
							{typeof detail.value === "number" || typeof detail.value === "string"
								? String(detail.value)
								: detail.value == null
									? "—"
									: Array.isArray(detail.value)
										? `[${detail.value.length}]`
										: typeof detail.value}
						</span>
					</>
				) : (
					<span className="muted">
						hover a node in the graph to inspect; click to pin the selection
					</span>
				)}
			</div>
		</div>
	);
}
