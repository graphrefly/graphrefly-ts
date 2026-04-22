import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAdapter, isChromeNanoAvailable } from "../lib/adapter-factory";
import { type Alert, emissionDelayMs, generateAlerts } from "../lib/alerts";
import {
	createTriagePipeline,
	type QueuedAlert,
	type TriageBins,
	type TriagePipeline,
} from "../lib/pipeline";
import { getShell, setDemoGraph } from "../lib/shell";
import type { AdapterMode, Disposition, LearnedPattern, TokenSnapshot } from "../lib/types";
import { useNodeValue } from "../lib/use-node-value";
import GraphPane from "./GraphPane";

// ── Constants ───────────────────────────────────────────────────

const TOTAL_TIME_MS = 3 * 60 * 1000; // 3 minutes

// ── Severity color map ──────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
	critical: "var(--gr-danger)",
	high: "#f0a060",
	warning: "var(--gr-warn)",
	low: "var(--gr-aqua-dim)",
	info: "var(--gr-text-muted)",
};

// ── App ─────────────────────────────────────────────────────────

export default function App() {
	const shellRef = useRef<DemoShellHandle | null>(null);
	const sidePaneRef = useRef<HTMLDivElement | null>(null);

	// ── Setup state ─────────────────────────────────────────────
	const [phase, setPhase] = useState<"setup" | "running" | "finished">("setup");
	const [adapterMode, setAdapterMode] = useState<AdapterMode>("dry-run");
	const [pipelineMode, setPipelineMode] = useState<"baseline" | "graphrefly">("graphrefly");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
	const [model, setModel] = useState("gpt-4o-mini");
	const [nanoAvailable, setNanoAvailable] = useState(false);

	// ── Alert state ─────────────────────────────────────────────
	const [alerts, setAlerts] = useState<readonly Alert[]>(() => generateAlerts());
	const [alertIndex, setAlertIndex] = useState(0);

	// ── Pipeline ────────────────────────────────────────────────
	const pipelineRef = useRef<TriagePipeline | null>(null);
	const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Shell state ─────────────────────────────────────────────
	const [mainRatio, setMainRatio] = useState(0.65);
	const [graphRatio, setGraphRatio] = useState(0.5);
	const [mermaidText, setMermaidText] = useState("");

	// ── Running state ───────────────────────────────────────────
	const [timeLeft, setTimeLeft] = useState(TOTAL_TIME_MS);
	const [selectedAlert, setSelectedAlert] = useState<QueuedAlert | null>(null);

	// ── Reactive node values ────────────────────────────────────
	const pipeline = pipelineRef.current;
	const queue = useNodeValue<readonly QueuedAlert[]>(pipeline?.userQueue ?? null, []);
	const bins = useNodeValue<TriageBins>(pipeline?.bins ?? null, {
		actionable: [],
		escalated: [],
		resolved: [],
		deferred: [],
	});
	const tokens = useNodeValue<TokenSnapshot>(pipeline?.tokens ?? null, {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		localCacheHits: 0,
		calls: 0,
	});
	const patterns = useNodeValue<readonly LearnedPattern[]>(pipeline?.patterns ?? null, []);
	const autoCount = useNodeValue<number>(pipeline?.autoCount ?? null, 0);

	// ── Probe Chrome Nano on mount ──────────────────────────────
	useEffect(() => {
		setNanoAvailable(isChromeNanoAvailable());
	}, []);

	// ── Shell setup ─────────────────────────────────────────────
	useEffect(() => {
		const shell = getShell();
		shellRef.current = shell;

		const mermaidNode = shell.graph.resolve("graph/mermaid");
		const u1 = mermaidNode.subscribe(() => {
			setMermaidText((mermaidNode.cache as string) ?? "");
		});

		const onResize = () => shell.setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);

		return () => {
			u1();
			window.removeEventListener("resize", onResize);
		};
	}, []);

	// ── Countdown timer ─────────────────────────────────────────
	useEffect(() => {
		if (phase !== "running") return;
		const start = Date.now();
		const interval = setInterval(() => {
			const elapsed = Date.now() - start;
			const remaining = Math.max(0, TOTAL_TIME_MS - elapsed);
			setTimeLeft(remaining);
			if (remaining <= 0) {
				setPhase("finished");
				if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
			}
		}, 250);
		return () => clearInterval(interval);
	}, [phase]);

	// ── Alert emission ──────────────────────────────────────────
	const scheduleNextAlert = useCallback(() => {
		const p = pipelineRef.current;
		if (!p) return;

		setAlertIndex((prev) => {
			if (prev >= alerts.length) return prev;
			p.pushAlert(alerts[prev]!);
			const next = prev + 1;
			if (next < alerts.length) {
				emitTimerRef.current = setTimeout(scheduleNextAlert, emissionDelayMs(next));
			}
			return next;
		});
	}, [alerts]);

	// ── Start run ───────────────────────────────────────────────
	const startRun = useCallback(() => {
		// Tear down any previous run before creating a new one.
		if (emitTimerRef.current) {
			clearTimeout(emitTimerRef.current);
			emitTimerRef.current = null;
		}
		pipelineRef.current?.destroy();

		const adapter = createAdapter({
			mode: adapterMode,
			apiKey: adapterMode === "byok" ? apiKey : undefined,
			baseUrl: adapterMode === "byok" ? baseUrl : undefined,
			model: adapterMode === "byok" ? model : undefined,
		});

		const p = createTriagePipeline({ adapter, mode: pipelineMode });
		pipelineRef.current = p;

		// Wire to demo shell
		const shell = shellRef.current;
		if (shell) setDemoGraph(shell, p.graph);

		setPhase("running");
		setAlertIndex(0);
		setTimeLeft(TOTAL_TIME_MS);
		setSelectedAlert(null);

		// Start emitting alerts
		setTimeout(() => {
			p.pushAlert(alerts[0]!);
			setAlertIndex(1);
			emitTimerRef.current = setTimeout(scheduleNextAlert, emissionDelayMs(1));
		}, 500);
	}, [adapterMode, pipelineMode, apiKey, baseUrl, model, alerts, scheduleNextAlert]);

	// ── Randomize alerts ────────────────────────────────────────
	const randomize = useCallback(() => {
		setAlerts(generateAlerts({ seed: Date.now() }));
	}, []);

	// ── User decision ───────────────────────────────────────────
	const handleDecision = useCallback(
		(disposition: Disposition, deferMs?: number) => {
			if (!selectedAlert || !pipelineRef.current) return;
			pipelineRef.current.recordDecision(selectedAlert.alert.id, disposition, deferMs);
			setSelectedAlert(null);
			// Auto-select next in queue if available
			const currentQueue = pipelineRef.current.userQueue.cache as readonly QueuedAlert[];
			const remaining = currentQueue.filter((q) => q.alert.id !== selectedAlert.alert.id);
			if (remaining.length > 0) {
				setSelectedAlert(remaining[0]!);
			}
		},
		[selectedAlert],
	);

	// ── Drag handlers ───────────────────────────────────────────
	const activeDragHandlers = useRef<{
		move: (e: MouseEvent) => void;
		up: () => void;
	} | null>(null);

	useEffect(() => {
		return () => {
			if (activeDragHandlers.current) {
				window.removeEventListener("mousemove", activeDragHandlers.current.move);
				window.removeEventListener("mouseup", activeDragHandlers.current.up);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
			}
		};
	}, []);

	const beginDrag = useCallback(
		(cursor: "col-resize" | "row-resize", onMove: (e: MouseEvent) => void) => {
			document.body.style.cursor = cursor;
			document.body.style.userSelect = "none";
			const move = (ev: MouseEvent) => onMove(ev);
			const up = () => {
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("mousemove", move);
				window.removeEventListener("mouseup", up);
				activeDragHandlers.current = null;
			};
			activeDragHandlers.current = { move, up };
			window.addEventListener("mousemove", move);
			window.addEventListener("mouseup", up);
		},
		[],
	);

	const onMainDividerDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			beginDrag("col-resize", (ev) => {
				const ratio = Math.max(0.25, Math.min(0.8, ev.clientX / window.innerWidth));
				setMainRatio(ratio);
				shellRef.current?.setMainRatio(ratio);
			});
		},
		[beginDrag],
	);

	const onSplitDividerDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			beginDrag("row-resize", (ev) => {
				if (!sidePaneRef.current) return;
				const rect = sidePaneRef.current.getBoundingClientRect();
				const ratio = Math.max(0.15, Math.min(0.85, (ev.clientY - rect.top) / rect.height));
				setGraphRatio(ratio);
				shellRef.current?.setSideSplit(ratio);
			});
		},
		[beginDrag],
	);

	// ── Cleanup on unmount ──────────────────────────────────────
	useEffect(() => {
		return () => {
			pipelineRef.current?.destroy();
			if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
		};
	}, []);

	// ── Format helpers ──────────────────────────────────────────
	const fmtTime = (ms: number) => {
		const s = Math.ceil(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	};

	const mainWidthPct = `${Math.round(mainRatio * 100)}%`;
	const sideWidthPct = `${Math.round((1 - mainRatio) * 100)}%`;

	// ── Setup screen ────────────────────────────────────────────
	if (phase === "setup") {
		return (
			<div className="app">
				<div className="setup-screen">
					<h2>PagerDuty Triage Demo</h2>
					<p className="setup-desc">
						Triage a stream of synthetic PagerDuty alerts in 3 minutes. Compare
						<strong> Baseline</strong> (manual triage) vs <strong>GraphReFly</strong> (learns your
						patterns and auto-classifies).
					</p>

					<div className="setup-section">
						<h3>Pipeline Mode</h3>
						<div className="mode-buttons">
							<button
								type="button"
								className={pipelineMode === "baseline" ? "active" : ""}
								onClick={() => setPipelineMode("baseline")}
							>
								Baseline
							</button>
							<button
								type="button"
								className={pipelineMode === "graphrefly" ? "active" : ""}
								onClick={() => setPipelineMode("graphrefly")}
							>
								GraphReFly
							</button>
						</div>
						<p className="mode-hint">
							{pipelineMode === "baseline"
								? "No learning — you handle every alert manually."
								: "agentMemory learns your patterns and auto-classifies after 2-3 similar decisions."}
						</p>
					</div>

					<div className="setup-section">
						<h3>LLM Adapter</h3>
						<div className="mode-buttons">
							<button
								type="button"
								className={adapterMode === "dry-run" ? "active" : ""}
								onClick={() => setAdapterMode("dry-run")}
							>
								Dry Run
							</button>
							<button
								type="button"
								className={`${adapterMode === "chrome-nano" ? "active" : ""} ${!nanoAvailable ? "disabled" : ""}`}
								onClick={() => nanoAvailable && setAdapterMode("chrome-nano")}
								title={
									nanoAvailable ? "Chrome Nano available" : "Chrome 138+ with Prompt API required"
								}
							>
								Chrome Nano {!nanoAvailable && "(N/A)"}
							</button>
							<button
								type="button"
								className={adapterMode === "byok" ? "active" : ""}
								onClick={() => setAdapterMode("byok")}
							>
								BYOK
							</button>
						</div>

						{adapterMode === "dry-run" && (
							<p className="mode-hint">
								Mock responses — see the full graph topology and UX without needing an API key.
							</p>
						)}
						{adapterMode === "chrome-nano" && (
							<p className="mode-hint">
								On-device Gemini Nano — zero API cost, runs in your browser.
							</p>
						)}
						{adapterMode === "byok" && (
							<div className="byok-fields">
								<p className="mode-hint">
									Bring your own key — any OpenAI-compatible API. Look for free tier providers
									online.
								</p>
								<input
									type="password"
									placeholder="API Key"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
								/>
								<input
									type="text"
									placeholder="Base URL (default: https://api.openai.com/v1)"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
								/>
								<input
									type="text"
									placeholder="Model (default: gpt-4o-mini)"
									value={model}
									onChange={(e) => setModel(e.target.value)}
								/>
							</div>
						)}
					</div>

					<div className="setup-actions">
						<button type="button" className="btn-primary" onClick={startRun}>
							Start Triage
						</button>
						<button type="button" className="btn-secondary" onClick={randomize}>
							Randomize Alerts
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Running / Finished screen ───────────────────────────────
	return (
		<div className="app">
			<div className="demo-shell">
				{/* Main pane: triage interface */}
				<div className="pane-main" style={{ width: mainWidthPct, maxWidth: mainWidthPct }}>
					{/* Header bar */}
					<div className="triage-header">
						<div className="timer" data-urgent={timeLeft < 30_000}>
							{fmtTime(timeLeft)}
						</div>
						<div className="header-stats">
							<span className="stat">
								<span className="stat-label">Queue</span>
								<span className="stat-value">{queue.length}</span>
							</span>
							<span className="stat">
								<span className="stat-label">Alerts</span>
								<span className="stat-value">
									{alertIndex}/{alerts.length}
								</span>
							</span>
							{pipelineMode === "graphrefly" && (
								<>
									<span className="stat">
										<span className="stat-label">Auto</span>
										<span className="stat-value auto">{autoCount}</span>
									</span>
									<span className="stat">
										<span className="stat-label">Patterns</span>
										<span className="stat-value">{patterns.length}</span>
									</span>
								</>
							)}
						</div>
						<div className="header-mode">
							<span className={`pill ${pipelineMode}`}>{pipelineMode}</span>
							<span className="pill adapter">{adapterMode}</span>
						</div>
					</div>

					{/* Triage modal */}
					{selectedAlert && phase === "running" && (
						<div className="triage-modal">
							<div className="modal-alert">
								<div className="alert-id">{selectedAlert.alert.id}</div>
								<div className="alert-service">{selectedAlert.alert.service}</div>
								<span
									className="severity-badge"
									style={{ color: SEV_COLORS[selectedAlert.alert.severity] }}
								>
									{selectedAlert.alert.severity}
								</span>
							</div>
							<div className="modal-summary">{selectedAlert.alert.summary}</div>
							<div className="modal-brief">
								<span className="brief-label">LLM Brief:</span> {selectedAlert.brief}
								<span className="confidence">
									({Math.round(selectedAlert.confidence * 100)}% confidence)
								</span>
							</div>
							<div className="modal-actions">
								<button
									type="button"
									className="action-btn actionable"
									onClick={() => handleDecision("actionable")}
								>
									Actionable
								</button>
								<button
									type="button"
									className="action-btn escalated"
									onClick={() => handleDecision("escalated")}
								>
									Escalate
								</button>
								<button
									type="button"
									className="action-btn resolved"
									onClick={() => handleDecision("resolved")}
								>
									Resolve
								</button>
								<button
									type="button"
									className="action-btn deferred"
									onClick={() => handleDecision("deferred", 30_000)}
								>
									Defer 30s
								</button>
								<button
									type="button"
									className="action-btn deferred"
									onClick={() => handleDecision("deferred", 60_000)}
								>
									Defer 1m
								</button>
							</div>
						</div>
					)}

					{/* If no alert selected but queue has items, prompt user */}
					{!selectedAlert && queue.length > 0 && phase === "running" && (
						<div className="queue-prompt">
							<strong>{queue.length}</strong> alert{queue.length > 1 ? "s" : ""} awaiting triage —
							select from the Actionable bin or{" "}
							<button
								type="button"
								className="inline-btn"
								onClick={() => setSelectedAlert(queue[0]!)}
							>
								take next
							</button>
						</div>
					)}

					{phase === "finished" && (
						<div className="finished-banner">
							Time's up! Review your results below.
							<button type="button" className="btn-secondary" onClick={() => setPhase("setup")}>
								Try Again
							</button>
						</div>
					)}

					{/* Bins */}
					<div className="bins-grid">
						<BinColumn
							title="Actionable"
							items={bins.actionable}
							color="var(--gr-danger)"
							onSelect={(a) => {
								const q = queue.find((x) => x.alert.id === a.id);
								if (q) setSelectedAlert(q);
							}}
						/>
						<BinColumn title="Escalated" items={bins.escalated} color="#f0a060" />
						<BinColumn title="Resolved" items={bins.resolved} color="var(--gr-aqua)" />
						<DeferredColumn items={bins.deferred} />
					</div>

					{/* Token usage */}
					<div className="token-bar">
						<h3>Token Usage</h3>
						<div className="token-stats">
							<span>
								Input: <strong>{tokens.inputTokens.toLocaleString()}</strong>
							</span>
							<span>
								Output: <strong>{tokens.outputTokens.toLocaleString()}</strong>
							</span>
							<span>
								LLM Calls: <strong>{tokens.calls}</strong>
							</span>
							{pipelineMode === "graphrefly" && (
								<span className="cache-hit">
									Local Cache Hits: <strong>{tokens.localCacheHits}</strong>
								</span>
							)}
						</div>
					</div>

					{/* Learned patterns (GraphReFly mode) */}
					{pipelineMode === "graphrefly" && patterns.length > 0 && (
						<div className="patterns-panel">
							<h3>Learned Patterns</h3>
							{patterns.map((p) => (
								<div key={p.patternKey} className="pattern-row">
									<code>{p.patternKey}</code>
									<span className={`pill ${p.disposition}`}>{p.disposition}</span>
									<span className="pattern-meta">
										{p.sampleCount} samples · {Math.round(p.confidence * 100)}%
									</span>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Divider */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
				<div className="pane-divider" onMouseDown={onMainDividerDown} />

				{/* Side pane: topology + token chart */}
				<div className="pane-side" ref={sidePaneRef} style={{ width: sideWidthPct }}>
					<div className="pane-graph" style={{ height: `${graphRatio * 100}%` }}>
						<h3>Graph topology — describe(graph) → mermaid</h3>
						<GraphPane text={mermaidText} />
					</div>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
					<div className="pane-split-divider" onMouseDown={onSplitDividerDown} />
					<div className="pane-code">
						<h3>Queue ({queue.length} pending)</h3>
						<div className="queue-list">
							{queue.map((q) => (
								<button
									type="button"
									key={q.alert.id}
									className={`queue-item${selectedAlert?.alert.id === q.alert.id ? " selected" : ""}`}
									onClick={() => phase === "running" && setSelectedAlert(q)}
								>
									<span className="queue-id">{q.alert.id}</span>
									<span
										className="severity-dot"
										style={{ background: SEV_COLORS[q.alert.severity] }}
									/>
									<span className="queue-svc">{q.alert.service}</span>
									<span className="queue-conf">{Math.round(q.confidence * 100)}%</span>
								</button>
							))}
							{queue.length === 0 && <div className="queue-empty">No alerts in queue</div>}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Bin card content (shared between interactive and static) ────

function BinCardContent({
	item,
}: {
	item: { alert: Alert; brief: string; autoClassified: boolean };
}) {
	return (
		<>
			<div className="card-top">
				<span className="card-id">{item.alert.id}</span>
				<span className="severity-dot" style={{ background: SEV_COLORS[item.alert.severity] }} />
				{item.autoClassified && <span className="auto-badge">auto</span>}
			</div>
			<div className="card-svc">{item.alert.service}</div>
			<div className="card-brief">{item.brief}</div>
		</>
	);
}

// ── Bin column component ────────────────────────────────────────

function BinColumn({
	title,
	items,
	color,
	onSelect,
}: {
	title: string;
	items: readonly { alert: Alert; brief: string; autoClassified: boolean }[];
	color: string;
	onSelect?: (alert: Alert) => void;
}) {
	return (
		<div className="bin-column">
			<div className="bin-header" style={{ borderColor: color }}>
				<span>{title}</span>
				<span className="bin-count" style={{ color }}>
					{items.length}
				</span>
			</div>
			<div className="bin-scroll">
				{items.map((item) =>
					onSelect ? (
						<button
							type="button"
							key={item.alert.id}
							className={`bin-card${item.autoClassified ? " auto" : ""}`}
							onClick={() => onSelect(item.alert)}
						>
							<BinCardContent item={item} />
						</button>
					) : (
						<div key={item.alert.id} className={`bin-card${item.autoClassified ? " auto" : ""}`}>
							<BinCardContent item={item} />
						</div>
					),
				)}
			</div>
		</div>
	);
}

// ── Deferred column ─────────────────────────────────────────────

function DeferredColumn({
	items,
}: {
	items: readonly { alert: Alert; brief: string; autoClassified: boolean; retryAt: number }[];
}) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (items.length === 0) return;
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [items.length]);

	return (
		<div className="bin-column">
			<div className="bin-header" style={{ borderColor: "var(--gr-warn)" }}>
				<span>Deferred</span>
				<span className="bin-count" style={{ color: "var(--gr-warn)" }}>
					{items.length}
				</span>
			</div>
			<div className="bin-scroll">
				{items.map((item) => {
					const remaining = Math.max(0, Math.ceil((item.retryAt - now) / 1000));
					return (
						<div key={item.alert.id} className={`bin-card${item.autoClassified ? " auto" : ""}`}>
							<div className="card-top">
								<span className="card-id">{item.alert.id}</span>
								<span
									className="severity-dot"
									style={{ background: SEV_COLORS[item.alert.severity] }}
								/>
								{item.autoClassified && <span className="auto-badge">auto</span>}
							</div>
							<div className="card-svc">{item.alert.service}</div>
							<div className="card-brief">{item.brief}</div>
							<div className="defer-timer">
								{remaining > 0 ? `re-queue in ${remaining}s` : "re-queuing…"}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
