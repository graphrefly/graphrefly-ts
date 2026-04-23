/**
 * Tests for `fallbackAdapter` — fixture-backed LLMAdapter peer.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryStorage } from "../../../../extra/storage-core.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
	StreamDelta,
} from "../../../../patterns/ai/adapters/core/types.js";
// Filesystem-backed fixture options (`fixturesDir`, `record.dir`) live in the
// node subpath — the base `fallbackAdapter` is browser-safe and only accepts
// inline `fixtures` or a pre-built `fixturesStorage` tier.
import { fallbackAdapter } from "../../../../patterns/ai/adapters/providers/fallback-node.js";
import {
	dryRunAdapter,
	type FallbackFixture,
	FallbackMissError,
} from "../../../../patterns/ai/adapters/providers/index.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "fallback-test-"));
}

function msg(role: ChatMessage["role"], content: string): ChatMessage {
	return { role, content };
}

function resp(content: string): LLMResponse {
	return {
		content,
		usage: { input: { regular: 10 }, output: { regular: 5 } },
		finishReason: "stop",
		model: "fallback",
		provider: "fallback",
	};
}

describe("fallbackAdapter", () => {
	it("exposes provider='fallback' by default", () => {
		const a = fallbackAdapter();
		expect(a.provider).toBe("fallback");
		expect(a.model).toBe("fallback");
	});

	it("invoke: returns a fixture written by record mode", async () => {
		const dir = tmp();
		const inner: LLMAdapter = dryRunAdapter({
			model: "mock",
			respond: () => "canned-response",
		});
		// Record writes under `dir/fallback/` (auto-namespaced by keyPrefix).
		const recorder = fallbackAdapter({ record: { adapter: inner, dir } });
		const messages = [msg("user", "hi")];
		const r1 = await recorder.invoke(messages);
		expect(r1.content).toBe("canned-response");

		// Second adapter reads from the same dir — auto-namespacing puts it
		// at the same `dir/fallback/` — so same prompt should hit.
		const replay = fallbackAdapter({ fixturesDir: dir, onMiss: "throw" });
		const r2 = await replay.invoke(messages);
		expect(r2.content).toBe("canned-response");
		rmSync(dir, { recursive: true });
	});

	it("invoke: onMiss='throw' raises FallbackMissError", async () => {
		const a = fallbackAdapter({ onMiss: "throw" });
		await expect(a.invoke([msg("user", "never-cached")])).rejects.toBeInstanceOf(FallbackMissError);
	});

	it("invoke: onMiss='respond' (default) uses caller's respond fn", async () => {
		const a = fallbackAdapter({
			respond: (msgs) => `degraded: ${msgs[msgs.length - 1]?.content}`,
		});
		const r = await a.invoke([msg("user", "ping")]);
		expect(r.content).toBe("degraded: ping");
		expect(r.metadata?.degraded).toBe(true);
	});

	it("invoke: onMiss without respond returns canned degraded response", async () => {
		const a = fallbackAdapter();
		const r = await a.invoke([msg("user", "anything")]);
		expect(r.content).toMatch(/\[fallback:/);
		expect(r.metadata?.degraded).toBe(true);
		expect(r.metadata?.reason).toBe("no-fixture");
	});

	it("record mode: persists fixture under the namespaced subdir", async () => {
		const dir = tmp();
		const inner = dryRunAdapter({ model: "mock", respond: () => "recorded" });
		const a = fallbackAdapter({ record: { adapter: inner, dir } });
		await a.invoke([msg("user", "seed")]);
		// Auto-namespace: files go into `dir/fallback/`, not `dir/`.
		const namespaced = join(dir, "fallback");
		const files = readdirSync(namespaced);
		expect(files).toHaveLength(1);
		const filename = files[0] as string;
		// Filename encodes `fallback:<sha256>` — the `:` is URL-encoded as `%3a` by fileStorage.
		expect(filename).toMatch(/^fallback(%3a|[:_])[0-9a-f]{64}/i);
		const content = JSON.parse(readFileSync(join(namespaced, filename), "utf8")) as {
			response: LLMResponse;
			storedAtNs: number;
		};
		expect(content.response.content).toBe("recorded");
		expect(typeof content.storedAtNs).toBe("number");
		rmSync(dir, { recursive: true });
	});

	it("record mode: defaults record.dir to fixturesDir when omitted", async () => {
		const dir = tmp();
		const inner = dryRunAdapter({ model: "mock", respond: () => "inherited" });
		// `record.dir` omitted; adapter inherits from `fixturesDir`.
		// Empty dir → validator sees no .json, passes. Record writes fill it.
		const a = fallbackAdapter({ fixturesDir: dir, record: { adapter: inner } });
		await a.invoke([msg("user", "seed")]);
		const files = readdirSync(join(dir, "fallback"));
		expect(files).toHaveLength(1);
		rmSync(dir, { recursive: true });
	});

	it("record + replay combined: second call hits cache, inner not re-invoked", async () => {
		const dir = tmp();
		let innerCalls = 0;
		const inner: LLMAdapter = {
			provider: "mock",
			model: "mock",
			async invoke() {
				innerCalls++;
				return resp("once");
			},
			async *stream() {
				yield { type: "token", delta: "once" } as StreamDelta;
			},
		};
		const a = fallbackAdapter({ record: { adapter: inner, dir } });
		await a.invoke([msg("user", "seed")]);
		expect(innerCalls).toBe(1);
		const r2 = await a.invoke([msg("user", "seed")]);
		expect(r2.content).toBe("once");
		expect(innerCalls).toBe(1);
		rmSync(dir, { recursive: true });
	});

	it("stream: replays recorded stream transcript in order", async () => {
		const dir = tmp();
		const inner = dryRunAdapter({
			model: "mock",
			respond: () => "streamed-out",
			streamChunkSize: 4,
		});
		const rec = fallbackAdapter({ record: { adapter: inner, dir } });
		const recChunks: StreamDelta[] = [];
		for await (const c of rec.stream([msg("user", "s")])) recChunks.push(c);
		expect(recChunks.some((c) => c.type === "token")).toBe(true);

		const replay = fallbackAdapter({ fixturesDir: dir, onMiss: "throw" });
		const playedChunks: StreamDelta[] = [];
		for await (const c of replay.stream([msg("user", "s")])) playedChunks.push(c);

		const joinTokens = (chunks: StreamDelta[]): string =>
			chunks
				.filter((c): c is Extract<StreamDelta, { type: "token" }> => c.type === "token")
				.map((c) => c.delta)
				.join("");
		expect(joinTokens(playedChunks)).toBe(joinTokens(recChunks));
		rmSync(dir, { recursive: true });
	});

	it("stream: invoke-only fixture synthesizes single-chunk stream from content", async () => {
		const dir = tmp();
		const inner = dryRunAdapter({ model: "mock", respond: () => "plain-content" });
		const rec = fallbackAdapter({ record: { adapter: inner, dir } });
		await rec.invoke([msg("user", "q")]); // record via invoke — no stream transcript

		const replay = fallbackAdapter({ fixturesDir: dir, onMiss: "throw" });
		const chunks: StreamDelta[] = [];
		for await (const c of replay.stream([msg("user", "q")])) chunks.push(c);
		const text = chunks
			.filter((c): c is Extract<StreamDelta, { type: "token" }> => c.type === "token")
			.map((c) => c.delta)
			.join("");
		expect(text).toBe("plain-content");
		expect(chunks.some((c) => c.type === "finish")).toBe(true);
		rmSync(dir, { recursive: true });
	});

	it("stream: onMiss='throw' raises FallbackMissError when cacheStreaming cache misses", async () => {
		// With no fixtures + onMiss:throw, the stream-miss path throws via
		// withReplayCache's read-strict mode — cacheStreaming: true is wired
		// internally by fallbackAdapter, so streams ARE cache-checked.
		const a = fallbackAdapter({ onMiss: "throw" });
		const iter = a.stream([msg("user", "miss")]);
		await expect(iter.next()).rejects.toBeInstanceOf(FallbackMissError);
	});

	it("fixturesDir that does not exist is treated as empty (no throw at init)", () => {
		const a = fallbackAdapter({
			fixturesDir: "/nonexistent/path/deliberately",
			onMiss: "respond",
		});
		expect(a.provider).toBe("fallback");
	});

	it("fixturesDir with a hand-authored (non-cache-format) file throws at init", () => {
		// Post-A5: validator throws instead of silently skipping. Users who
		// want hand-authored fixtures should use the inline `fixtures: [...]`
		// option, not drop files into the directory.
		const dir = tmp();
		const namespaced = join(dir, "fallback");
		// Write a {messages, response} hand-authored-shaped JSON into the
		// namespaced subdir. The validator should reject it.
		mkdirSync(namespaced, { recursive: true });
		writeFileSync(
			join(namespaced, "hand.json"),
			JSON.stringify({ messages: [msg("user", "x")], response: resp("y") }),
		);
		expect(() => fallbackAdapter({ fixturesDir: dir })).toThrow(/not in cache-file format/);
		rmSync(dir, { recursive: true });
	});

	it("fixturesDir with invalid JSON throws a clear error at init", () => {
		const dir = tmp();
		const namespaced = join(dir, "fallback");
		mkdirSync(namespaced, { recursive: true });
		writeFileSync(join(namespaced, "broken.json"), "{not-json]");
		expect(() => fallbackAdapter({ fixturesDir: dir })).toThrow(/not valid JSON/);
		rmSync(dir, { recursive: true });
	});

	it("rejects multiple fixture sources set at once", () => {
		expect(() =>
			fallbackAdapter({
				fixtures: [],
				fixturesDir: "/tmp/x",
			}),
		).toThrow(/mutually exclusive/);
	});

	it("inline fixtures: messages-keyed auto-hashed at init", async () => {
		const fixture: FallbackFixture = {
			messages: [msg("user", "what's 2+2?")],
			response: resp("4"),
		};
		const a = fallbackAdapter({ fixtures: [fixture], onMiss: "throw" });
		// Same messages → adapter computes same hash → hit.
		const r = await a.invoke([msg("user", "what's 2+2?")]);
		expect(r.content).toBe("4");
		// Different messages → miss → throw.
		await expect(a.invoke([msg("user", "other question")])).rejects.toBeInstanceOf(
			FallbackMissError,
		);
	});

	it("rejects record.storage + record.dir together", () => {
		const inner = dryRunAdapter({ model: "mock", respond: () => "x" });
		expect(() =>
			fallbackAdapter({
				record: { adapter: inner, dir: "/tmp/x", storage: memoryStorage() },
			}),
		).toThrow(/mutually exclusive/);
	});
});
