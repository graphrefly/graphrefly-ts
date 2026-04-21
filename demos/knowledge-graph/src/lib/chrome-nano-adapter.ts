// Implements the GraphReFly LLMAdapter contract on top of Chrome's built-in
// Prompt API (`window.LanguageModel`). Returns a `Promise<LLMResponse>` from
// `invoke` — promptNode's switchMap consumes that without leaking async
// primitives into the reactive layer (spec §5.10).

import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
} from "@graphrefly/graphrefly/patterns/ai";
import { EXTRACTION_SCHEMA } from "./extraction-schema.js";
import type { AdapterInfo } from "./types.js";

export type ChromeNanoAdapterHandle = {
	adapter: LLMAdapter;
	info(): AdapterInfo;
	destroy(): void;
};

export type ChromeNanoOptions = {
	/** Called when adapter info changes (download progress, ready, error). */
	onInfo?: (info: AdapterInfo) => void;
};

const RESPONSE_CONSTRAINT = EXTRACTION_SCHEMA;

export function isChromeNanoAvailable(): boolean {
	return typeof window !== "undefined" && typeof (window as Window).LanguageModel !== "undefined";
}

export async function probeChromeNano(): Promise<AdapterInfo> {
	if (!isChromeNanoAvailable()) {
		return {
			name: "chrome-nano",
			status: "unavailable",
			note: "window.LanguageModel not present. Use Chrome 138+ with the Prompt API origin trial or built-in AI flag enabled.",
		};
	}
	try {
		const a = await LanguageModel.availability({
			expectedInputs: [{ type: "text", languages: ["en"] }],
			expectedOutputs: [{ type: "text", languages: ["en"] }],
		});
		if (a === "unavailable") {
			return {
				name: "chrome-nano",
				status: "unavailable",
				note: "LanguageModel.availability() reported unavailable on this device.",
			};
		}
		if (a === "downloading" || a === "after-download" || a === "downloadable") {
			return {
				name: "chrome-nano",
				status: "downloading",
				note: "Model is downloading on first use — first prompt will block until ready.",
			};
		}
		return { name: "chrome-nano", status: "ready", note: "On-device Gemini Nano ready." };
	} catch (err) {
		return {
			name: "chrome-nano",
			status: "unavailable",
			note: `Probe threw: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Lazily creates one shared `LanguageModelSession` and reuses it across calls.
 * Sessions own a context window — for the demo's per-paragraph extraction we
 * want a fresh session each invocation so prior paragraphs don't bias the next
 * one. So `invoke` clones from the warm session each call.
 */
export function chromeNanoAdapter(opts: ChromeNanoOptions = {}): ChromeNanoAdapterHandle {
	let warm: Promise<LanguageModelSession> | null = null;
	let info: AdapterInfo = {
		name: "chrome-nano",
		status: "downloading",
		note: "warming up session…",
	};

	function setInfo(next: AdapterInfo) {
		info = next;
		opts.onInfo?.(next);
	}

	function ensureWarm(): Promise<LanguageModelSession> {
		if (warm) return warm;
		warm = LanguageModel.create({
			temperature: 0.2,
			topK: 3,
			expectedInputs: [{ type: "text", languages: ["en"] }],
			expectedOutputs: [{ type: "text", languages: ["en"] }],
			monitor(m) {
				m.addEventListener("downloadprogress", (e) => {
					const pct = Math.round((e.loaded ?? 0) * 100);
					setInfo({
						name: "chrome-nano",
						status: "downloading",
						note: `Model downloading… ${pct}%`,
					});
				});
			},
		}).then(
			(session) => {
				setInfo({
					name: "chrome-nano",
					status: "ready",
					note: "On-device Gemini Nano ready.",
				});
				return session;
			},
			(err) => {
				warm = null; // allow retry on next invoke
				setInfo({
					name: "chrome-nano",
					status: "unavailable",
					note: `LanguageModel.create() failed: ${err instanceof Error ? err.message : String(err)}`,
				});
				throw err;
			},
		);
		return warm;
	}

	const adapter: LLMAdapter = {
		invoke(messages: readonly ChatMessage[], _opts?: LLMInvokeOptions) {
			return (async (): Promise<LLMResponse> => {
				const seed = await ensureWarm();
				let session: LanguageModelSession | undefined;
				try {
					session = await seed.clone();
					const lm: LanguageModelMessage[] = messages.map((m) => ({
						role: m.role === "tool" ? "user" : (m.role as LanguageModelMessage["role"]),
						content: m.content,
					}));
					const text = await session.prompt(lm, {
						responseConstraint: RESPONSE_CONSTRAINT,
					});
					return { content: text, finishReason: "stop" };
				} finally {
					// `session` is undefined if `seed.clone()` rejected; guard before
					// calling destroy so the original error propagates instead of
					// being shadowed by a TypeError.
					if (session) {
						try {
							session.destroy();
						} catch {
							// best-effort teardown
						}
					}
				}
			})() as unknown as ReturnType<LLMAdapter["invoke"]>;
		},
		stream(): AsyncIterable<string> {
			// Streaming isn't used by the demo. Return a generator that throws
			// on first iteration so a caller composing this into a stream
			// pipeline gets an immediate, clear error.
			return {
				[Symbol.asyncIterator]() {
					return {
						next() {
							return Promise.reject(
								new Error("chromeNanoAdapter.stream is not implemented for this demo"),
							);
						},
					};
				},
			};
		},
	};

	return {
		adapter,
		info: () => info,
		destroy() {
			warm?.then((s) => s.destroy()).catch(() => {});
			warm = null;
		},
	};
}
