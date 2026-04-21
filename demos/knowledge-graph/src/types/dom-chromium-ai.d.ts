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
		readonly loaded: number;
	}

	interface LanguageModelDownloadMonitor extends EventTarget {
		addEventListener(
			type: "downloadprogress",
			listener: (e: LanguageModelDownloadProgressEvent) => void,
		): void;
	}

	interface LanguageModelCreateOptions {
		temperature?: number;
		topK?: number;
		signal?: AbortSignal;
		initialPrompts?: readonly LanguageModelMessage[];
		expectedInputs?: readonly LanguageModelExpectedIO[];
		expectedOutputs?: readonly LanguageModelExpectedIO[];
		monitor?: (m: LanguageModelDownloadMonitor) => void;
	}

	interface LanguageModelPromptOptions {
		signal?: AbortSignal;
		// JSON Schema (or RegExp) constraint on the response.
		responseConstraint?: unknown;
		omitResponseConstraintInput?: boolean;
	}

	interface LanguageModelSession {
		readonly contextWindow: number;
		readonly contextUsage: number;
		prompt(
			input: string | readonly LanguageModelMessage[],
			options?: LanguageModelPromptOptions,
		): Promise<string>;
		promptStreaming(
			input: string | readonly LanguageModelMessage[],
			options?: LanguageModelPromptOptions,
		): ReadableStream<string>;
		append(messages: readonly LanguageModelMessage[]): Promise<void>;
		clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
		destroy(): void;
		addEventListener(type: "contextoverflow", listener: (e: Event) => void): void;
	}

	const LanguageModel: {
		availability(opts?: {
			expectedInputs?: readonly LanguageModelExpectedIO[];
			expectedOutputs?: readonly LanguageModelExpectedIO[];
		}): Promise<LanguageModelAvailability>;
		create(opts?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
	};
}
