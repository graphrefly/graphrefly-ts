import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAdapter, isChromeNanoAvailable } from "../lib/adapter-factory";
import {
	type Alert,
	EMISSION_PHASES,
	emissionDelayMs,
	emissionPhaseLabel,
	generateAlerts,
} from "../lib/alerts";
import {
	AUTO_ESCALATE_AFTER_MS,
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

const TOTAL_TIME_MS = 5 * 60 * 1000;

// ── Severity color map ──────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
	critical: "var(--gr-danger)",
	high: "#f0a060",
	warning: "var(--gr-warn)",
	low: "var(--gr-aqua-dim)",
	info: "var(--gr-text-muted)",
};

// ── Stable fallback objects for useNodeValue ────────────────────
// Module-level constants so the effect's `[node, fallback]` deps don't
// change every render (which would re-subscribe on every tick).
const EMPTY_QUEUE: readonly QueuedAlert[] = [];
const EMPTY_BINS: TriageBins = {
	actionable: [],
	escalated: [],
	resolved: [],
	deferred: [],
};
const EMPTY_TOKENS: TokenSnapshot = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	localCacheHits: 0,
	calls: 0,
};
const EMPTY_PATTERNS: readonly LearnedPattern[] = [];

// ── Types ───────────────────────────────────────────────────────

type Phase = "setup" | "ready" | "running" | "finished";

interface FocusedAlert {
	readonly alert: Alert;
	readonly brief: string;
	readonly confidence: number;
	readonly source: "queue" | "actionable";
}

// ── App ─────────────────────────────────────────────────────────

export default function App() {
	const shellRef = useRef<DemoShellHandle | null>(null);
	const sidePaneRef = useRef<HTMLDivElement | null>(null);

	// ── Phase / config ──────────────────────────────────────────
	const [phase, setPhase] = useState<Phase>("setup");
	const [paused, setPaused] = useState(false);
	const [adapterMode, setAdapterMode] = useState<AdapterMode>("dry-run");
	const [pipelineMode, setPipelineMode] = useState<"baseline" | "graphrefly">("graphrefly");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
	const [model, setModel] = useState("gpt-4o-mini");
	const [nanoAvailable, setNanoAvailable] = useState(false);

	// ── Alerts ──────────────────────────────────────────────────
	const [alerts, setAlerts] = useState<readonly Alert[]>(() => generateAlerts());
	const [alertIndex, setAlertIndex] = useState(0);

	// ── Pipeline ────────────────────────────────────────────────
	const pipelineRef = useRef<TriagePipeline | null>(null);

	// ── Shell state ─────────────────────────────────────────────
	const [mainRatio, setMainRatio] = useState(0.6);
	const [graphRatio, setGraphRatio] = useState(0.38);
	const [mermaidText, setMermaidText] = useState("");

	// ── Run timing (refs so we don't re-render on every tick) ──
	const runStartTsRef = useRef<number | null>(null);
	const pauseStartTsRef = useRef<number | null>(null);
	const totalPausedMsRef = useRef(0);
	const alertIndexRef = useRef(0);
	const lastEmitAtElapsedRef = useRef(Number.NEGATIVE_INFINITY);
	const [timeLeft, setTimeLeft] = useState(TOTAL_TIME_MS);
	const [currentPhaseLabel, setCurrentPhaseLabel] = useState(EMISSION_PHASES[0].label);

	// ── Focus ───────────────────────────────────────────────────
	const [focused, setFocused] = useState<FocusedAlert | null>(null);

	// ── Reactive node values ────────────────────────────────────
	const pipeline = pipelineRef.current;
	const queue = useNodeValue<readonly QueuedAlert[]>(pipeline?.userQueue ?? null, EMPTY_QUEUE);
	const bins = useNodeValue<TriageBins>(pipeline?.bins ?? null, EMPTY_BINS);
	const tokens = useNodeValue<TokenSnapshot>(pipeline?.tokens ?? null, EMPTY_TOKENS);
	const patterns = useNodeValue<readonly LearnedPattern[]>(
		pipeline?.patterns ?? null,
		EMPTY_PATTERNS,
	);
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

	// ── Tick driver (clock + emissions, one interval) ──────────
	useEffect(() => {
		if (phase !== "running") return;
		const tick = () => {
			const start = runStartTsRef.current;
			if (start == null) return;
			const pausedNow = pauseStartTsRef.current !== null ? Date.now() - pauseStartTsRef.current : 0;
			const elapsed = Math.max(0, Date.now() - start - totalPausedMsRef.current - pausedNow);
			const remaining = Math.max(0, TOTAL_TIME_MS - elapsed);
			setTimeLeft(remaining);
			setCurrentPhaseLabel(emissionPhaseLabel(elapsed));

			if (remaining <= 0) {
				setPhase("finished");
				return;
			}

			// Skip emissions while paused (clock already frozen via pausedNow).
			if (pauseStartTsRef.current !== null) return;

			if (alertIndexRef.current < alerts.length) {
				const lastEmit = lastEmitAtElapsedRef.current;
				const nextDelay = emissionDelayMs(elapsed);
				if (elapsed - lastEmit >= nextDelay) {
					pipelineRef.current?.pushAlert(alerts[alertIndexRef.current]!);
					lastEmitAtElapsedRef.current = elapsed;
					alertIndexRef.current += 1;
					setAlertIndex(alertIndexRef.current);
				}
			}
		};
		tick(); // immediate first emission so a ticket arrives right away
		const id = setInterval(tick, 200);
		return () => clearInterval(id);
	}, [phase, alerts]);

	// ── Auto-focus: on start / after triage, focus first queue item ─
	useEffect(() => {
		if (phase !== "running") return;
		if (focused?.source === "queue") {
			const still = queue.find((q) => q.alert.id === focused.alert.id);
			if (!still) {
				if (queue.length > 0) {
					const q = queue[0]!;
					setFocused({
						alert: q.alert,
						brief: q.brief,
						confidence: q.confidence,
						source: "queue",
					});
				} else {
					setFocused(null);
				}
				return;
			}
		}
		if (!focused && queue.length > 0) {
			const q = queue[0]!;
			setFocused({
				alert: q.alert,
				brief: q.brief,
				confidence: q.confidence,
				source: "queue",
			});
		}
	}, [phase, focused, queue]);

	// ── Setup → Ready: build pipeline ───────────────────────────
	const goToReady = useCallback(() => {
		pipelineRef.current?.destroy();

		const adapter = createAdapter({
			mode: adapterMode,
			apiKey: adapterMode === "byok" ? apiKey : undefined,
			baseUrl: adapterMode === "byok" ? baseUrl : undefined,
			model: adapterMode === "byok" ? model : undefined,
		});

		const p = createTriagePipeline({ adapter, mode: pipelineMode });
		pipelineRef.current = p;
		if (shellRef.current) setDemoGraph(shellRef.current, p.graph);

		runStartTsRef.current = null;
		pauseStartTsRef.current = null;
		totalPausedMsRef.current = 0;
		alertIndexRef.current = 0;
		lastEmitAtElapsedRef.current = Number.NEGATIVE_INFINITY;
		setAlertIndex(0);
		setTimeLeft(TOTAL_TIME_MS);
		setFocused(null);
		setPaused(false);
		setCurrentPhaseLabel(EMISSION_PHASES[0].label);
		setPhase("ready");
	}, [adapterMode, pipelineMode, apiKey, baseUrl, model]);

	// ── Ready → Running: begin clock + emissions ────────────────
	const startRun = useCallback(() => {
		if (!pipelineRef.current) return;
		runStartTsRef.current = Date.now();
		totalPausedMsRef.current = 0;
		pauseStartTsRef.current = null;
		alertIndexRef.current = 0;
		lastEmitAtElapsedRef.current = Number.NEGATIVE_INFINITY;
		setAlertIndex(0);
		setPaused(false);
		setTimeLeft(TOTAL_TIME_MS);
		setFocused(null);
		setPhase("running");
	}, []);

	// ── Pause / Resume ──────────────────────────────────────────
	const togglePause = useCallback(() => {
		if (phase !== "running") return;
		setPaused((prev) => {
			const next = !prev;
			if (next) {
				pauseStartTsRef.current = Date.now();
			} else if (pauseStartTsRef.current !== null) {
				totalPausedMsRef.current += Date.now() - pauseStartTsRef.current;
				pauseStartTsRef.current = null;
			}
			return next;
		});
	}, [phase]);

	// ── Back to config ──────────────────────────────────────────
	const backToSetup = useCallback(() => {
		pipelineRef.current?.destroy();
		pipelineRef.current = null;
		setPhase("setup");
		setPaused(false);
		setFocused(null);
		setAlertIndex(0);
	}, []);

	// ── Randomize alerts ────────────────────────────────────────
	const randomize = useCallback(() => {
		setAlerts(generateAlerts({ seed: Date.now() }));
	}, []);

	// ── Decision ────────────────────────────────────────────────
	const handleDecision = useCallback(
		(disposition: Disposition, deferMs?: number) => {
			if (paused) return;
			if (!focused) return;
			const p = pipelineRef.current;
			if (!p) return;
			if (focused.source === "queue") {
				p.recordDecision(focused.alert.id, disposition, deferMs);
				setFocused(null);
			} else {
				// Re-triage from the Actionable bin into another disposition.
				// "actionable" is a no-op and should be disabled in the UI, but
				// guard here too for safety.
				if (disposition === "actionable") return;
				p.retriageActionable(focused.alert.id, disposition, deferMs);
				setFocused(null);
			}
		},
		[focused, paused],
	);

	// ── Click queue-count summary ───────────────────────────────
	const focusFirstQueue = useCallback(() => {
		if (paused) return;
		if (queue.length === 0) return;
		const q = queue[0]!;
		setFocused({
			alert: q.alert,
			brief: q.brief,
			confidence: q.confidence,
			source: "queue",
		});
	}, [queue, paused]);

	// ── Click actionable bin card — toggle focus ────────────────
	const handleActionableClick = useCallback(
		(item: { alert: Alert; brief: string; confidence: number }) => {
			if (paused) return;
			if (focused?.source === "actionable" && focused.alert.id === item.alert.id) {
				// Toggle off → fall back to first queue item.
				if (queue.length > 0) {
					const q = queue[0]!;
					setFocused({
						alert: q.alert,
						brief: q.brief,
						confidence: q.confidence,
						source: "queue",
					});
				} else {
					setFocused(null);
				}
				return;
			}
			setFocused({
				alert: item.alert,
				brief: item.brief,
				confidence: item.confidence,
				source: "actionable",
			});
		},
		[focused, queue, paused],
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
		};
	}, []);

	// ── Helpers ─────────────────────────────────────────────────
	const fmtTime = (ms: number) => {
		const s = Math.ceil(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	};

	const mainWidthPct = `${Math.round(mainRatio * 100)}%`;
	const sideWidthPct = `${Math.round((1 - mainRatio) * 100)}%`;

	const queueIsHighlighted = useMemo(
		() => focused?.source === "queue" && queue.some((q) => q.alert.id === focused.alert.id),
		[focused, queue],
	);

	// ── Setup (config) screen ───────────────────────────────────
	if (phase === "setup") {
		return (
			<div className="app">
				<div className="setup-screen">
					<h2>PagerDuty Triage Demo</h2>
					<p className="setup-desc">
						You're the on-call SRE for the next <strong>5 minutes</strong>. Alerts stream in at an
						accelerating pace — your job is to push each one to the right bin before the queue backs
						up.
					</p>

					<div className="setup-info">
						<h3>The rules</h3>
						<ul>
							<li>
								<strong>Each alert is pre-classified by an LLM.</strong> High-confidence (≥80%)
								alerts auto-route to the right bin. Low-confidence alerts land in your{" "}
								<strong>queue</strong> for you to decide.
							</li>
							<li>
								<strong>Five actions per alert</strong> &mdash; Actionable · Escalate · Resolve ·
								Defer 30s · Defer 1m. Defer re-queues the alert after the delay.
							</li>
							<li>
								<strong>
									Queue alerts auto-escalate after {Math.round(AUTO_ESCALATE_AFTER_MS / 1000)}{" "}
									seconds
								</strong>{" "}
								if you ignore them &mdash; simulates pager fatigue. Clear your queue or pay the
								price.
							</li>
							<li>
								<strong>Pause button</strong> freezes the clock, alert intake, and all actions. Use
								it to read the graph or catch your breath.
							</li>
						</ul>

						<h3>Intake tempo</h3>
						<ul className="tempo-list">
							<li>
								<span className="tempo-range">0:00 &rarr; 2:00</span>
								<span className="tempo-rate">one alert every 30s</span>{" "}
								<span className="tempo-note">calm &mdash; read carefully</span>
							</li>
							<li>
								<span className="tempo-range">2:00 &rarr; 3:00</span>
								<span className="tempo-rate">one alert every 15s</span>{" "}
								<span className="tempo-note">steady</span>
							</li>
							<li>
								<span className="tempo-range">3:00 &rarr; 4:00</span>
								<span className="tempo-rate">one alert every 8s</span>{" "}
								<span className="tempo-note">elevated</span>
							</li>
							<li>
								<span className="tempo-range">4:00 &rarr; 4:30</span>
								<span className="tempo-rate">one alert every 4s</span>{" "}
								<span className="tempo-note">pressured</span>
							</li>
							<li>
								<span className="tempo-range">4:30 &rarr; 5:00</span>
								<span className="tempo-rate">burst &mdash; ~1/sec</span>{" "}
								<span className="tempo-note">chaos finale</span>
							</li>
						</ul>

						<h3>Scoring priority (highest first)</h3>
						<ol>
							<li>
								<strong>Resolve</strong> benign noise &mdash; you kept the signal clean.
							</li>
							<li>
								<strong>Avoid escalating</strong> unless it's truly senior-on-call material.
							</li>
							<li>
								<strong>Defer</strong> buys time, but the alert comes back.
							</li>
							<li>
								<strong>Actionable</strong> means "I'm on it" &mdash; use it sparingly; it piles up
								work.
							</li>
						</ol>
					</div>

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
							{pipelineMode === "baseline" ? (
								<>
									<strong>Baseline</strong> &mdash; no learning. Every low-confidence alert lands in
									your queue; you triage manually from start to finish.
								</>
							) : (
								<>
									<strong>GraphReFly</strong> &mdash; agentMemory extracts a pattern after 2&ndash;3
									similar decisions and auto-classifies matching alerts with zero LLM cost (local
									cache hit). Try both modes and compare <em>LLM Calls</em>, <em>Auto count</em>,
									and how many alerts you manually handle.
								</>
							)}
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
								Mock responses &mdash; see the full graph topology and UX without needing an API
								key.
							</p>
						)}
						{adapterMode === "chrome-nano" && (
							<p className="mode-hint">
								On-device Gemini Nano &mdash; zero API cost, runs in your browser.
							</p>
						)}
						{adapterMode === "byok" && (
							<div className="byok-fields">
								<p className="mode-hint">
									Bring your own key &mdash; any OpenAI-compatible API. Look for free tier providers
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
						<button type="button" className="btn-primary" onClick={goToReady}>
							Continue &rarr;
						</button>
						<button type="button" className="btn-secondary" onClick={randomize}>
							Randomize Alerts
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Running / Ready / Finished ──────────────────────────────
	// Action buttons are available for both queue-sourced and actionable-sourced
	// focuses. The Actionable button itself is additionally disabled when the
	// focus is already in the Actionable bin (moving actionable→actionable is
	// a no-op) — see `FocusPane` for the per-button check.
	const actionsDisabled = !focused || paused || phase !== "running";

	return (
		<div className="app">
			<div className="demo-shell">
				{/* Main pane: header + bins + tokens + patterns */}
				<div className="pane-main" style={{ width: mainWidthPct, maxWidth: mainWidthPct }}>
					<div className="triage-header">
						<div className="timer" data-urgent={phase === "running" && timeLeft < 30_000}>
							{fmtTime(timeLeft)}
						</div>
						<div className="header-stats">
							<button
								type="button"
								className={`stat stat-btn${queueIsHighlighted ? " active" : ""}`}
								onClick={focusFirstQueue}
								disabled={queue.length === 0 || phase !== "running" || paused}
								title="Click to focus the first ticket in queue"
							>
								<span className="stat-label">Queue</span>
								<span className="stat-value warn">{queue.length}</span>
							</button>
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
							<span className="stat">
								<span className="stat-label">Phase</span>
								<span className="stat-value small">{currentPhaseLabel}</span>
							</span>
						</div>
						<div className="header-controls">
							{phase === "running" && (
								<button
									type="button"
									className={`btn-pill${paused ? " resume" : " pause"}`}
									onClick={togglePause}
								>
									{paused ? "Resume" : "Pause"}
								</button>
							)}
							{phase === "ready" && (
								<button type="button" className="btn-pill start" onClick={startRun}>
									Start &rarr;
								</button>
							)}
							<span className={`pill ${pipelineMode}`}>{pipelineMode}</span>
							<span className="pill adapter">{adapterMode}</span>
						</div>
					</div>

					{phase === "ready" && (
						<div className="ready-banner">
							<strong>Ready.</strong> Take a moment to explore the panels. The graph topology on the
							right shows every node wired up. When you're ready, press{" "}
							<button type="button" className="inline-btn" onClick={startRun}>
								Start
							</button>{" "}
							to begin the 5-minute run &mdash; alerts will start flowing immediately.
						</div>
					)}

					{paused && phase === "running" && (
						<div className="pause-banner">
							<strong>PAUSED.</strong> Clock and alert intake are frozen. Press{" "}
							<button type="button" className="inline-btn" onClick={togglePause}>
								Resume
							</button>{" "}
							to continue.
						</div>
					)}

					{phase === "finished" && (
						<div className="finished-banner">
							<strong>Time's up!</strong> Review your bins below. Resolve count (highest-value),
							Escalated count (cost), Auto count (GraphReFly savings), and LLM calls are the numbers
							to compare between runs.
							<button type="button" className="btn-secondary" onClick={backToSetup}>
								Try again
							</button>
						</div>
					)}

					{/* Bins */}
					<div className="bins-grid">
						<BinColumn
							title="Actionable"
							items={bins.actionable}
							color="var(--gr-danger)"
							onSelect={handleActionableClick}
							selectedId={focused?.source === "actionable" ? focused.alert.id : null}
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

				{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
				<div className="pane-divider" onMouseDown={onMainDividerDown} />

				{/* Side pane: topology (top) + focus pane (bottom) */}
				<div className="pane-side" ref={sidePaneRef} style={{ width: sideWidthPct }}>
					<div className="pane-graph" style={{ height: `${graphRatio * 100}%` }}>
						<h3>Graph topology — describe(graph) → mermaid</h3>
						<GraphPane text={mermaidText} />
					</div>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
					<div className="pane-split-divider" onMouseDown={onSplitDividerDown} />
					<div className="pane-focus">
						<h3>
							Focused ticket
							{focused && (
								<span className={`focus-source ${focused.source}`}>
									{focused.source === "queue" ? "from queue" : "already triaged"}
								</span>
							)}
						</h3>
						<FocusPane
							focused={focused}
							queue={queue}
							phase={phase}
							paused={paused}
							actionsDisabled={actionsDisabled}
							onDecision={handleDecision}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Focus pane component ───────────────────────────────────────

function FocusPane({
	focused,
	queue,
	phase,
	paused,
	actionsDisabled,
	onDecision,
}: {
	focused: FocusedAlert | null;
	queue: readonly QueuedAlert[];
	phase: Phase;
	paused: boolean;
	actionsDisabled: boolean;
	onDecision: (d: Disposition, deferMs?: number) => void;
}) {
	if (!focused) {
		return (
			<div className="focus-empty">
				{phase === "ready" && <p>Press Start above to begin. First queue ticket auto-focuses.</p>}
				{phase === "running" && !paused && queue.length === 0 && (
					<p>No tickets in queue. Relax&hellip; or audit the bins while you wait.</p>
				)}
				{phase === "running" && paused && <p>Paused &mdash; resume to continue.</p>}
				{phase === "finished" && <p>Run complete. Review the bins in the left pane.</p>}
			</div>
		);
	}
	return (
		<div className="focus-content">
			<div className="focus-detail">
				<div className="focus-ids">
					<span className="focus-id">{focused.alert.id}</span>
					<span className="severity-badge" style={{ color: SEV_COLORS[focused.alert.severity] }}>
						{focused.alert.severity}
					</span>
				</div>
				<div className="focus-service">{focused.alert.service}</div>
				<div className="focus-summary">{focused.alert.summary}</div>
				<div className="focus-brief">
					<span className="brief-label">LLM brief</span>
					<span className="brief-text">{focused.brief}</span>
					<span className="confidence">{Math.round(focused.confidence * 100)}% confidence</span>
				</div>
				{focused.source === "actionable" && (
					<div className="focus-note">
						Already in the Actionable bin — you can re-route it. Click the card again in the bin to
						release focus and hop to the next queue ticket.
					</div>
				)}
			</div>
			<div className="focus-actions">
				<button
					type="button"
					className="action-btn actionable"
					onClick={() => onDecision("actionable")}
					disabled={actionsDisabled || focused.source === "actionable"}
					title={
						focused.source === "actionable" ? "Alert is already in the Actionable bin" : undefined
					}
				>
					Actionable
				</button>
				<button
					type="button"
					className="action-btn escalated"
					onClick={() => onDecision("escalated")}
					disabled={actionsDisabled}
				>
					Escalate
				</button>
				<button
					type="button"
					className="action-btn resolved"
					onClick={() => onDecision("resolved")}
					disabled={actionsDisabled}
				>
					Resolve
				</button>
				<button
					type="button"
					className="action-btn deferred"
					onClick={() => onDecision("deferred", 30_000)}
					disabled={actionsDisabled}
				>
					Defer 30s
				</button>
				<button
					type="button"
					className="action-btn deferred"
					onClick={() => onDecision("deferred", 60_000)}
					disabled={actionsDisabled}
				>
					Defer 1m
				</button>
			</div>
		</div>
	);
}

// ── Bin card content (shared) ───────────────────────────────────

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

// ── Bin column ─────────────────────────────────────────────────

function BinColumn({
	title,
	items,
	color,
	onSelect,
	selectedId,
}: {
	title: string;
	items: readonly {
		alert: Alert;
		brief: string;
		autoClassified: boolean;
		confidence: number;
	}[];
	color: string;
	onSelect?: (item: { alert: Alert; brief: string; confidence: number }) => void;
	selectedId?: string | null;
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
							className={`bin-card${item.autoClassified ? " auto" : ""}${selectedId === item.alert.id ? " selected" : ""}`}
							onClick={() =>
								onSelect({
									alert: item.alert,
									brief: item.brief,
									confidence: item.confidence,
								})
							}
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

// ── Deferred column ────────────────────────────────────────────

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
