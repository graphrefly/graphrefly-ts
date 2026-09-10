# Private spending preset — independent Graph/plain reference

2026-09-09；baseline `ca38254a`；唯一 owner `graphrefly-ts`；继续原 `CAUSAL-PRESET-ASSEMBLY-TS`，沿用既有实施、离线验收和 commit 授权。这里记录实现与 attempt/evidence，不新增架构决定，也不是执行 effect 的授权。

独立 Graph 对照和 plain 对照现在通过本批有限场景的语义验收。**完整 preset-v1 资格仍未完成，性能尚未测量。**

## 本批交付

Graph reference 独立实现输入校验、selection、统计、业务 fan-out/fan-in、material 保留、permission、evidence 和普通 view。它与候选共用已经存在的 Graph/C runtime，并使用既有独立 publication reference；不调用候选 consumer 的校验、计算、join、material 或 admission helper。实际 esbuild closure 检查确认 reference/plain 都不加载 `examples/spending-alerts/` 的实现。类型格式允许共享；独立性不意味着重新实现底层 Graph/C。

真实路径是 `pack/arrivals → selection → transaction/moments/profile → score → gate/reason/message → assessment/material → store/permission → C authority → publication`。普通模式 53 个 owned nodes、summary 模式 54 个，各有 6 个外部输入 source 和 2 个保留 root。完整节点与依赖表来自实际 `graph.describe()`，见归档中的 `freeze-qualified/*-topology.json`。没有为了拉大性能分母添加无用节点；输出只冻结新建容器，避免重复遍历已深度冻结的 prefix。

Plain 对照通过自己的有界状态区分：可继续计算的输入行、occurrence admission 与连续 watermark release、待释放 proposal、已承担 effect、pending terminal，以及 retained evidence。失效会撤销计算资格；不会擦掉已承担的义务或已有证据。仅新到的 inbox DATA 能提交 outcome，其他输入不能重播旧 inbox。三个 branch 共用 64 个 pending terminal 名额，冲突身份不能借证据或 pending terminal 恢复权威。

独立 evidence 包含 input、code binding、verification 的完整记录和 included/stale/unavailable 分类。测试逐步比较它们的实际字节以及 lifecycle/retainedEvidence。正常交易可以 `lifecycle=true`，同时因缺少 verification 保持 `retainedEvidence=false`；证据随后到齐不需要重新产生 effect。

私有 centered arithmetic 被拆成 `plainMoments → plainScore`，让 Graph 对照真正消费 moments DATA；数值规则仍是 D166。独立编码器仅增加可选 byte budget，默认保持 1 MiB，pack 明确使用已经锁定的 4 MiB。

## 有限验收与真实负对照

- 51 个新增测试通过。P1–P6 × off/summary 比较每个输入阶段的 assessment、effect proposal/admission/outcome、publication、coverage/conservation；plain 还比较 retained evidence 字节和两种 quiescence 标志。
- 覆盖严格阈值、两个 vendor、reverse arrival/late receipt、双 DATA replay、退订重连、错误 outcome、过期/不可用/失败验证、旧 current/watermark gap、撤销/过期/stop/not-ready、非法 frame 后恢复、合法 >1 MiB pack、domain 与 pending terminal 容量、冲突身份及 delayed conflict 清理。
- 五个实际节点删除依赖后不能获得 admission。删除唯一依赖时可能不再调用 fn；测试同时检查无错误放行，不能把无调度误写成 guard 已执行。
- 最终实际加载 mutation：7 个破坏版本全部被断言检出，baseline 通过，0 个 load-error kill。分别覆盖 reference stale join、1 MiB pack、错误 score、删除依赖 guard，以及 plain domain bound、缓存 outcome 重播、遗漏 evidence。原源码、加载标记、失败断言和完整 copied-input digest 保留在 `runtime-qualified/`。
- 既有 preset 98 与 publication 110 测试通过；重新执行 200 个固定种子数值 differential。它们是有限证据，不是穷举全部输入，也不是 performance samples。
- 最终默认离线套件：2514 pass / 2 fail / 4 skip。两项失败和 artifact gate 仍是已记录的 D159 frozen implementation-manifest drift；没有刷新旧 manifest 或旧授权掩盖它。lint 与 example/package typecheck 通过。
- 221-test root soak 的 181 个 source/config/fixture 绑定未变，复用旧证据，不声称重新运行。旧五项 prerequisite 的整体 61-file binding 有一个 oracle 文件变化，因此不把五项整体写成当前重新通过；publication 的 110 测试及 runtime mutation 单独重跑，详见 receipt。

静态 QA 修复了 pack 上限、失效行复活、重复冻结遍历、plain occurrence/release 混淆、domain/pending-terminal 容量、缓存 outcome 重播、证据职责缺失、冲突身份证据、非法 result 占用 domain 与 deferred terminal 冲突清理。冷装配也独立校验 binding、四组/六个输入、诊断模式和实际依赖。所有修复遵循已批准合同，没有引入新语义选择。

## 冻结与下一步

`freeze-qualified/` 保留四个实际 bundle、metafile/source closure、四份实际 topology、P1–P6 被动输入；`freeze.json` 绑定 65 个 source/config/contract 文件。最终加载测试与该冻结的相关源码均在验收后复查未变。早期调试日志和旧 intermediate mutation 输出也保留，不能替代最终绑定结果。

下一步是原设计附录 C 的正式 consumer 性能矩阵：12 cold / 60 steady / 12 recovery；AB/BA/AB、每批 100 warmup + 300 measured；cold ≤1.20、steady ≤1.10；新增输入使用预声明的有剩余 lifetime 容量实例段，setup 单独计账。它不是 CSP11，也不修改旧 C/publication runner。此次只冻结消费场景，**未建立或执行性能 runner，没有任何预算通过结论**。冷构造、首次 hash、steady、reconnect 的计时仍须按原方案分开。

剩余工作还包括 N1–N12 的最终审阅包与既有 D159 binding 问题。用户分层入口是否易懂、能否按需隐藏、B121 的人/agent 效果，均未由这些离线测试证明。公共 export、最终 qualified inbox/factory、真实 effect/provider/live/spend 均未改变或启动。

原始产物见 `evidence.tar.gz`，逐文件摘要见 `artifact-index.json`；状态与精确结果见 `receipt.json`。归档 bundle 仅供离线复现，不是发布包或 host 资格。
