import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	type D45AdmittedEffectV1,
	type D45CanonicalEvidenceV1,
	type D45EffectResultInputV1,
	type D45GraphToolAuthorityV1,
	readD45ToolArguments,
	snapshotD45CanonicalEvidence,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "./graph-tool-authority.js";
import {
	createD45QualificationCampaign,
	createExactModelHarnessProfileInput,
	D45_ASSIGNMENT,
	D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
	D45_PUBLIC_SEMANTIC_SCENARIOS,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./graph-tool-qualification.js";
import {
	classifyD45ChatExecutorFailure,
	classifyD45ChatTransportFailure,
	lowerD45ProviderEffect,
	parseD45ChatProviderResponse,
} from "./mechanical-chat-adapter.js";
import {
	type D61PublicSemanticObservationV1,
	executeD61PublicSemanticScenarios,
	executeD63WithheldSemanticScenario,
} from "./public-semantic-scenarios.js";

export const D44_D45_LIVE_REVISION = "graphrefly-ts.d44.d45-live-composition.v1" as const;
export const D44_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;
export const D44_PROVIDER_TAG = "deepinfra/fp8" as const;
export const D44_PROVIDER_DEADLINE_MS = 600_000 as const;
export const D44_D45_BASELINE_COMMIT = "dea57bdeb4b370dddbbe2505bd05f9e3551b26c6" as const;

export const D44_FIXED_ADMISSION_BLOCK = `\t\tadmissionId,\n\t\tprincipalId,\n\t\tprincipalSessionRevision,\n\t\ttenantId,\n\t\tworkspaceId,\n\t\tresourceKind,\n\t\tresourceId,\n\t\tresourceRevision,\n\t\tpolicyRevision,\n\t\tmodelRevision,\n\t])\n\t\tassertSafe(value, "admitted coordinate");\n\tassertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");`;
export const D44_BUGGY_ADMISSION_BLOCK = `\t\tadmissionId,\n\t\tadmissionProposalId,\n\t\tprincipalId,\n\t\tprincipalSessionRevision,\n\t\ttenantId,\n\t\tworkspaceId,\n\t\tresourceKind,\n\t\tresourceId,\n\t\tresourceRevision,\n\t\tpolicyRevision,\n\t\tmodelRevision,\n\t])\n\t\tassertSafe(value, "admitted coordinate");`;

const MAX_PROCESS_BYTES = 2 * 1_048_576;

interface WorkspaceState {
	readonly root: string;
	readonly arm: D45AdmittedEffectV1["arm"];
	digest: string;
	cleaned: boolean;
}

export interface D44LiveExecutorV1 {
	readonly revision: typeof D44_D45_LIVE_REVISION;
	readonly execute: (
		authority: object,
		effect: D45AdmittedEffectV1,
	) => Promise<{
		readonly result: D45EffectResultInputV1;
		readonly retryDelayMs: number;
	}>;
	readonly dispose: () => Promise<void>;
}

function boundedElapsed(started: number, reservation: number): number {
	return Math.max(0, Math.min(reservation, Math.ceil(performance.now() - started)));
}

function remainingElapsed(started: number, reservation: number): number {
	const remaining = Math.floor(reservation - (performance.now() - started));
	if (remaining < 1) throw new TypeError("D44 admitted effect deadline elapsed");
	return remaining;
}

async function runProcess(input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly timeoutMs: number;
}): Promise<Readonly<{ code: number; stdout: Uint8Array; stderr: Uint8Array; elapsedMs: number }>> {
	const started = performance.now();
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(input.command, [...input.args], {
			cwd: input.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let total = 0;
		let settled = false;
		let timer: NodeJS.Timeout;
		const finish = (error?: Error, code = 1) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error !== undefined) rejectPromise(error);
			else
				resolvePromise(
					Object.freeze({
						code,
						stdout: new Uint8Array(Buffer.concat(stdout)),
						stderr: new Uint8Array(Buffer.concat(stderr)),
						elapsedMs: Math.ceil(performance.now() - started),
					}),
				);
		};
		const collect = (target: Buffer[], chunk: Buffer) => {
			total += chunk.byteLength;
			if (total > MAX_PROCESS_BYTES) {
				child.kill("SIGKILL");
				finish(new TypeError("D44 subprocess output exceeded its bound"));
				return;
			}
			target.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
		child.once("error", (error) => finish(error));
		child.once("close", (code) => finish(undefined, code ?? 1));
		timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(
				new TypeError(
					`D44 subprocess exceeded its Graph reservation (${input.command}:${input.args.slice(0, 3).join(" ")})`,
				),
			);
		}, input.timeoutMs);
	});
}

async function assertWorkspaceFile(root: string, relativePath: string): Promise<string> {
	if (!D45_READABLE_PATHS.includes(relativePath as never))
		throw new TypeError("D44 workspace path escaped its Graph allowlist");
	const path = resolve(root, relativePath);
	if (!path.startsWith(`${resolve(root)}/`)) throw new TypeError("D44 workspace path escaped root");
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
		throw new TypeError("D44 workspace file identity drifted");
	return path;
}

async function workspaceDigest(state: WorkspaceState): Promise<string> {
	const target = await assertWorkspaceFile(state.root, D45_WRITABLE_PATH);
	const source = await readFile(target);
	const diff = await runProcess({
		command: "/usr/bin/git",
		args: ["diff", "--binary", "--", D45_WRITABLE_PATH],
		cwd: state.root,
		timeoutMs: 30_000,
	});
	if (diff.code !== 0) throw new TypeError("D44 workspace diff digest failed");
	return empiricalStrictJsonDigest({
		arm: state.arm,
		sourceDigest: empiricalSha256(source),
		diffDigest: empiricalSha256(diff.stdout),
	});
}

async function materializeWorkspace(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly baselineCommit: string;
	readonly arm: D45AdmittedEffectV1["arm"];
}): Promise<WorkspaceState> {
	await mkdir(input.materializationRoot, { recursive: true, mode: 0o700 });
	const root = join(input.materializationRoot, input.arm);
	const add = await runProcess({
		command: "/usr/bin/git",
		args: ["worktree", "add", "--detach", root, input.baselineCommit],
		cwd: input.repositoryRoot,
		timeoutMs: 60_000,
	});
	if (add.code !== 0) throw new TypeError("D44 worktree materialization failed");
	try {
		const target = await assertWorkspaceFile(root, D45_WRITABLE_PATH);
		const fixed = await readFile(target, "utf8");
		const first = fixed.indexOf(D44_FIXED_ADMISSION_BLOCK);
		if (first < 0 || fixed.indexOf(D44_FIXED_ADMISSION_BLOCK, first + 1) >= 0)
			throw new TypeError("D44 frozen task fixture drifted");
		await writeFile(
			target,
			`${fixed.slice(0, first)}${D44_BUGGY_ADMISSION_BLOCK}${fixed.slice(first + D44_FIXED_ADMISSION_BLOCK.length)}`,
			"utf8",
		);
		for (const relative of ["node_modules", "packages/ts/node_modules"] as const) {
			const link = join(root, relative);
			await mkdir(dirname(link), { recursive: true });
			try {
				await symlink(join(input.repositoryRoot, relative), link, "dir");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
		const stage = await runProcess({
			command: "/usr/bin/git",
			args: ["add", "--", D45_WRITABLE_PATH],
			cwd: root,
			timeoutMs: 30_000,
		});
		if (stage.code !== 0) throw new TypeError("D44 fixture staging failed");
		const commit = await runProcess({
			command: "/usr/bin/git",
			args: [
				"-c",
				"user.name=GraphReFly Eval",
				"-c",
				"user.email=eval@invalid.local",
				"-c",
				"core.hooksPath=/dev/null",
				"commit",
				"--no-gpg-sign",
				"--no-verify",
				"-m",
				`D44 frozen ${input.arm} task fixture`,
			],
			cwd: root,
			timeoutMs: 30_000,
		});
		if (commit.code !== 0) throw new TypeError("D44 fixture commit failed");
		const state: WorkspaceState = { root, arm: input.arm, digest: "", cleaned: false };
		state.digest = await workspaceDigest(state);
		return state;
	} catch (error) {
		await runProcess({
			command: "/usr/bin/git",
			args: ["worktree", "remove", "--force", root],
			cwd: input.repositoryRoot,
			timeoutMs: 30_000,
		}).catch(() => undefined);
		throw error;
	}
}

function semanticCriteria(
	effect: D45AdmittedEffectV1,
	outcomes: readonly D61PublicSemanticObservationV1[],
) {
	if (outcomes.length !== D45_PUBLIC_SEMANTIC_SCENARIOS.length)
		throw new TypeError("D61 public semantic observation cardinality drifted");
	return Object.freeze({
		scenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
		observations: Object.freeze(
			D45_PUBLIC_SEMANTIC_SCENARIOS.map((scenario, index) =>
				Object.freeze({
					causeCode: outcomes[index]!.causeCode,
					criterion: scenario.criterion,
					scenarioRef: scenario.scenarioRef,
					scenarioDigest: scenario.scenarioDigest,
					observationDigest: empiricalStrictJsonDigest({
						requestDigest: effect.sourceD43RequestDigest,
						scenarioDigest: scenario.scenarioDigest,
						passed: outcomes[index]!.passed,
						causeCode: outcomes[index]!.causeCode,
					}),
					freshnessDigest: empiricalStrictJsonDigest({
						requestDigest: effect.sourceD43RequestDigest,
						sequence: effect.sourceD43Sequence,
					}),
					passed: outcomes[index]!.passed,
				}),
			),
		),
	});
}

export function createD44LiveExecutor(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly baselineCommit: string;
	readonly bearerToken: string;
	readonly fetchImpl: typeof fetch;
	readonly executePublicSemanticScenarios?: typeof executeD61PublicSemanticScenarios;
	readonly executeWithheldSemanticScenario?: typeof executeD63WithheldSemanticScenario;
	readonly authorityAccess?: Readonly<{
		readonly lowerProviderEffect: (
			authority: object,
			effect: D45AdmittedEffectV1,
		) => ReturnType<typeof lowerD45ProviderEffect>;
		readonly readToolArguments: (
			authority: object,
			effect: D45AdmittedEffectV1,
		) => ReturnType<typeof readD45ToolArguments>;
	}>;
}): D44LiveExecutorV1 {
	const repositoryRoot = resolve(input.repositoryRoot);
	const materializationRoot = resolve(input.materializationRoot);
	const states = new Map<D45AdmittedEffectV1["arm"], WorkspaceState>();
	const lowerProviderEffect =
		input.authorityAccess?.lowerProviderEffect ??
		((authority: object, effect: D45AdmittedEffectV1) =>
			lowerD45ProviderEffect(authority as D45GraphToolAuthorityV1, effect));
	const readToolArguments =
		input.authorityAccess?.readToolArguments ??
		((authority: object, effect: D45AdmittedEffectV1) =>
			readD45ToolArguments(authority as D45GraphToolAuthorityV1, effect));
	let active = false;
	let disposed = false;
	const stateFor = (effect: D45AdmittedEffectV1) => {
		const state = states.get(effect.arm);
		if (state === undefined || state.cleaned) throw new TypeError("D44 workspace is unavailable");
		if (effect.workspaceStateDigest !== state.digest)
			throw new TypeError("D44 workspace drifted before admitted effect");
		return state;
	};
	const executor: D44LiveExecutorV1 = {
		revision: D44_D45_LIVE_REVISION,
		async execute(
			authority: object,
			effect: D45AdmittedEffectV1,
		): Promise<{
			readonly result: D45EffectResultInputV1;
			readonly retryDelayMs: number;
		}> {
			if (disposed || active) throw new TypeError("D44 executor overlap or disposal violation");
			active = true;
			const started = performance.now();
			try {
				if (effect.effectKind === "provider-proposal") {
					if (effect.providerRef !== D44_PROVIDER_TAG)
						throw new TypeError("D44 provider tag drifted before dispatch");
					const wire = lowerProviderEffect(authority, effect);
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), effect.elapsedReservationMs);
					try {
						let response: Response;
						try {
							response = await input.fetchImpl(D44_OPENROUTER_ENDPOINT, {
								method: "POST",
								redirect: "error",
								cache: "no-store",
								credentials: "omit",
								referrerPolicy: "no-referrer",
								headers: {
									accept: "application/json",
									"content-type": "application/json",
									authorization: `Bearer ${input.bearerToken}`,
									"cache-control": "no-cache, no-store, max-age=0",
									pragma: "no-cache",
								},
								body: wire.body,
								signal: controller.signal,
							});
						} catch (error) {
							return {
								result: classifyD45ChatTransportFailure({
									error,
									elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
									wireDigest: wire.wireDigest,
								}),
								retryDelayMs: 5_000,
							};
						}
						const declared = response.headers.get("content-length");
						if (
							declared !== null &&
							(!/^\d+$/u.test(declared) ||
								!Number.isSafeInteger(Number(declared)) ||
								Number(declared) > 2 * 1_048_576)
						)
							throw new TypeError("D44 provider response exceeded its declared bound");
						let bytes: Uint8Array;
						try {
							bytes = new Uint8Array(await response.arrayBuffer());
						} catch (error) {
							return {
								result: classifyD45ChatTransportFailure({
									error,
									elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
									wireDigest: wire.wireDigest,
								}),
								retryDelayMs: 0,
							};
						}
						if (bytes.byteLength > 2 * 1_048_576)
							throw new TypeError("D44 provider response exceeded its actual byte bound");
						const result = parseD45ChatProviderResponse({
							responseContractRevision: effect.responseContractRevision,
							status: response.status,
							bytes,
							elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
							wireDigest: wire.wireDigest,
							pricing: {
								inputMicrousdPerMillionTokens: 80_000,
								outputMicrousdPerMillionTokens: 180_000,
								cacheReadMicrousdPerMillionTokens: 16_000,
							},
						});
						const retryAfter = response.headers.get("retry-after");
						const retryAfterMs =
							retryAfter !== null && /^\d+$/u.test(retryAfter)
								? Math.min(120_000, Number(retryAfter) * 1_000)
								: 0;
						return {
							result,
							retryDelayMs:
								result.retryClass === "D710"
									? Math.max(60_000, retryAfterMs)
									: result.retryClass === "D671"
										? Math.max(5_000, retryAfterMs)
										: 0,
						};
					} catch {
						return {
							result: classifyD45ChatExecutorFailure({
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								wireDigest: wire.wireDigest,
							}),
							retryDelayMs: 0,
						};
					} finally {
						clearTimeout(timer);
					}
				}
				if (effect.sourceD43EffectKind === "materialization") {
					if (states.has(effect.arm)) throw new TypeError("D44 materialization replayed");
					const state = await materializeWorkspace({
						repositoryRoot,
						materializationRoot,
						baselineCommit: input.baselineCommit,
						arm: effect.arm,
					});
					states.set(effect.arm, state);
					return {
						result: {
							effectKind: "local-effect",
							outcome: "success",
							elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
							evidenceDigest: empiricalStrictJsonDigest({
								request: effect.requestDigest,
								workspace: state.digest,
							}),
							workspaceStateDigest: state.digest,
							criteria: null,
						},
						retryDelayMs: 0,
					};
				}
				const state = stateFor(effect);
				if (effect.effectKind === "workspace-freshness") {
					const observed = await workspaceDigest(state);
					return {
						result: {
							effectKind: "workspace-freshness",
							elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
							evidenceDigest: empiricalStrictJsonDigest({
								request: effect.requestDigest,
								observed,
							}),
							observedWorkspaceStateDigest: observed,
						},
						retryDelayMs: 0,
					};
				}
				if (effect.effectKind === "tool-action") {
					const argumentsValue = readToolArguments(authority, effect);
					const before = await workspaceDigest(state);
					if (before !== state.digest)
						return {
							result: {
								effectKind: "tool-action",
								status: "failed",
								causeCode: "workspace-state-drift",
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									before,
								}),
								workspaceStateBeforeDigest: before,
								workspaceStateAfterDigest: before,
								content: null,
							},
							retryDelayMs: 0,
						};
					const path = await assertWorkspaceFile(state.root, argumentsValue.path);
					if (argumentsValue.toolRef === "read-file") {
						const content = await readFile(path, "utf8");
						return {
							result: {
								effectKind: "tool-action",
								status: "success",
								causeCode: null,
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									contentDigest: empiricalStrictJsonDigest(content),
								}),
								workspaceStateBeforeDigest: before,
								workspaceStateAfterDigest: before,
								content,
							},
							retryDelayMs: 0,
						};
					}
					const source = await readFile(path, "utf8");
					const first = source.indexOf(argumentsValue.oldText);
					const second =
						first < 0
							? -1
							: source.indexOf(argumentsValue.oldText, first + argumentsValue.oldText.length);
					let causeCode:
						| "replacement-not-found"
						| "replacement-not-unique"
						| "replacement-unchanged"
						| null = null;
					if (argumentsValue.oldText === argumentsValue.newText)
						causeCode = "replacement-unchanged";
					else if (first < 0) causeCode = "replacement-not-found";
					else if (second >= 0) causeCode = "replacement-not-unique";
					if (causeCode !== null)
						return {
							result: {
								effectKind: "tool-action",
								status: "failed",
								causeCode,
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									causeCode,
								}),
								workspaceStateBeforeDigest: before,
								workspaceStateAfterDigest: before,
								content: null,
							},
							retryDelayMs: 0,
						};
					await writeFile(
						path,
						`${source.slice(0, first)}${argumentsValue.newText}${source.slice(first + argumentsValue.oldText.length)}`,
						"utf8",
					);
					state.digest = await workspaceDigest(state);
					return {
						result: {
							effectKind: "tool-action",
							status: "success",
							causeCode: null,
							elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
							evidenceDigest: empiricalStrictJsonDigest({
								request: effect.requestDigest,
								before,
								after: state.digest,
							}),
							workspaceStateBeforeDigest: before,
							workspaceStateAfterDigest: state.digest,
							content: null,
						},
						retryDelayMs: 0,
					};
				}
				let outcome: "success" | "passed" | "failed" | "wrong-scope" = "success";
				let criteria: ReturnType<typeof semanticCriteria> | null = null;
				if (effect.sourceD43EffectKind === "workspace-diff") {
					const names = await runProcess({
						command: "/usr/bin/git",
						args: ["diff", "--name-only"],
						cwd: state.root,
						timeoutMs: effect.elapsedReservationMs,
					});
					const changed = new TextDecoder()
						.decode(names.stdout)
						.trim()
						.split(/\r?\n/u)
						.filter(Boolean);
					outcome =
						names.code === 0 && changed.length === 1 && changed[0] === D45_WRITABLE_PATH
							? "success"
							: "wrong-scope";
				} else if (effect.sourceD43EffectKind === "focused-validation") {
					const validation = await runProcess({
						command: join(repositoryRoot, "node_modules/.bin/tsc"),
						args: ["--noEmit", "-p", join(state.root, "packages/ts/tsconfig.tests.json")],
						cwd: state.root,
						timeoutMs: effect.elapsedReservationMs,
					});
					outcome = validation.code === 0 ? "passed" : "failed";
				} else if (effect.sourceD43EffectKind === "public-semantic-validation") {
					const names = await runProcess({
						command: "/usr/bin/git",
						args: ["diff", "--name-only"],
						cwd: state.root,
						timeoutMs: remainingElapsed(started, effect.elapsedReservationMs),
					});
					const changed = new TextDecoder()
						.decode(names.stdout)
						.trim()
						.split(/\r?\n/u)
						.filter(Boolean);
					try {
						const semantic = await (
							input.executePublicSemanticScenarios ?? executeD61PublicSemanticScenarios
						)({
							workspaceRoot: state.root,
							workspaceStateDigest: state.digest,
							writeScopePreserved:
								names.code === 0 && changed.length === 1 && changed[0] === D45_WRITABLE_PATH,
							timeoutMs: remainingElapsed(started, effect.elapsedReservationMs),
						});
						const namesAfter = await runProcess({
							command: "/usr/bin/git",
							args: ["diff", "--name-only"],
							cwd: state.root,
							timeoutMs: remainingElapsed(started, effect.elapsedReservationMs),
						});
						const changedAfter = new TextDecoder()
							.decode(namesAfter.stdout)
							.trim()
							.split(/\r?\n/u)
							.filter(Boolean);
						if (
							namesAfter.code !== 0 ||
							changedAfter.length !== 1 ||
							changedAfter[0] !== D45_WRITABLE_PATH ||
							changedAfter.join("\n") !== changed.join("\n")
						)
							throw new TypeError("D61 public semantic write scope drifted during execution");
						const passed = semantic.observations.every((observation) => observation.passed);
						outcome = passed ? "passed" : "failed";
						criteria = semanticCriteria(effect, semantic.observations);
						return {
							result: {
								effectKind: "local-effect",
								outcome,
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									admission: effect.admissionDigest,
									outcome,
									workspace: state.digest,
									sourceSnapshotDigest: semantic.sourceSnapshotDigest,
									criteriaDigest: empiricalStrictJsonDigest(criteria),
								}),
								workspaceStateDigest: state.digest,
								criteria,
								sourceSnapshotDigest: semantic.sourceSnapshotDigest,
							},
							retryDelayMs: 0,
						};
					} catch {
						return {
							result: {
								effectKind: "local-effect",
								outcome: "executor-failed",
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									admission: effect.admissionDigest,
									outcome: "executor-failed",
									workspace: state.digest,
									sourceSnapshotDigest: null,
									criteriaDigest: null,
								}),
								workspaceStateDigest: state.digest,
								criteria: null,
								sourceSnapshotDigest: null,
							},
							retryDelayMs: 0,
						};
					}
				} else if (effect.sourceD43EffectKind === "hidden-verifier") {
					try {
						const hidden = await (
							input.executeWithheldSemanticScenario ?? executeD63WithheldSemanticScenario
						)({
							workspaceRoot: state.root,
							workspaceStateDigest: state.digest,
							writeScopePreserved: true,
							timeoutMs: effect.elapsedReservationMs,
						});
						outcome = hidden.passed ? "passed" : "failed";
						return {
							result: {
								effectKind: "local-effect",
								outcome,
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									admission: effect.admissionDigest,
									outcome,
									workspace: state.digest,
									sourceSnapshotDigest: hidden.sourceSnapshotDigest,
									criteriaDigest: null,
								}),
								workspaceStateDigest: state.digest,
								criteria: null,
								sourceSnapshotDigest: hidden.sourceSnapshotDigest,
							},
							retryDelayMs: 0,
						};
					} catch {
						return {
							result: {
								effectKind: "local-effect",
								outcome: "executor-failed",
								elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
								evidenceDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									admission: effect.admissionDigest,
									outcome: "executor-failed",
									workspace: state.digest,
									sourceSnapshotDigest: null,
									criteriaDigest: null,
								}),
								workspaceStateDigest: state.digest,
								criteria: null,
								sourceSnapshotDigest: null,
							},
							retryDelayMs: 0,
						};
					}
				} else if (effect.sourceD43EffectKind === "cleanup") {
					const removed = await runProcess({
						command: "/usr/bin/git",
						args: ["worktree", "remove", "--force", state.root],
						cwd: repositoryRoot,
						timeoutMs: effect.elapsedReservationMs,
					});
					if (removed.code !== 0) throw new TypeError("D44 workspace cleanup failed");
					state.cleaned = true;
					states.delete(effect.arm);
				}
				return {
					result: {
						effectKind: "local-effect",
						outcome,
						elapsedMs: boundedElapsed(started, effect.elapsedReservationMs),
						evidenceDigest: empiricalStrictJsonDigest({
							request: effect.requestDigest,
							outcome,
							workspace: state.cleaned ? null : state.digest,
						}),
						workspaceStateDigest: state.cleaned ? null : state.digest,
						criteria,
					},
					retryDelayMs: 0,
				};
			} finally {
				active = false;
			}
		},
		async dispose() {
			if (active) throw new TypeError("D44 cannot dispose an active effect");
			disposed = true;
			for (const state of states.values()) {
				await runProcess({
					command: "/usr/bin/git",
					args: ["worktree", "remove", "--force", state.root],
					cwd: repositoryRoot,
					timeoutMs: 30_000,
				}).catch(() => undefined);
			}
			states.clear();
			await rm(materializationRoot, { recursive: true, force: true });
		},
	};
	return Object.freeze(executor);
}

export async function runD44D45Measurement(input: {
	readonly executor: D44LiveExecutorV1;
	readonly injectedNoNetwork: boolean;
}): Promise<
	| Readonly<{ disposition: "success"; evidence: D45CanonicalEvidenceV1; providerCalls: number }>
	| Readonly<{
			disposition: "partial-failure";
			partialEvidence: ReturnType<typeof snapshotD45PartialCanonicalEvidence>;
			providerCalls: number;
	  }>
> {
	const profileInput = createExactModelHarnessProfileInput();
	const campaign = createD45QualificationCampaign();
	const authority = createD45GraphToolAuthority({
		profileInput,
		assignmentRef: D45_ASSIGNMENT.assignmentRef,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign,
	});
	let providerCalls = 0;
	let pendingRetry: Readonly<{ logicalRequestDigest: string; delayMs: number }> | null = null;
	try {
		for (;;) {
			const effect = takeD45AdmittedEffect(authority);
			if (effect === null) break;
			if (effect.effectKind === "provider-proposal") {
				if (pendingRetry !== null) {
					if (effect.logicalRequestDigest !== pendingRetry.logicalRequestDigest)
						throw new TypeError("D44 Graph retry identity drifted");
					if (!input.injectedNoNetwork && pendingRetry.delayMs > 0)
						await new Promise((resolvePromise) =>
							setTimeout(resolvePromise, pendingRetry!.delayMs),
						);
					pendingRetry = null;
				}
				providerCalls += 1;
			}
			const executed = await input.executor.execute(authority, effect);
			admitD45EffectResult(authority, effect, executed.result);
			if (
				effect.effectKind === "provider-proposal" &&
				executed.result.effectKind === "provider-proposal" &&
				executed.result.retryClass !== null
			)
				pendingRetry = Object.freeze({
					logicalRequestDigest: effect.logicalRequestDigest,
					delayMs: executed.retryDelayMs,
				});
		}
		const evidence = validateD45CanonicalEvidence(snapshotD45CanonicalEvidence(authority));
		return Object.freeze({ disposition: "success", evidence, providerCalls });
	} catch (error) {
		if (input.injectedNoNetwork) throw error;
		const partialEvidence = validateD45PartialCanonicalEvidence(
			snapshotD45PartialCanonicalEvidence(authority),
		);
		return Object.freeze({ disposition: "partial-failure", partialEvidence, providerCalls });
	} finally {
		await input.executor.dispose();
	}
}

export function d44LiveCompositionDigest(input: {
	readonly d45Commit: string;
	readonly d45QualificationArtifactDigest: string;
	readonly d45ImplementationManifestDigest: string;
}): string {
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D44_D45_LIVE_REVISION,
			...input,
			endpoint: D44_OPENROUTER_ENDPOINT,
			providerTag: D44_PROVIDER_TAG,
			providerDeadlineMs: D44_PROVIDER_DEADLINE_MS,
			serial: true,
			maxActiveEffects: 1,
			fallbackAllowed: false,
			parallelOrBackgroundAllowed: false,
			automaticRerunAllowed: false,
		}),
	);
}
