import { useEffect, useMemo, useState } from "react";
import {
	type CanvasAuditCard,
	type CanvasDependencyEdge,
	type CanvasViewModel,
	type CanvasWorkItemNode,
	createCanvasDogfoodRuntime,
	EMPTY_CANVAS_VIEW,
} from "../lib/canvas-graph";
import { useNodeValue } from "../lib/use-node-value";

const LANE_LABELS: Record<CanvasWorkItemNode["lane"], string> = {
	queued: "Queued",
	running: "Running",
	blocked: "Blocked",
	complete: "Complete",
};

export default function App() {
	const runtime = useMemo(() => createCanvasDogfoodRuntime(), []);
	useEffect(() => () => runtime.dispose(), [runtime]);
	const view = useNodeValue(runtime.view, EMPTY_CANVAS_VIEW);
	const selected = view.nodes.find((node) => node.id === view.selectedWorkItemId) ?? view.nodes[0];
	const selectedPlans = selected
		? view.effectPlans.filter((plan) => plan.workItemId === selected.id)
		: [];
	const selectedEvidence = selected
		? view.evidence.filter((evidence) => evidence.workItemId === selected.id)
		: [];
	const selectedActions = selected
		? view.actions.filter((action) => action.workItemId === selected.id)
		: [];

	return (
		<main className="canvas-app">
			<section className="canvas-workspace">
				<header className="canvas-toolbar">
					<div>
						<p className="eyebrow">CSP-8 GraphReFly Canvas dogfood</p>
						<h1>WorkItem evidence board</h1>
					</div>
					<div className="toolbar-actions" role="group" aria-label="Graph-visible actions">
						<button type="button" onClick={() => runtime.runSelectedEffect()}>
							Run fake effect
						</button>
						<button
							type="button"
							className="secondary"
							onClick={() => runtime.proposeReviewAction()}
						>
							Propose review
						</button>
						<button
							type="button"
							className="secondary"
							onClick={() => runtime.approveLatestProposal()}
						>
							Approve proposal
						</button>
					</div>
				</header>

				<div className="metric-strip" role="group" aria-label="Canvas fact counters">
					<Metric label="WorkItems" value={view.counters.workItems} />
					<Metric label="Deps" value={view.counters.dependencies} />
					<Metric label="Ready inputs" value={view.counters.readyInputs} />
					<Metric label="Outcomes" value={view.counters.outcomes} />
					<Metric label="Evidence" value={view.counters.evidence} />
					<Metric label="Issues" value={view.counters.issues} />
				</div>

				<div className="board-grid">
					<CanvasBoard
						view={view}
						selectedId={view.selectedWorkItemId}
						onSelect={runtime.selectWorkItem}
					/>
					<BoardRail view={view} selected={selected} />
				</div>
			</section>

			<aside className="detail-drawer" aria-label="Selected WorkItem details">
				{selected ? (
					<>
						<div className="drawer-header">
							<span className={`status-dot ${selected.lane}`} />
							<div>
								<p className="eyebrow">{LANE_LABELS[selected.lane]}</p>
								<h2>{selected.label}</h2>
							</div>
						</div>
						<p className="drawer-summary">{selected.summary}</p>
						<section className="detail-section">
							<h3>Effect Plan</h3>
							{selectedPlans.length > 0 ? (
								selectedPlans.map((plan) => (
									<div key={plan.effectRunId} className="fact-row">
										<div>
											<strong>{plan.planId}</strong>
											<span>{plan.summary}</span>
										</div>
										<Badge tone={plan.status}>{plan.status}</Badge>
									</div>
								))
							) : (
								<EmptyText>No effect request is attached to this WorkItem.</EmptyText>
							)}
						</section>
						<section className="detail-section">
							<h3>Evidence</h3>
							{selectedEvidence.length > 0 ? (
								selectedEvidence.map((evidence) => (
									<div key={evidence.evidenceId} className="fact-row">
										<div>
											<strong>{evidence.status}</strong>
											<span>{evidence.summary ?? evidence.issueCode ?? evidence.effectRunId}</span>
										</div>
										<code>{evidence.evidenceId}</code>
									</div>
								))
							) : (
								<EmptyText>No evidence recorded yet.</EmptyText>
							)}
						</section>
						<section className="detail-section">
							<h3>Domain Actions</h3>
							{selectedActions.length > 0 ? (
								selectedActions.map((action) => (
									<div key={action.proposalId} className="fact-row">
										<div>
											<strong>{action.actionKind}</strong>
											<span>{action.proposalId}</span>
										</div>
										<Badge tone={action.state}>{action.state}</Badge>
									</div>
								))
							) : (
								<EmptyText>No graph-visible action proposal for this WorkItem.</EmptyText>
							)}
						</section>
					</>
				) : (
					<EmptyText>Select a WorkItem node to inspect its graph-visible facts.</EmptyText>
				)}
			</aside>
		</main>
	);
}

function CanvasBoard({
	view,
	selectedId,
	onSelect,
}: {
	readonly view: CanvasViewModel;
	readonly selectedId: string;
	readonly onSelect: (id: string) => void;
}) {
	const [hoverId, setHoverId] = useState<string | null>(null);
	const byId = new Map(view.nodes.map((node) => [node.id, node]));
	const isConnected = (edge: CanvasDependencyEdge) =>
		hoverId === null || edge.from === hoverId || edge.to === hoverId;

	if (view.nodes.length === 0) {
		return <div className="canvas-empty">Waiting for WorkItem facts...</div>;
	}

	return (
		<div className="canvas-board">
			<svg viewBox="0 0 760 420" role="img" aria-label="Canvas board graph">
				<title>GraphReFly Canvas WorkItem dependency board</title>
				<defs>
					<marker
						id="canvas-arrow"
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" />
					</marker>
				</defs>
				<g className="edges">
					{view.edges.map((edge) => {
						const from = byId.get(edge.from);
						const to = byId.get(edge.to);
						if (!from || !to) return null;
						const mx = (from.x + to.x) / 2;
						const my = (from.y + to.y) / 2 - 9;
						return (
							<g
								key={`${edge.from}-${edge.to}`}
								className={[
									"edge",
									edge.blocked ? "blocked" : "",
									isConnected(edge) ? "active" : "dim",
								].join(" ")}
							>
								<line x1={from.x + 42} y1={from.y} x2={to.x - 42} y2={to.y} />
								<text x={mx} y={my}>
									{edge.label}
								</text>
							</g>
						);
					})}
				</g>
				<g className="nodes">
					{view.nodes.map((node) => (
						<g
							key={node.id}
							className={[
								"node",
								node.lane,
								selectedId === node.id ? "selected" : "",
								hoverId === null || hoverId === node.id ? "active" : "dim",
							].join(" ")}
							transform={`translate(${node.x} ${node.y})`}
							onPointerEnter={() => setHoverId(node.id)}
							onPointerLeave={() => setHoverId(null)}
							onClick={() => onSelect(node.id)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") onSelect(node.id);
							}}
							tabIndex={0}
							role="button"
							aria-label={`Select ${node.label}`}
						>
							<rect x="-74" y="-39" width="148" height="78" rx="8" />
							<text className="node-label" x="0" y="-11">
								{node.label}
							</text>
							<text className="node-status" x="0" y="12">
								{node.effectStatus} / {node.progress}%
							</text>
							<circle cx="58" cy="-25" r="8" />
							<text className="node-count" x="58" y="-21">
								{node.evidenceCount}
							</text>
						</g>
					))}
				</g>
			</svg>
		</div>
	);
}

function BoardRail({
	view,
	selected,
}: {
	readonly view: CanvasViewModel;
	readonly selected?: CanvasWorkItemNode;
}) {
	const selectedIssues = selected
		? view.issues.filter((issue) => issue.subjectId === selected.id)
		: [];
	const selectedAudit = selected
		? view.audit.filter((audit) => audit.subjectId === selected.id || audit.subjectId === undefined)
		: [];
	return (
		<div className="board-rail">
			<section className="rail-section">
				<h3>Tool Runs</h3>
				{view.toolRuns.length > 0 ? (
					view.toolRuns.slice(-8).map((run) => (
						<div key={`${run.runId}:${run.status}`} className="run-row">
							<div>
								<strong>{run.workItemId ?? "unknown"}</strong>
								<span>{run.runId}</span>
							</div>
							<Badge tone={run.status}>{run.status}</Badge>
						</div>
					))
				) : (
					<EmptyText>No adapter run status yet.</EmptyText>
				)}
			</section>
			<section className="rail-section">
				<h3>Issues</h3>
				{selectedIssues.length > 0 ? (
					selectedIssues.map((issue) => (
						<div key={`${issue.code}:${issue.message}`} className="issue-row">
							<strong>{issue.code}</strong>
							<span>{issue.message}</span>
						</div>
					))
				) : (
					<EmptyText>No selected WorkItem issue.</EmptyText>
				)}
			</section>
			<section className="rail-section audit">
				<h3>Audit</h3>
				{selectedAudit.length > 0 ? (
					selectedAudit.slice(-8).map((audit) => <AuditLine key={audit.id} audit={audit} />)
				) : (
					<EmptyText>No audit entries for this selection.</EmptyText>
				)}
			</section>
		</div>
	);
}

function AuditLine({ audit }: { readonly audit: CanvasAuditCard }) {
	return (
		<div className="audit-line">
			<strong>{audit.kind}</strong>
			<span>{audit.issueCode ?? audit.subjectId ?? audit.id}</span>
		</div>
	);
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
	return (
		<div className="metric">
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
}

function Badge({ tone, children }: { readonly tone: string; readonly children: string }) {
	return <span className={`badge ${tone}`}>{children}</span>;
}

function EmptyText({ children }: { readonly children: string }) {
	return <p className="empty-text">{children}</p>;
}
