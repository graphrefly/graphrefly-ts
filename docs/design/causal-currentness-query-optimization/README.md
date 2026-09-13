# Currentness 内部精确 admission 查询复用

唯一 owner：graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS。用户要求判断是否需要设计，或直接修改验证优化。本批属于现有 D160 authority 内部等价计算优化；按 dev-dispatch / decision-guard / project-governance 执行，不新增架构 D# 或状态结构。

## 设计判断

Q5：保持 identity 职责、固定 transition 调用和原精确身份检查。Q6：本次同步 query 期间 admissions 不变；三个计算阶段没有用户回调/异步入口，maybeRelease 只修改 released 与输出缓冲。Q7：用一个调用内的数组保存 occurrence 和 exactAdmission 结果，三次检查减至一次；数组不跨波次、不注册、不持久化。Q8：原三次查询没有新分配但重复编码；调用内复用无需失效协议；跨波次缓存需要新增设计并检查所有更新/恢复路径。Q9：本次选择调用内复用；不改变 exactAdmission、sameRef、maybeRelease 或消息语义。无需重新让用户决定 authority 架构。

本轮先用既有 CPU 工具采样 P3 双 DATA 20 次动作，确认上轮优化后的 currentness/exactAdmission 剩余成本。采样 bundle 散列与本轮 before bundle 完全一致。该单次 inspector 采样仅用于选择目标，不用于性能验收。

## 验证范围

完整测试、73 runtime mutation、构建/export、类型和边界检查；独立只读 QA 检查同步期间的 mutation、提前查询的错误语义与输出顺序。未通过修改 D159 manifest 或其他验收规则消除既有失败。

复用上批诊断排程与计算方式，新的工具仅替换 baseline commit（586fa795）、目标文件（identity.ts）与允许改变的函数（recomputeCurrentness）。构建后 AST 断言仅该函数不同。固定 21 进程：P1/P3/P4 × 单/双 DATA × 三次；before/after 顺序交替；另有三次 before-before 控制。每臂业务预检、warmup 1、measured 3，比较两个版本完整 retained state，并检查重复动作不改变状态。每进程 120 秒/总 900 秒。独立 verifier 复算全部样本，不选样本、不作控制校正。

这不是 D168/D169 正式验收；当前方法资格未通过的状态不变。没有新公共 API 或配置，可组合性和渐进披露方向保持。跨波次入口编码复用尚未实现，也未宣称本批测出了内存收益。

代价是每次 query 增加 O(occurrences) 的临时数组和二字段记录；上限由已有 maxOccurrences 约束，函数返回后不保留。此次只验证动作耗时与行为，不把这个临时分配当作零成本，也不将其描述成内存优化。

## 结果

21 进程完整完成，42 次预检、126 个计时样本；独立 verifier 与 6 个重新索引的篡改负例通过。下表为每进程中位数再取三次中位数，非正式 p95。

| 场景 | 改前 ms | 改后 ms | 三轮 after/before |
|---|---:|---:|---|
| P1 / 1 DATA | 1.342 | 1.221 | 1.0312, 0.9543, 0.9078 |
| P1 / 2 DATA | 9.182 | 8.368 | 0.9121, 0.9303, 0.8957 |
| P3 / 1 DATA | 21.595 | 19.617 | 0.9021, 0.9379, 0.8598 |
| P3 / 2 DATA | 166.728 | 149.382 | 0.8810, 0.9217, 0.8902 |
| P4 / 1 DATA | 102.747 | 96.580 | 0.9424, 0.9334, 0.9400 |
| P4 / 2 DATA | 910.086 | 840.310 | 0.9233, 0.9440, 0.9105 |

相同版本双 DATA 控制比值：P1 0.9455、P3 0.9967、P4 0.9967。P3/P4 的三轮均下降；P1 单 DATA 有一轮 1.0312，不能声称所有小场景受益。保留此局部优化，但不将其提升为正式性能资格。

全量测试：2553 通过、2 项既有 D159 manifest 漂移失败、4 skipped；73 runtime mutation 全部 killed。build/export、package test:typecheck、no-raw-async 与改动范围 Biome 通过。全量 lint 未重复运行，上批已保留的归档/既有文件失败仍未解决。只读 QA 无阻断发现。所有原有未提交文件保留。

原始 CPU 采样、comparison 全部原始文件和检查日志保存在 archive/evals/causal-currentness-query-optimization-v1/evidence.tar.gz；解包后重新校验散列和复算。跨波次缓存/入口编码复用与正式整体性能验收仍未完成。
