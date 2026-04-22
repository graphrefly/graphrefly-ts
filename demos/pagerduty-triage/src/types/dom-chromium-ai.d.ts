// Minimal ambient declarations for Chrome's built-in Prompt API
// (https://developer.chrome.com/docs/ai/prompt-api). Hand-rolled so the demo
// doesn't pull a third-party @types package.

export {};

declare global {
	interface Window {
		LanguageModel?: typeof LanguageModel;
	}

	type LanguageModelAvailability =
		| "available"
		| "readily"
		| "after-download"
		| "downloading"
		| "downloadable"
		| "unavailable";

	interface LanguageModelMessage {
		role: "system" | "user" | "assistant";
		content: string;
	}

	interface LanguageModelExpectedIO {
		type: "text";
		languages?: readonly string[];
	}

	interface LanguageModelDownloadProgressEvent extends Event {
		loaded: number;
		total: number;
	}

	interface LanguageModelCreateOptions {
		signal?: AbortSignal;
		monitor?: (m: EventTarget) => void;
		systemPrompt?: string;
		initialPrompts?: readonly LanguageModelMessage[];
		temperature?: number;
		topK?: number;
		expectedInputs?: readonly LanguageModelExpectedIO[];
		expectedOutputs?: readonly LanguageModelExpectedIO[];
	}

	interface LanguageModelPromptOptions {
		signal?: AbortSignal;
		responseConstraint?: unknown;
	}

	interface LanguageModel extends EventTarget {
		prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
		promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
		clone(options?: { signal?: AbortSignal }): Promise<LanguageModel>;
		destroy(): void;

		readonly inputUsage: number;
		readonly inputQuota: number;
	}

	const LanguageModel: {
		availability(options?: {
			expectedInputs?: readonly LanguageModelExpectedIO[];
		}): Promise<LanguageModelAvailability>;
		create(options?: LanguageModelCreateOptions): Promise<LanguageModel>;
	};
}
