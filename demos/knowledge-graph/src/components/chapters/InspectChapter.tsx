import type { CausalChain } from "@graphrefly/graphrefly/graph";
import { useEffect, useMemo, useState } from "react";
import { SAMPLE_PAPER } from "../../data/sample-paper";
import { buildInspectChapter, type InspectChapter } from "../../lib/chapters/inspect";
import type { ChapterUIProps } from "../../lib/chapters/types";
import { getSharedAdapter } from "../../lib/shell";
import type { Entity, Relation } from "../../lib/types";
import { useNodeValue } from "../../lib/use-node-value";
import KGPane from "../KGPane";
import PaperPane from "../PaperPane";

type Edge = { from: string; to: string; relation: Relation };

let cached: InspectChapter | null = null;
export function getInspectChapter(): InspectChapter {
	if (!cached) cached = buildInspectChapter(getSharedAdapter().adapter, SAMPLE_PAPER.body);
	return cached;
}

function snapshotKG(c: InspectChapter): {
	entities: ReadonlyArray<Entity>;
	edges: ReadonlyArray<Edge>;
} {
	const ents = c.kg.resolve("entities").cache as ReadonlyMap<string, Entity> | undefined;
	const eds = c.kg.resolve("edges").cache as
		| ReadonlyArray<{ from: string; to: string; relation: Relation; weight: number }>
		| undefined;
	return {
		entities: ents ? [...ents.values()] : [],
		edges: eds ? eds.map((e) => ({ from: e.from, to: e.to, relation: e.relation })) : [],
	};
}

export default function InspectChapterUI({ hoverTarget, onHover }: ChapterUIProps) {
	const chapter = useMemo(() => getInspectChapter(), []);
	const paperText = useNodeValue(chapter.paperText, SAMPLE_PAPER.body);
	const currentParagraph = useNodeValue(chapter.currentParagraph, "");
	const paragraphs = useNodeValue(chapter.paragraphs, [] as readonly string[]);
	const paragraphIdx = useNodeValue(chapter.paragraphIdx, 0);
	const explainChain = useNodeValue<CausalChain | null>(chapter.explain, null);
	const [snap, setSnap] = useState(() => snapshotKG(chapter));

	useEffect(() => {
		const a = chapter.kg.resolve("entities").subscribe(() => setSnap(snapshotKG(chapter)));
		const b = chapter.kg.resolve("edges").subscribe(() => setSnap(snapshotKG(chapter)));
		return () => {
			a();
			b();
		};
	}, [chapter]);

	const chainText = useMemo(() => formatChain(explainChain), [explainChain]);

	return (
		<div className="chapter">
			<p className="chapter-lede">
				<strong>Inspect & trace.</strong> The right pane already shows{" "}
				<code>describe(kg, &#123; format: "mermaid" &#125;)</code>. Below is{" "}
				<code>reactiveExplainPath(kg, "paper-text", "current-paragraph")</code> — a{" "}
				<code>Node&lt;CausalChain&gt;</code> that re-derives whenever any node along the path fires.
				The trace covers named, reactively-wired nodes; promptNode's internal nodes and the
				imperative <code>apply-extraction</code> effect mark the boundary of static causal trace.
			</p>
			<div className="controls">
				<button
					type="button"
					className="secondary"
					onClick={() => chapter.advance()}
					disabled={paragraphs.length === 0}
				>
					Extract next paragraph ({paragraphIdx + 1} / {paragraphs.length})
				</button>
				<button type="button" className="danger" onClick={() => chapter.reset()}>
					Reset KG
				</button>
			</div>
			<div className="explain-chain" data-explain-chain>
				{chainText}
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
					<h4>Knowledge graph</h4>
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

function formatChain(chain: CausalChain | null): string {
	if (!chain) return "(awaiting chain…)";
	if (chain.found === false) return `no path: ${chain.reason ?? "unknown"}`;
	if (chain.text) return chain.text;
	if (!chain.steps || chain.steps.length === 0) return "(empty chain)";
	return chain.steps.map((s) => s.path).join("\n  ↓ ");
}
