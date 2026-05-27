// LLMAdapter wrapper that picks chrome-nano or mock at first invocation.
//
// Why this exists: chapter UIs are constructed synchronously at module load
// (so the demo-shell can register the chapter's graph for the topology
// mermaid). But Chrome Nano availability requires `await
// LanguageModel.availability(...)`. If we built the chapter eagerly with a
// mock adapter, Chrome Nano would never get a chance even when present.
//
// This wrapper is `LLMAdapter`-shaped, so the chapter captures it once. On
// the first `invoke()`, it probes Chrome Nano, picks the real implementation,
// and routes everything from then on.
//
// Adapter status is exposed as a `state<AdapterInfo>` Node so:
//   1. UI banners subscribe via `useNodeValue(handle.infoNode, ...)`
//   2. `graph.describe()` and `graph.describe({ explain: {...}, reactive: true })` see adapter status if
//      callers attach the node to a graph
//   3. Chrome Nano download progress propagates automatically (every push
//      from chrome-nano-adapter's `onInfo` callback writes the state node)

import { node, type Node } from "@graphrefly/pure-ts";
import type { LLMAdapter, LLMResponse } from "@graphrefly/graphrefly/utils/ai";
import { chromeNanoAdapter, probeChromeNano } from "./chrome-nano-adapter.js";
import { mockExtractAdapter } from "./mock-extract-adapter.js";
import type { AdapterInfo } from "./types.js";

export type LazyAdapterHandle = {
	adapter: LLMAdapter;
	/** Reactive view of current adapter status. Subscribe via `useNodeValue`. */
	infoNode: Node<AdapterInfo>;
	/** Convenience peek (most callers should subscribe to `infoNode`). */
	info(): AdapterInfo;
};

const PROBING_INFO: AdapterInfo = {
	name: "mock",
	status: "downloading",
	note: "Probing Chrome Nano on first extraction…",
};

const MOCK_FALLBACK_NOTE = (probedNote: string) =>
	`Chrome Nano not available — using mock fallback (keyword lexicon + capitalized-phrase + noun-suffix heuristic). For real LLM extraction, open Chrome 138+ with the Prompt API enabled (chrome://flags/#prompt-api-for-gemini-nano). Probe result: ${probedNote}`;

export function lazyAdapter(): LazyAdapterHandle {
	let chosen: LLMAdapter | null = null;
	let mockFallback: LLMAdapter | null = null;
	const infoNode = node<AdapterInfo>([], {
		name: "adapter-info",
		initial: PROBING_INFO,
		describeKind: "state",
	});

	function setInfo(next: AdapterInfo): void {
		infoNode.emit(next);
	}

	function mockAdapter(note: string): LLMAdapter {
		if (!mockFallback) mockFallback = mockExtractAdapter();
		setInfo({ name: "mock", status: "ready", note });
		return mockFallback;
	}

	let pending: Promise<LLMAdapter> | null = null;
	function choose(): Promise<LLMAdapter> {
		if (chosen) return Promise.resolve(chosen);
		if (pending) return pending;
		pending = (async () => {
			try {
				const probed = await probeChromeNano();
				// Only bind Chrome Nano when the model is actually ready. Treating
				// "downloading" as ready made first extraction block on
				// LanguageModel.create() — promptNode saw ERROR/null and the KG
				// stayed empty even after many "Extract next paragraph" clicks.
				if (probed.status === "ready") {
					const handle = chromeNanoAdapter({ onInfo: setInfo });
					chosen = handle.adapter;
					setInfo(probed);
				} else {
					chosen = mockAdapter(
						probed.status === "downloading"
							? `${MOCK_FALLBACK_NOTE(probed.note)} (mock until Nano is ready — reload after download completes.)`
							: MOCK_FALLBACK_NOTE(probed.note),
					);
				}
				return chosen;
			} catch (err) {
				// Probe failure should not brick extraction — fall back to mock.
				pending = null;
				chosen = mockAdapter(
					`Adapter probe failed — using mock fallback: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				return chosen;
			}
		})();
		return pending;
	}

	async function invokeWithFallback(
		messages: Parameters<LLMAdapter["invoke"]>[0],
		opts: Parameters<LLMAdapter["invoke"]>[1],
	): Promise<LLMResponse> {
		try {
			const a = await choose();
			const result = a.invoke(messages, opts);
			if (result && typeof (result as PromiseLike<unknown>).then === "function") {
				return await (result as PromiseLike<LLMResponse>);
			}
			return result as LLMResponse;
		} catch (err) {
			// Chrome Nano can probe "ready" then fail on create/prompt — recover
			// once per page load by switching to the deterministic mock.
			if (chosen !== mockFallback) {
				chosen = mockAdapter(
					`Chrome Nano invoke failed — using mock fallback: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				const retry = chosen.invoke(messages, opts);
				if (retry && typeof (retry as PromiseLike<unknown>).then === "function") {
					return await (retry as PromiseLike<LLMResponse>);
				}
				return retry as LLMResponse;
			}
			throw err;
		}
	}

	const adapter: LLMAdapter = {
		invoke(messages, opts) {
			return invokeWithFallback(messages, opts) as ReturnType<LLMAdapter["invoke"]>;
		},
		stream(messages, opts): AsyncIterable<string> {
			return {
				[Symbol.asyncIterator]() {
					let inner: AsyncIterator<string> | null = null;
					return {
						async next() {
							if (!inner) {
								const a = await choose();
								inner = a.stream(messages, opts)[Symbol.asyncIterator]();
							}
							return inner.next();
						},
					};
				},
			};
		},
	};

	return {
		adapter,
		infoNode,
		info: () => infoNode.cache as AdapterInfo,
	};
}
