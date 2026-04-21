import { useEffect, useMemo, useState } from "react";
import { SAMPLE_PAPER } from "../../data/sample-paper";
import { buildReactiveChapter, type ReactiveChapter } from "../../lib/chapters/reactive";
import type { ChapterUIProps } from "../../lib/chapters/types";
import { getSharedAdapter } from "../../lib/shell";
import type { Entity, Relation } from "../../lib/types";
import { fetchPaper } from "../../lib/url-fetcher";
import { useNodeValue } from "../../lib/use-node-value";
import AdapterBanner from "../AdapterBanner";
import KGPane from "../KGPane";
import PaperPane from "../PaperPane";

type Edge = { from: string; to: string; relation: Relation };

let cachedChapter: ReactiveChapter | null = null;

/**
 * Public getter so App can register the chapter with demo-shell synchronously.
 * Uses the shared `lazyAdapter` from `lib/shell.ts` — chapters 2/3/4 all
 * extract through the same adapter so Chrome Nano (when available) is used
 * everywhere, and the adapter banner stays consistent across tab switches.
 */
export function getReactiveChapterSync(): ReactiveChapter {
	if (cachedChapter) return cachedChapter;
	cachedChapter = buildReactiveChapter(getSharedAdapter().adapter, SAMPLE_PAPER.body);
	return cachedChapter;
}

function snapshotKG(c: ReactiveChapter): {
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

export default function ReactiveChapterUI({ hoverTarget, onHover }: ChapterUIProps) {
	const chapter = useMemo(() => getReactiveChapterSync(), []);
	const adapter = useMemo(() => getSharedAdapter(), []);
	const info = useNodeValue(adapter.infoNode, adapter.info());
	const [meta, setMeta] = useState<{ title: string; author?: string; url?: string }>({
		title: SAMPLE_PAPER.title,
		author: SAMPLE_PAPER.author,
		url: SAMPLE_PAPER.url,
	});
	const [urlInput, setUrlInput] = useState<string>("");
	const [fetchStatus, setFetchStatus] = useState<string | null>(null);

	const paperText = useNodeValue(chapter.paperText, SAMPLE_PAPER.body);
	const currentParagraph = useNodeValue(chapter.currentParagraph, "");
	const paragraphs = useNodeValue(chapter.paragraphs, [] as readonly string[]);
	const paragraphIdx = useNodeValue(chapter.paragraphIdx, 0);

	const [snap, setSnap] = useState(() => snapshotKG(chapter));
	useEffect(() => {
		const a = chapter.kg.resolve("entities").subscribe(() => setSnap(snapshotKG(chapter)));
		const b = chapter.kg.resolve("edges").subscribe(() => setSnap(snapshotKG(chapter)));
		return () => {
			a();
			b();
		};
	}, [chapter]);

	async function loadUrl() {
		const url = urlInput.trim();
		if (!url) return;
		setFetchStatus("Fetching…");
		try {
			const fetched = await fetchPaper(url);
			chapter.reset();
			chapter.setPaperText(fetched.body);
			setMeta({ title: fetched.title, url: fetched.url });
			setFetchStatus(null);
		} catch (err) {
			setFetchStatus(
				`Fetch failed (${err instanceof Error ? err.message : String(err)}). Try a different URL or paste content directly.`,
			);
		}
	}

	function loadDefault() {
		chapter.reset();
		chapter.setPaperText(SAMPLE_PAPER.body);
		setMeta({ title: SAMPLE_PAPER.title, author: SAMPLE_PAPER.author, url: SAMPLE_PAPER.url });
		setFetchStatus(null);
	}

	return (
		<div className="chapter">
			<p className="chapter-lede">
				<strong>The reactive turn.</strong> Each paragraph in the paper drives a{" "}
				<code>promptNode</code>; the structured output is funneled into a{" "}
				<code>knowledgeGraph()</code> via one effect. The KG canvas to the right subscribes to{" "}
				<code>kg.adjacency</code> — no polling, no triggers.
			</p>
			<AdapterBanner info={info} />
			<div className="controls">
				<input
					type="url"
					placeholder="Paste any article URL — fetched via r.jina.ai (anonymous, 20 RPM)"
					value={urlInput}
					onChange={(e) => setUrlInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") loadUrl();
					}}
				/>
				<button type="button" onClick={loadUrl}>
					Load URL
				</button>
				<button type="button" className="secondary" onClick={loadDefault}>
					Use sample
				</button>
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
			{fetchStatus ? (
				<div className="adapter-banner unavailable">
					<span>{fetchStatus}</span>
				</div>
			) : null}
			<div className="extraction-grid">
				<PaperPane
					title={meta.title}
					author={meta.author}
					url={meta.url}
					body={paperText}
					currentParagraph={currentParagraph}
				/>
				<div className="kg-pane" data-kg-pane>
					<h4>Knowledge graph (force-directed)</h4>
					<div className="kg-stats">
						<span>
							entities: <strong>{snap.entities.length}</strong>
						</span>
						<span>
							edges: <strong>{snap.edges.length}</strong>
						</span>
					</div>
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
