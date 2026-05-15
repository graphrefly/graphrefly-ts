import { describe, expect, it } from "vitest";
import {
	createCapabilitiesRegistry,
	type ModelCapabilities,
} from "../../../../utils/ai/adapters/core/capabilities.js";

const cap = (
	id: string,
	provider: string,
	extra?: Partial<ModelCapabilities>,
): ModelCapabilities => ({
	id,
	provider,
	...extra,
});

describe("CapabilitiesRegistry", () => {
	it("exact and prefix lookup", () => {
		const reg = createCapabilitiesRegistry();
		const c1 = cap("claude-sonnet-4-6", "anthropic", { limits: { contextWindow: 200_000 } });
		reg.register(c1);
		expect(reg.lookup("anthropic", "claude-sonnet-4-6")).toBe(c1);
		expect(reg.lookup("anthropic", "claude-sonnet-4-6-20260401")).toBe(c1);
	});

	it("exact wins over prefix (longest match)", () => {
		const reg = createCapabilitiesRegistry();
		const short = cap("gpt-5", "openai");
		const long = cap("gpt-5.2", "openai");
		reg.register(short);
		reg.register(long);
		expect(reg.lookup("openai", "gpt-5.2-codex")).toBe(long);
	});

	it("initial seed works", () => {
		const reg = createCapabilitiesRegistry([cap("a", "p1"), cap("b", "p2")]);
		expect(reg.lookup("p1", "a")?.id).toBe("a");
		expect(reg.lookup("p2", "b")?.id).toBe("b");
	});

	it("remove + entries", () => {
		const reg = createCapabilitiesRegistry();
		reg.register(cap("a", "p"));
		reg.register(cap("b", "p"));
		expect([...reg.entries()].length).toBe(2);
		reg.remove("p", "a");
		expect([...reg.entries()].length).toBe(1);
	});
});
