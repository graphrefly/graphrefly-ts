import { join, resolve } from "node:path";
import { readRootEvalD145CharterLedger } from "./root-eval-charter-ledger.js";
import { readRootEvalD152Ledger } from "./root-eval-d152-ledger.js";
import {
	createRootEvalLiveExecutionGrant,
	persistRootEvalLiveExecutionGrant,
	ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
	ROOT_EVAL_LIVE_CAMPAIGN_SLOT,
	ROOT_EVAL_LIVE_GENERATION_REF,
} from "./root-eval-live-authority.js";
import { ROOT_EVAL_D159_HORIZON_SLOTS } from "./root-eval-task.js";
import { readRootEvalD159HorizonReceipt } from "./root-eval-task-manifest-store.js";

const [mode, executionRef, qualificationExecutionRef] = process.argv.slice(2);
const isD159Development = ROOT_EVAL_D159_HORIZON_SLOTS.includes(
	ROOT_EVAL_LIVE_CAMPAIGN_SLOT as (typeof ROOT_EVAL_D159_HORIZON_SLOTS)[number],
);
const isConfirmatory = ROOT_EVAL_LIVE_CAMPAIGN_SLOT === "confirmatory";
if (
	process.argv.length !== 5 ||
	mode !== "--prepare" ||
	(!isD159Development && !isConfirmatory) ||
	(isD159Development && ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE !== "development") ||
	(isConfirmatory && ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE !== "confirmatory") ||
	!/^root-eval-(development-[67]|confirmatory)-together-[a-z0-9-]{1,80}$/u.test(
		executionRef ?? "",
	) ||
	!/^provider-qualification-together-[a-z0-9-]{1,100}$/u.test(qualificationExecutionRef ?? "")
)
	throw new TypeError("root eval D159 execution grant preparation scope invalid");

await readRootEvalD159HorizonReceipt();
const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const historical = await readRootEvalD145CharterLedger(
	join(operatorRoot, "d145-charter-ledger.v4.json"),
);
const ledger = await readRootEvalD152Ledger({
	path: join(operatorRoot, "d152-charter-ledger.v1.json"),
	historicalLedger: historical,
});
if (isConfirmatory && (ledger.developmentQualificationStreak !== 2 || ledger.heldOutConsumed))
	throw new TypeError("root eval D159 confirmatory streak gate is closed");
const qualification = ledger.qualifications.find(
	(entry) => entry.executionRef === qualificationExecutionRef,
);
if (
	qualification?.status !== "settled" ||
	qualification.receipt?.stopReason !== "requests-complete"
)
	throw new TypeError(
		"root eval D159 execution grant requires a successful Together qualification",
	);
const grant = createRootEvalLiveExecutionGrant({
	executionRef: executionRef!,
	providerQualificationExecutionRef: qualificationExecutionRef!,
	providerQualificationGrantDigest: qualification.grantDigest,
});
await persistRootEvalLiveExecutionGrant(
	join(operatorRoot, "execution-grants", `${ROOT_EVAL_LIVE_GENERATION_REF}.json`),
	grant,
);
process.stdout.write(`${grant.grantDigest}\n`);
