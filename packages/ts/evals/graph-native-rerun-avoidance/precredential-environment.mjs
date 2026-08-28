const ALLOWED_EXACT_KEYS = Object.freeze([
	"PATH",
	"HOME",
	"TMPDIR",
	"TMP",
	"TEMP",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"COLORTERM",
	"FORCE_COLOR",
	"NO_COLOR",
]);

export function createRootEvalPrecredentialEnvironment(environment) {
	const isolated = {};
	for (const key of ALLOWED_EXACT_KEYS)
		if (typeof environment[key] === "string") isolated[key] = environment[key];
	const slot = environment.GRAPHREFLY_ROOT_EVAL_CAMPAIGN_SLOT;
	if (
		typeof slot === "string" &&
		(slot === "confirmatory" || /^development-[1-9][0-9]*$/u.test(slot))
	)
		isolated.GRAPHREFLY_ROOT_EVAL_CAMPAIGN_SLOT = slot;
	isolated.GRAPHREFLY_D145_ISOLATED_LIVE_CHILD = "1";
	return Object.freeze(isolated);
}
