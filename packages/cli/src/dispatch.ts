/**
 * CLI command dispatcher — hand-rolled, zero external args deps.
 *
 * Each subcommand is a small async function that takes a parsed `Argv`
 * and returns an exit code. Tests invoke subcommands directly without
 * the binary entrypoint; the binary only threads `process.argv`.
 *
 * Subcommand signatures follow the shape required by §9.3c:
 * - `describe <spec>` — compile + describe
 * - `explain <spec> --from X --to Y` — compile + explain
 * - `observe <spec> [--path P]` — compile + one-shot observe
 * - `reduce <spec> --input <path|-> [--output Y]` — one-shot run
 * - `snapshot diff <a> <b>` — snapshot file diff (no tier)
 * - `snapshot validate <file>` — structural snapshot validation
 *
 * `--format=json|pretty` toggles stdout formatting.
 *
 * @module
 */

import type { GraphSpec, GraphSpecCatalog } from "@graphrefly/graphrefly";
import { createGraph, Graph, runReduction, SurfaceError } from "@graphrefly/graphrefly";
import type { OutputFormat } from "./io.js";
import { readJson, writeOutput } from "./io.js";

export interface Argv {
	command: string;
	subcommand?: string;
	positional: string[];
	flags: Record<string, string | true>;
}

export function parseArgv(tokens: readonly string[]): Argv {
	const [command, ...rest] = tokens;
	const positional: string[] = [];
	const flags: Record<string, string | true> = {};
	let subcommand: string | undefined;
	for (let i = 0; i < rest.length; i++) {
		const t = rest[i]!;
		if (t.startsWith("--")) {
			const eq = t.indexOf("=");
			if (eq >= 0) {
				flags[t.slice(2, eq)] = t.slice(eq + 1);
			} else {
				const next = rest[i + 1];
				if (next != null && !next.startsWith("--")) {
					flags[t.slice(2)] = next;
					i += 1;
				} else {
					flags[t.slice(2)] = true;
				}
			}
		} else if (subcommand == null && command === "snapshot") {
			subcommand = t;
		} else {
			positional.push(t);
		}
	}
	return {
		command: command ?? "",
		...(subcommand != null ? { subcommand } : {}),
		positional,
		flags,
	};
}

function resolveFormat(argv: Argv): OutputFormat {
	const f = argv.flags.format;
	if (f === "pretty") return "pretty";
	return "json";
}

export interface DispatchOptions {
	/** Fn/source catalog for `compile`, `reduce`, etc. Empty by default. */
	catalog?: GraphSpecCatalog;
}

export async function dispatch(argv: Argv, opts?: DispatchOptions): Promise<number> {
	const catalog: GraphSpecCatalog = opts?.catalog ?? {};
	try {
		switch (argv.command) {
			case "describe":
				return describeCmd(argv, catalog);
			case "explain":
				return explainCmd(argv, catalog);
			case "observe":
				return observeCmd(argv, catalog);
			case "reduce":
				return await reduceCmd(argv, catalog);
			case "snapshot":
				return snapshotCmd(argv);
			case "help":
			case "--help":
			case "-h":
			case "":
				printHelp();
				return 0;
			default:
				process.stderr.write(`graphrefly: unknown command "${argv.command}"\n`);
				printHelp();
				return 2;
		}
	} catch (err) {
		if (err instanceof SurfaceError) {
			process.stderr.write(`${JSON.stringify(err.toJSON())}\n`);
			return 1;
		}
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`graphrefly: ${message}\n`);
		return 1;
	}
}

function requireSpecPath(argv: Argv): string {
	const spec = argv.positional[0] ?? (argv.flags.spec as string | undefined);
	if (spec == null || typeof spec !== "string") {
		throw new Error(
			"expected a GraphSpec path (or `-` for stdin) as the first positional argument",
		);
	}
	return spec;
}

function describeCmd(argv: Argv, catalog: GraphSpecCatalog): number {
	const spec = readJson(requireSpecPath(argv)) as GraphSpec;
	const g = createGraph(spec, { catalog });
	try {
		const format = argv.flags.format as string | undefined;
		if (format === "mermaid" || format === "d2" || format === "pretty") {
			const rendered = g.describe({
				detail: (argv.flags.detail as "minimal" | "standard" | "full" | undefined) ?? "standard",
				format,
			});
			process.stdout.write(`${rendered as unknown as string}\n`);
			return 0;
		}
		const described = g.describe({
			detail: (argv.flags.detail as "minimal" | "standard" | "full" | undefined) ?? "standard",
		});
		writeOutput(described, resolveFormat(argv));
		return 0;
	} finally {
		g.destroy();
	}
}

function explainCmd(argv: Argv, catalog: GraphSpecCatalog): number {
	const spec = readJson(requireSpecPath(argv)) as GraphSpec;
	const from = argv.flags.from as string | undefined;
	const to = argv.flags.to as string | undefined;
	if (from == null || to == null) {
		throw new Error("explain requires --from <path> and --to <path>");
	}
	const g = createGraph(spec, { catalog });
	try {
		const chain = g.explain(from, to);
		writeOutput(chain.toJSON(), resolveFormat(argv));
		return 0;
	} finally {
		g.destroy();
	}
}

function observeCmd(argv: Argv, catalog: GraphSpecCatalog): number {
	const spec = readJson(requireSpecPath(argv)) as GraphSpec;
	const path = argv.flags.path as string | undefined;
	const detail = (argv.flags.detail as "minimal" | "standard" | "full" | undefined) ?? "standard";
	const g = createGraph(spec, { catalog });
	try {
		const described = g.describe({ detail });
		if (path == null) {
			writeOutput(described, resolveFormat(argv));
			return 0;
		}
		const slice = described.nodes[path];
		if (slice == null) {
			throw new SurfaceError("node-not-found", `node "${path}" is not registered`, { path });
		}
		writeOutput({ path, ...(slice as unknown as Record<string, unknown>) }, resolveFormat(argv));
		return 0;
	} finally {
		g.destroy();
	}
}

async function reduceCmd(argv: Argv, catalog: GraphSpecCatalog): Promise<number> {
	const spec = readJson(requireSpecPath(argv)) as GraphSpec;
	const inputSource = argv.flags.input as string | undefined;
	if (inputSource == null) throw new Error("reduce requires --input <path|-> for the input JSON");
	const input = readJson(inputSource);
	const result = await runReduction(spec, input, {
		catalog,
		...(typeof argv.flags["input-path"] === "string"
			? { inputPath: argv.flags["input-path"] as string }
			: {}),
		...(typeof argv.flags["output-path"] === "string"
			? { outputPath: argv.flags["output-path"] as string }
			: {}),
		...(typeof argv.flags["timeout-ms"] === "string"
			? { timeoutMs: Number(argv.flags["timeout-ms"]) }
			: {}),
	});
	writeOutput(result, resolveFormat(argv));
	return 0;
}

function snapshotCmd(argv: Argv): number {
	switch (argv.subcommand) {
		case "diff": {
			const [a, b] = argv.positional;
			if (a == null || b == null) {
				throw new Error("snapshot diff requires two snapshot file paths");
			}
			const snapA = readJson(a) as import("@graphrefly/graphrefly").GraphPersistSnapshot;
			const snapB = readJson(b) as import("@graphrefly/graphrefly").GraphPersistSnapshot;
			const diff = Graph.diff(snapA, snapB);
			writeOutput(diff, resolveFormat(argv));
			return 0;
		}
		case "validate": {
			const [file] = argv.positional;
			if (file == null) throw new Error("snapshot validate requires a snapshot file path");
			const snap = readJson(file) as import("@graphrefly/graphrefly").GraphPersistSnapshot;
			// Minimal structural check — the full parser lives inside Graph;
			// reconstructing validates the envelope version + required keys.
			try {
				Graph.fromSnapshot(snap);
				writeOutput({ valid: true }, resolveFormat(argv));
				return 0;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeOutput({ valid: false, error: message }, resolveFormat(argv));
				return 1;
			}
		}
		default:
			throw new Error(
				`snapshot: unknown subcommand "${argv.subcommand ?? ""}" (expected diff|validate)`,
			);
	}
}

function printHelp(): void {
	process.stdout.write(`graphrefly — reactive harness CLI

USAGE
  graphrefly <command> [options]

COMMANDS
  describe <spec>                     Compile a GraphSpec and emit its topology.
  explain  <spec> --from X --to Y     Compile + emit a CausalChain from X to Y.
  observe  <spec> [--path P]          Compile + emit one-shot node or graph state.
  reduce   <spec> --input <path|->    Run a one-shot input → pipeline → output.
  snapshot diff     <a> <b>           Diff two snapshot files.
  snapshot validate <file>            Validate a snapshot file envelope.

COMMON FLAGS
  --format=json|pretty                Stdout format (json default).
  --detail=minimal|standard|full      Detail level for describe/observe.

SPEC SOURCES
  A <spec> positional is either a path to a .json file or "-" for stdin.
  Same applies to --input for reduce.
`);
}
