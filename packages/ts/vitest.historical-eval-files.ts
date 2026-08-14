import { readdirSync } from "node:fs";

const HISTORICAL_EVAL_FIRST_DECISION = 691;
const HISTORICAL_EVAL_LAST_DECISION = 782;
const HISTORICAL_EVAL_TEST_PATTERN =
	/^solutions-agentic-memory-work-item-rerun-avoidance\.d(?<decision>\d+)-.*\.test\.ts$/;

export const historicalEvalTestFiles = Object.freeze(
	readdirSync(new URL("./src/__tests__", import.meta.url), { encoding: "utf8" })
		.flatMap((fileName) => {
			const match = HISTORICAL_EVAL_TEST_PATTERN.exec(fileName);
			if (match?.groups?.decision === undefined) return [];
			const decision = Number(match.groups.decision);
			if (
				!Number.isSafeInteger(decision) ||
				decision < HISTORICAL_EVAL_FIRST_DECISION ||
				decision > HISTORICAL_EVAL_LAST_DECISION
			)
				return [];
			return [`src/__tests__/${fileName}`];
		})
		.sort(),
);

if (historicalEvalTestFiles.length === 0)
	throw new TypeError("historical eval requalification files were not found");
