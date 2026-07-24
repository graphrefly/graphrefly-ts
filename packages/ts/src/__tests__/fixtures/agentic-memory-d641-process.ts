import { compoundTupleKey } from "../../identity.js";
import { nodeFileAgenticMemoryCommittedFactLogBackend } from "../../solutions/agentic-memory/node.js";
import {
	type AgenticMemoryRecord,
	agenticMemoryCommittedFactBatch,
	agenticMemoryCommittedFactLogAppendAttempt,
	agenticMemoryCommittedFactLogBackendAdapter,
	agenticMemoryCommittedFactLogStartupRead,
	agenticMemoryCommittedRecordMaterialFact,
} from "../../solutions/index.js";

const [mode, directory] = process.argv.slice(2);
if ((mode !== "write" && mode !== "read") || directory === undefined) {
	throw new TypeError("expected: agentic-memory-d641-process.ts <write|read> <directory>");
}

const log = agenticMemoryCommittedFactLogBackendAdapter(
	nodeFileAgenticMemoryCommittedFactLogBackend<string>(directory),
);

if (mode === "write") {
	const raw = record("record-d641-process-raw", "raw", "bounded raw evidence");
	const insight = record("record-d641-process-insight", "insight", "derived reusable insight");
	const append = await agenticMemoryCommittedFactLogAppendAttempt(
		log,
		agenticMemoryCommittedFactBatch([
			agenticMemoryCommittedRecordMaterialFact(raw, {
				operation: "create",
				correlationId: "d641-process-raw",
			}),
			agenticMemoryCommittedRecordMaterialFact(insight, {
				operation: "create",
				correlationId: "d641-process-insight",
			}),
		]),
	);
	process.stdout.write(
		JSON.stringify({
			status: append.commitResult.status,
			facts: append.commitResult.facts,
			cursor: append.commitResult.cursor,
		}),
	);
} else {
	const startup = await agenticMemoryCommittedFactLogStartupRead(log, { evaluation: 641 });
	process.stdout.write(
		JSON.stringify({
			artifactKinds: startup.records.map((item) => item.artifactKind),
			state: startup.bootstrapStatus.state,
			readyForCallerWiring: startup.bootstrapStatus.readyForCallerWiring,
			cursor: startup.bootstrapStatus.factLogCursor,
		}),
	);
}

function record(
	id: string,
	artifactKind: AgenticMemoryRecord<string>["artifactKind"],
	payload: string,
): AgenticMemoryRecord<string> {
	return {
		id,
		kind: "semantic",
		persistenceLevel: "project",
		artifactKind,
		scope: { sessionId: "session-d641-process", projectId: "project-d641-process" },
		fragment: {
			id: compoundTupleKey("fragment", [id]),
			payload,
			tNs: 10n,
			confidence: 0.8,
			tags: ["d641", artifactKind],
			sources: [],
		},
	};
}
