import { describe, expect, it } from "vitest";
import { mockLLM } from "../../testing/mock-llm.js";

const msg = (content: string) => [{ role: "user" as const, content }];

describe("mockLLM (Phase 14.5.3 — public testing export)", () => {
	it("detects built-in stages from prompt keywords", async () => {
		const m = mockLLM({
			stages: {
				triage: { responses: [{ route: "auto" }] },
				execute: { responses: [{ outcome: "ok" }] },
			},
		});
		await m.invoke(msg("you are a triage classifier; here is the intake item"));
		await m.invoke(msg("you are the implementation agent; produce a fix"));
		expect(m.calls.map((c) => c.stage)).toEqual(["triage", "execute"]);
		expect(m.stageCounts.get("triage")).toBe(1);
		expect(m.callsFor("execute")).toHaveLength(1);
	});

	it("cycles responses per stage; last one repeats", async () => {
		const m = mockLLM({
			stages: { verify: { responses: [{ verified: false }, { verified: true }] } },
		});
		const r1 = await m.invoke(msg("qa reviewer: verify whether the fix works"));
		const r2 = await m.invoke(msg("qa reviewer: verify whether the fix works"));
		const r3 = await m.invoke(msg("qa reviewer: verify whether the fix works"));
		expect(JSON.parse(r1.content)).toEqual({ verified: false });
		expect(JSON.parse(r2.content)).toEqual({ verified: true });
		// Last response repeats once exhausted.
		expect(JSON.parse(r3.content)).toEqual({ verified: true });
	});

	it("falls back for unmatched prompts and supports custom stage names", async () => {
		const m = mockLLM({
			stages: { summarize: { responses: ["short summary"] } },
			fallback: { note: "fallback" },
		});
		const matched = await m.invoke(msg("please summarize this"));
		const unmatched = await m.invoke(msg("totally unrelated prompt text"));
		expect(matched.content).toBe("short summary");
		expect(JSON.parse(unmatched.content)).toEqual({ note: "fallback" });
		expect(m.calls.at(-1)?.stage).toBe("unknown");
	});

	it("reset() clears calls, counts, and per-stage cursor", async () => {
		const m = mockLLM({ stages: { triage: { responses: [{ a: 1 }, { a: 2 }] } } });
		await m.invoke(msg("triage classifier intake item"));
		m.reset();
		expect(m.calls).toHaveLength(0);
		expect(m.stageCounts.size).toBe(0);
		// Cursor reset → next call yields the FIRST response again.
		const r = await m.invoke(msg("triage classifier intake item"));
		expect(JSON.parse(r.content)).toEqual({ a: 1 });
	});

	it("exposes a stream() that yields token/usage/finish deltas", async () => {
		const m = mockLLM();
		const kinds: string[] = [];
		for await (const d of m.stream(msg("x"))) kinds.push(d.type);
		expect(kinds).toEqual(["token", "usage", "finish"]);
	});
});
