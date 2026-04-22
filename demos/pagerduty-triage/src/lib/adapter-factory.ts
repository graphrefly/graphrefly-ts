// ── Adapter factory ─────────────────────────────────────────────
// Creates the LLM adapter based on user selection.

import type { ChatMessage, LLMAdapter, LLMResponse } from "@graphrefly/graphrefly/patterns/ai";
import { createDryRunAdapter } from "./dry-run-fixtures.js";
import type { AdapterMode } from "./types.js";

// ── Chrome Nano ─────────────────────────────────────────────────

export function isChromeNanoAvailable(): boolean {
	return typeof window !== "undefined" && typeof (window as Window).LanguageModel !== "undefined";
}

export async function probeChromeNano(): Promise<{
	available: boolean;
	note: string;
}> {
	if (!isChromeNanoAvailable()) {
		return {
			available: false,
			note: "window.LanguageModel not present. Use Chrome 138+ with Prompt API enabled.",
		};
	}
	try {
		const a = await LanguageModel.availability({
			expectedInputs: [{ type: "text", languages: ["en"] }],
		});
		if (a === "unavailable") {
			return { available: false, note: "LanguageModel reported unavailable." };
		}
		return { available: true, note: a === "readily" ? "Ready" : `Status: ${a}` };
	} catch (err) {
		return {
			available: false,
			note: `Probe error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

function createChromeNanoAdapter(): LLMAdapter {
	let session: Promise<LanguageModel> | null = null;

	function ensureSession(): Promise<LanguageModel> {
		if (session) return session;
		session = LanguageModel.create({
			temperature: 0.2,
			topK: 3,
			systemPrompt: "You are an SRE triage assistant. Respond with JSON only.",
		}).catch((err) => {
			// Clear the cached promise so the next call retries creation.
			session = null;
			throw err;
		}) as Promise<LanguageModel>;
		return session;
	}

	return {
		provider: "chrome-nano",
		model: "gemini-nano",
		invoke(messages: readonly ChatMessage[]) {
			return (async (): Promise<LLMResponse> => {
				const s = await ensureSession();
				const userMsg = messages.find((m) => m.role === "user");
				const text = await s.prompt(userMsg?.content ?? "");
				return { content: text, finishReason: "stop" };
			})() as unknown as ReturnType<LLMAdapter["invoke"]>;
		},
		stream() {
			return {
				[Symbol.asyncIterator]() {
					return {
						next: () =>
							Promise.reject(new Error("stream not implemented for Chrome Nano triage demo")),
					};
				},
			};
		},
	};
}

// ── BYOK (Bring Your Own Key) ───────────────────────────────────
// Uses a simple fetch-based adapter that talks to the OpenAI-compatible API.

function createByokAdapter(apiKey: string, baseUrl: string, model: string): LLMAdapter {
	return {
		provider: "byok",
		model,
		invoke(messages: readonly ChatMessage[]) {
			return (async (): Promise<LLMResponse> => {
				const resp = await fetch(`${baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model,
						messages: messages.map((m) => ({ role: m.role, content: m.content })),
						temperature: 0.3,
						max_tokens: 200,
					}),
				});
				if (!resp.ok) {
					throw new Error(`BYOK API error: ${resp.status} ${resp.statusText}`);
				}
				const data = (await resp.json()) as {
					choices: { message: { content: string } }[];
					usage?: { prompt_tokens: number; completion_tokens: number };
				};
				const content = data.choices[0]?.message.content ?? "";
				return {
					content,
					finishReason: "stop",
					usage: data.usage
						? {
								input: { regular: data.usage.prompt_tokens },
								output: { regular: data.usage.completion_tokens },
							}
						: undefined,
				};
			})() as unknown as ReturnType<LLMAdapter["invoke"]>;
		},
		stream() {
			return {
				[Symbol.asyncIterator]() {
					return {
						next: () => Promise.reject(new Error("stream not implemented for BYOK triage demo")),
					};
				},
			};
		},
	};
}

// ── Factory ─────────────────────────────────────────────────────

export interface CreateAdapterOpts {
	mode: AdapterMode;
	apiKey?: string;
	baseUrl?: string;
	model?: string;
}

export function createAdapter(opts: CreateAdapterOpts): LLMAdapter {
	switch (opts.mode) {
		case "dry-run":
			return createDryRunAdapter();
		case "chrome-nano":
			return createChromeNanoAdapter();
		case "byok":
			if (!opts.apiKey) throw new Error("BYOK mode requires an API key");
			return createByokAdapter(
				opts.apiKey,
				opts.baseUrl ?? "https://api.openai.com/v1",
				opts.model ?? "gpt-4o-mini",
			);
	}
}
