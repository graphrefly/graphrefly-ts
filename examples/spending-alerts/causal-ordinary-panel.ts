/** Ordinary component: five business values, no construction or message protocol knowledge. */
import type { SpendingAlertsView } from "./causal-preset.js";
import { mountSpendingView, type SpendingViewObservation } from "./causal-view-binding.js";

export function ordinarySpendingPanel(view: SpendingAlertsView, show: (text: string) => void) {
	return mountSpendingView(view, (observation) => show(formatSpendingObservation(observation)));
}
export function formatSpendingObservation(observation: SpendingViewObservation): string {
	const { values, unavailable } = observation;
	return [
		"离线模拟 · 不执行真实 inbox I/O",
		`启动事实：${values.startup?.state ?? "尚无事实"}（不代表运行结束）`,
		`评估：${values.assessment ? (values.assessment.valid ? values.assessment.rows.map(({ value }) => `${value.evaluationRef}: ${value.flagged ? "触发告警条件（仍需证据与许可）" : "未触发告警条件（不等于验证已完成）"}`).join("; ") || "已有评估帧，暂无评估行" : "评估事实无效") : "尚无事实"}`,
		`发布：${values.publication ? values.publication.rows.map((row) => `${row.proposal.effectId}: ${row.recorded}`).join("; ") || "已有发布帧，暂无发布行（不代表验证成功）" : "尚无发布事实"}`,
		`证据覆盖：${values.coverage ? JSON.stringify(values.coverage) : "尚无事实"}`,
		`问题：${values.issues ? JSON.stringify(values.issues) : "尚无问题事实"}`,
		`尚无当前值：${unavailable.join(", ") || "无"}`,
	].join("\n");
}
