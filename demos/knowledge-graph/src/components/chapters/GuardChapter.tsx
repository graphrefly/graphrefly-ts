import { useEffect, useMemo, useState } from "react";
import { SAMPLE_PAPER } from "../../data/sample-paper";
import { readKGSnapshot } from "../../lib/chapters/_shared";
import { buildGuardChapter, type GuardChapter } from "../../lib/chapters/guard";
import type { ChapterUIProps } from "../../lib/chapters/types";
import { getSharedAdapter } from "../../lib/shell";
import { useNodeValue } from "../../lib/use-node-value";
import KGPane from "../KGPane";
import PaperPane from "../PaperPane";

let cached: GuardChapter | null = null;
export function getGuardChapter(): GuardChapter {
	if (!cached) cached = buildGuardChapter(getSharedAdapter().adapter, SAMPLE_PAPER.body);
	return cached;
}

export default function GuardChapterUI({ hoverTarget, onHover }: ChapterUIProps) {
	const chapter = useMemo(() => getGuardChapter(), []);
	const paperText = useNodeValue(chapter.paperText, SAMPLE_PAPER.body);
	const currentParagraph = useNodeValue(chapter.currentParagraph, "");
	const paragraphs = useNodeValue(chapter.paragraphs, [] as readonly string[]);
	const paragraphIdx = useNodeValue(chapter.paragraphIdx, 0);
	const violationCount = useNodeValue(chapter.enforced.violationCount, 0);

	const [snap, setSnap] = useState(() => readKGSnapshot(chapter.kg));
	const [lastResult, setLastResult] = useState<{ ok: boolean; error?: string } | null>(null);

	useEffect(() => {
		const a = chapter.kg.resolve("entities").subscribe(() => setSnap(readKGSnapshot(chapter.kg)));
		const b = chapter.kg.resolve("edges").subscribe(() => setSnap(readKGSnapshot(chapter.kg)));
		return () => {
			a();
			b();
		};
	}, [chapter]);

	return (
		<div className="chapter">
			<p className="chapter-lede">
				<strong>Composition with guardrails.</strong> Same reactive pipeline. Now the KG is wrapped
				in a <code>policyEnforcer</code> with <code>mode: "enforce"</code>. The legitimate
				extraction effect (<code>system</code> actor) writes freely. Click below to attempt a write
				as <code>untrusted-llm</code>: the guard throws <code>GuardDenied</code> and a violation is
				recorded.
			</p>
			<div className="controls">
				<button
					type="button"
					className="secondary"
					onClick={() => {
						setLastResult(null);
						chapter.advance();
					}}
					disabled={paragraphs.length === 0}
				>
					Extract next paragraph ({paragraphIdx + 1} / {paragraphs.length})
				</button>
				<button
					type="button"
					className="danger"
					onClick={() => setLastResult(chapter.tryMaliciousWrite())}
				>
					Try malicious write
				</button>
				<button
					type="button"
					className="secondary"
					onClick={() => {
						setLastResult(null);
						chapter.reset();
					}}
				>
					Reset KG
				</button>
			</div>
			<div
				className={`guard-banner${lastResult && !lastResult.ok ? " denied" : ""}`}
				data-guard-banner
			>
				<div>
					<code>policyEnforcer</code> — <strong>enforce</strong> mode · violations recorded:{" "}
					<strong>{violationCount}</strong>
				</div>
				{lastResult ? (
					lastResult.ok ? (
						<div>Last attempt: silently allowed — schema validation in the adapter passed too.</div>
					) : (
						<div className="denied-reason">
							Denied: <code>{lastResult.error}</code>
						</div>
					)
				) : (
					<div className="paper-meta">No write attempts yet.</div>
				)}
			</div>
			<div className="extraction-grid">
				<PaperPane
					title={SAMPLE_PAPER.title}
					author={SAMPLE_PAPER.author}
					url={SAMPLE_PAPER.url}
					body={paperText}
					currentParagraph={currentParagraph}
				/>
				<div className="kg-pane" data-kg-pane>
					<h4>Knowledge graph (guarded)</h4>
					<KGPane
						entities={snap.entities}
						edges={snap.edges}
						hoverId={hoverTarget?.id ?? null}
						onHover={(id) => onHover(id ? { pane: "visual", id } : null)}
					/>
				</div>
			</div>
		</div>
	);
}
