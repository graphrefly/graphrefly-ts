# assembly-v1 approved addendum: actual request evidence

2026-09-09。用户对 preflight 的两项最小修订回复“批准”，同时批准继续原批次实现与离线验收。唯一 owner graphrefly-ts；work 保持 CAUSAL-PRESET-ASSEMBLY-TS。

本增补仅替换 assembly-v1 附录 B 第25行：`evidence` 的直接 deps 为 `evaluationSelections, materialStore, verificationFacts`。收到实际 retained 材料或 actual normal/no-publish 结果后，才能将 receipt requestDigest 与其比较；缺材料等待，域不匹配 stale，材料拒绝或 verifier 不可用 unavailable。精确关联的 pass/fail 可作为 included evidence，但 included 不授予 effect 权限。唯一 authority 保持 identity/lifecycle/evidence 责任，UI 退订不结算义务。

53/54 owned nodes、两 roots、五端口 view 和原 capabilities 不变。仅增加一条内部依赖边，不新增公共 API 或 protocol。原 assembly-v1 正文和 manifest 原样保留；这是其明确增补，不倒写历史收据。

同次批准允许既有 causal input lane 使用已有 `partial: true`，使合法安静的 outcome/proposal 输入能够 settle。该配置修复不改变 wave 规范、不发送占位业务事实。它及完整 consumer 成本须重新验收；此前隔离17测试不代替正式回归。

批准绑定的审阅材料：packages/ts/qualification/causal-occurrence/preset-assembly-preflight/README.md 及三个 proposed-*.patch。保留原实现和离线授权；不启动 provider/live/spend、真实 inbox 或下游。性能门槛及12/60/12矩阵、60分钟矩阵/soak上限不变。
