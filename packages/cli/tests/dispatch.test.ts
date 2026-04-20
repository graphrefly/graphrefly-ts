import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derived, type GraphSpecCatalog } from "@graphrefly/graphrefly";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, parseArgv } from "../src/index.js";

const catalog: GraphSpecCatalog = {
	fns: {
		double: (deps) => derived(deps, ([v]) => (v as number) * 2),
		addOne: (deps) => derived(deps, ([v]) => (v as number) + 1),
	},
};

const basicSpec = {
	name: "basic",
	nodes: {
		input: { type: "state", initial: 0 },
		doubled: { type: "derived", deps: ["input"], fn: "double" },
		output: { type: "derived", deps: ["doubled"], fn: "addOne" },
	},
};

describe("parseArgv", () => {
	it("splits command + positional + flags", () => {
		const argv = parseArgv(["describe", "spec.json", "--format", "pretty"]);
		expect(argv.command).toBe("describe");
		expect(argv.positional).toEqual(["spec.json"]);
		expect(argv.flags).toEqual({ format: "pretty" });
	});

	it("recognizes snapshot subcommand", () => {
		const argv = parseArgv(["snapshot", "diff", "a.json", "b.json"]);
		expect(argv.command).toBe("snapshot");
		expect(argv.subcommand).toBe("diff");
		expect(argv.positional).toEqual(["a.json", "b.json"]);
	});

	it("treats --flag=value as one token", () => {
		const argv = parseArgv(["reduce", "-", "--input=/tmp/x.json"]);
		expect(argv.flags).toEqual({ input: "/tmp/x.json" });
		expect(argv.positional).toEqual(["-"]);
	});
});

describe("dispatch", () => {
	let dir: string;
	let specPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "graphrefly-cli-"));
		specPath = join(dir, "spec.json");
		writeFileSync(specPath, JSON.stringify(basicSpec));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("describe emits JSON topology to stdout", async () => {
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});
		const code = await dispatch(parseArgv(["describe", specPath]), { catalog });
		expect(code).toBe(0);
		const payload = JSON.parse(writes.join(""));
		expect(payload.name).toBe("basic");
		vi.restoreAllMocks();
	});

	it("reduce runs a pipeline from a JSON file", async () => {
		const inputPath = join(dir, "input.json");
		writeFileSync(inputPath, JSON.stringify(5));
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});
		const code = await dispatch(parseArgv(["reduce", specPath, "--input", inputPath]), { catalog });
		expect(code).toBe(0);
		expect(writes.join("").trim()).toBe("11");
		vi.restoreAllMocks();
	});

	it("explain returns a causal chain", async () => {
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});
		const code = await dispatch(
			parseArgv(["explain", specPath, "--from", "input", "--to", "output"]),
			{ catalog },
		);
		expect(code).toBe(0);
		const chain = JSON.parse(writes.join("")) as {
			from: string;
			to: string;
			found: boolean;
		};
		expect(chain.from).toBe("input");
		expect(chain.to).toBe("output");
		expect(chain.found).toBe(true);
		vi.restoreAllMocks();
	});

	it("surfaces SurfaceError as JSON on stderr with exit code 1", async () => {
		const badPath = join(dir, "bad.json");
		writeFileSync(badPath, JSON.stringify({ name: "", nodes: {} }));
		const errs: string[] = [];
		vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			errs.push(String(chunk));
			return true;
		});
		const code = await dispatch(parseArgv(["describe", badPath]), { catalog });
		expect(code).toBe(1);
		const payload = JSON.parse(errs.join("").trim());
		expect(payload.code).toBe("invalid-spec");
		vi.restoreAllMocks();
	});

	it("unknown command returns exit code 2", async () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const code = await dispatch(parseArgv(["nope"]), { catalog });
		expect(code).toBe(2);
		vi.restoreAllMocks();
	});
});
