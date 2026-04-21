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

export default function InspectStrip({
	shell,
	activeGraph,
}: {
	shell: DemoShellHandle;
	activeGraph: Graph | null;
}) {
	const [detail, setDetail] = useState<NodeDetail | null>(null);
	const [stats, setStats] = useState({ entities: 0, edges: 0 });

	useEffect(() => {
		const nd = shell.graph.resolve("inspect/node-detail");
		const u = nd.subscribe(() => {
			setDetail((nd.cache as NodeDetail | null) ?? null);
		});
		setDetail((nd.cache as NodeDetail | null) ?? null);
		return u;
	}, [shell]);

	useEffect(() => {
		if (!activeGraph) return;
		const update = () => {
			try {
				const ents = activeGraph.resolve("entities").cache as
					| ReadonlyMap<string, unknown>
					| undefined;
				const eds = activeGraph.resolve("edges").cache as readonly unknown[] | undefined;
				setStats({ entities: ents?.size ?? 0, edges: eds?.length ?? 0 });
			} catch {
				setStats({ entities: 0, edges: 0 });
			}
		};
		update();
		try {
			const u1 = activeGraph.resolve("entities").subscribe(update);
			const u2 = activeGraph.resolve("edges").subscribe(update);
			return () => {
				u1();
				u2();
			};
		} catch {
			return;
		}
	}, [activeGraph]);

	return (
		<div className="inspect-strip">
			<div className="inspect-meta">
				<span>
					entities: <strong>{stats.entities}</strong>
				</span>
				<span>
					edges: <strong>{stats.edges}</strong>
				</span>
			</div>
			<div className="inspect-detail">
				{detail ? (
					<>
						<code>{detail.path}</code>
						<span className="pill">{detail.kind ?? "node"}</span>
					</>
				) : null}
			</div>
		</div>
	);
}
