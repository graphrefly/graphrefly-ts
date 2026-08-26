const FORBIDDEN_EXACT_KEYS = new Set([
	"NODE_OPTIONS",
	"NODE_PATH",
	"NODE_INSPECT_RESUME_ON_START",
	"GRAPHREFLY_EVAL_PRIVATE_ROOT",
	"GRAPHREFLY_EVAL_CREDENTIAL_PATH",
	"GRAPHREFLY_EVAL_ZERO_BYOK_PATH",
]);

const SECRET_KEY_NAME = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/u;

export function createRootEvalPrecredentialEnvironment(environment) {
	const isolated = { ...environment };
	for (const key of Object.keys(isolated)) {
		if (FORBIDDEN_EXACT_KEYS.has(key) || SECRET_KEY_NAME.test(key)) delete isolated[key];
	}
	isolated.GRAPHREFLY_D125_ISOLATED_LIVE_CHILD = "1";
	return Object.freeze(isolated);
}
