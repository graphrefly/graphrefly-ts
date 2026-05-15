/**
 * RN/Hermes engine smoke — the ongoing per-commit indicator that
 * @graphrefly/pure-ts is compatible with the Hermes engine that
 * React Native 0.85.3 ships (graphrefly-ts#4).
 *
 * Two faithful, fast, pinned gates:
 *
 *   1. BYTECODE gate — esbuild-bundle the spike + pure-ts, then run
 *      it through `hermesc -emit-binary -O`, the EXACT compiler RN
 *      0.85.3 uses (npm `hermes-compiler@250829098.0.10`, pinned).
 *      `-O` mirrors a RN *release* build. Success = pure-ts's real
 *      shipped syntax parses + semantically analyses + generates
 *      optimized Hermes bytecode against RN's actual toolchain.
 *
 *   2. SEMANTICS gate — execute the same spike (run-node) so the
 *      reactive protocol math + diamond-dedupe are asserted.
 *
 * Why not execute the .hbc here? No modern Hermes VM ships as a
 * standalone binary — the facebook/hermes CLI *releases* are frozen
 * at an ancient pre-`class` v0.13.0, and building the RN-pinned tag
 * from source yields an old (0.12.0, no-class) `hermes`. Raw Hermes
 * never sees app code anyway: RN's Metro/Babel transforms first.
 * Real on-Hermes-VM execution is therefore covered by the periodic
 * apps/rn-hermes-fixture release build (Metro + RN's real Hermes).
 * Compile-faithfulness here + semantics in Node + VM in the fixture
 * is the honest three-legged signal. See README.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
const require = createRequire(import.meta.url);

// ─── Version matrix (bump deliberately; recorded in issue #4) ────────
const MATRIX = {
	"@graphrefly/pure-ts": "0.45.0",
	"hermes-compiler (= RN 0.85.3's exact hermesc)": "250829098.0.10",
	"react-native (rn-hermes-fixture, Expo SDK 55 matrix)": "0.83.6",
	"expo (rn-hermes-fixture)": "SDK 55 (55.x)",
};

function hermescPath() {
	// hermes-compiler ships prebuilt hermesc per platform; no `bin`.
	const pkgRoot = dirname(require.resolve("hermes-compiler/package.json"));
	const plat =
		process.platform === "darwin"
			? "osx-bin"
			: process.platform === "linux"
				? "linux64-bin"
				: "win64-bin";
	const exe = process.platform === "win32" ? "hermesc.exe" : "hermesc";
	return join(pkgRoot, "hermesc", plat, exe);
}

async function bundle() {
	mkdirSync(DIST, { recursive: true });
	const outfile = join(DIST, "spike.hermes.js");
	await build({
		entryPoints: [join(HERE, "run-hermes-entry.mjs")],
		bundle: true,
		outfile,
		format: "iife",
		platform: "neutral",
		// RN 0.85.3's hermesc is modern (full ES2015+ incl. classes);
		// keep pure-ts's real shipped syntax so the gate tests what
		// actually ships rather than a down-levelled variant.
		target: "es2018",
		// Bare Hermes has no `console`; route it to `print` (only
		// relevant if a future VM step runs this — harmless to hermesc).
		banner: {
			js: "if(typeof console==='undefined'){var console={log:print,info:print,warn:print,error:print,debug:print};}",
		},
		legalComments: "none",
	});
	return outfile;
}

function bytecodeGate(hermesc, js) {
	const hbc = join(DIST, "spike.hbc");
	console.log("──── Gate 1: RN-pinned hermesc -emit-binary -O ────");
	try {
		execFileSync(hermesc, ["-emit-binary", "-O", "-out", hbc, js], {
			stdio: "pipe",
			encoding: "utf8",
		});
		console.log(`  compiled → ${hbc} ✅`);
		return true;
	} catch (err) {
		console.log(`  hermesc FAILED ❌\n${err.stdout ?? ""}${err.stderr ?? ""}`);
		return false;
	}
}

function semanticsGate() {
	console.log("\n──── Gate 2: reactive semantics (Node) ────");
	try {
		const out = execFileSync(process.execPath, [join(HERE, "run-node.mjs")], { encoding: "utf8" });
		for (const l of out.split("\n")) if (l.trim()) console.log(`  ${l}`);
		return out.includes("RESULT: PASS");
	} catch (err) {
		console.log(`  semantics FAILED ❌\n${err.stdout ?? ""}`);
		return false;
	}
}

async function main() {
	const hermesc = hermescPath();
	const ver = execFileSync(hermesc, ["--version"], { encoding: "utf8" })
		.split("\n")
		.find((l) => /Hermes/i.test(l))
		?.trim();

	const js = await bundle();
	const bcOk = bytecodeGate(hermesc, js);
	const semOk = semanticsGate();

	console.log("\n──── Version matrix ────");
	for (const [k, v] of Object.entries(MATRIX)) console.log(`  ${k}: ${v}`);
	console.log(`  hermesc: ${ver ?? "(version line not found)"}`);

	const pass = bcOk && semOk;
	console.log(`\nRESULT: ${pass ? "PASS ✅" : "FAIL ❌"}  (bytecode=${bcOk} semantics=${semOk})`);
	process.exit(pass ? 0 : 1);
}

main().catch((err) => {
	console.error("[smoke] harness error:", err);
	process.exit(1);
});
