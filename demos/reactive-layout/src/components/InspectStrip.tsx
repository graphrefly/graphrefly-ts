import type { Graph } from "@graphrefly/ts/graph";
import { useEffect, useState } from "react";
import type { DemoShellHandle } from "../lib/shell";

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

function segmentNodeId(graph: Graph): string | null {
	const described = graph
		.describe()
		.nodes.find((node) => node.id === "segments" || node.id.endsWith(":segments"));
	return described?.id ?? null;
}

function metaCache<T>(meta: Record<string, unknown>, key: string): T | null {
	const value = meta[key];
	if (value === null || typeof value !== "object" || !("cache" in value)) return null;
	return (value as { cache?: T }).cache ?? null;
}

function readMetaSnapshot(graph: Graph | null): MetaSnapshot {
	if (!graph) return { cacheHitRate: null, segmentCount: null, layoutTimeNs: null };
	try {
		const segmentsId = segmentNodeId(graph);
		const described =
			segmentsId === null
				? undefined
				: graph.describe().nodes.find((node) => node.id === segmentsId);
		const meta = described?.meta ?? {};
		return {
			cacheHitRate: metaCache<number>(meta, "cache-hit-rate"),
			segmentCount: metaCache<number>(meta, "segment-count"),
			layoutTimeNs: metaCache<bigint>(meta, "layout-time-ns"),
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
		const nd = shell.graph.find("inspect/node-detail");
		if (!nd) return;
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
			const segmentsId = segmentNodeId(activeGraph);
			if (segmentsId === null) return;
			const unsub = activeGraph
				.observe(segmentsId)
				.subscribe(() => setMeta(readMetaSnapshot(activeGraph)));
			return () => unsub();
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
				) : null}
			</div>
		</div>
	);
}
