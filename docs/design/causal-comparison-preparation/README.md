# B121 comparison：TS 离线观察适配

本批仅增加试验适配器与证据，没有修改 library、公共 export 或协议。root 的方法与准备状态见 [准备报告](../../../../graphrefly/sessions/active/b121-comparison-design-v1/preparation/README.md)。

运行 `node scripts/capture-spending-comparison.mjs`：构建两个独立绑定的内存 bundle，执行六个 Graph/plain arms。base 捕获 C3 verification 输入未到达、C6 短写后的展示退订/重订阅；等价改写 bundle 在实际加载的 Graph/plain 数值源中应用相应代数改写，捕获 C2 writer-entry、调用注入 transport 前的状态。对源文件没有原地修改。

`capture-binding.json` 与 `equivalent-binding.json` 绑定全部 bundle 输入、实际替换文本及加载 digest、Node executable、launcher、生成 bundle 和存储 capture。Bundle 为临时构建，退出删除；源码/锁文件和 Node 可用于重建。现有 real-file archive 通过 source-catalog.json 的逐成员 hash 与投影相等校验复用，不重新运行。

C6 的复制器明确保留 Map/Set 内容，不能用 JSON 的空对象代替 authority 状态。结果为：一个 unknown effect 记录跨退订/重订阅保留，host normalEndReady=false。底层 causal quiescence 的 lifecycle/retainedEvidence 已为 true，**这不是整个宿主运行结束**。因此材料必须展示宿主的未知结果和结束边界，不能只展示局部 quiescence。

验证：六个直接内存 arms 通过；既有全量 TS 测试 2712 通过、4 skipped；build 通过。全仓 lint 失败（1343 errors，包含已有归档诊断材料格式问题），未修改这些无关文件。本批两份脚本和六份 JSON 的 scoped Biome 检查通过，spending-alerts 等现有示例 typecheck 通过。脚本依赖由 bundle 执行验证，示例 typecheck 不覆盖所有脚本。

原工作区状态见 baseline.json；最终提交只包含本目录和两份新增 scripts，其他已有修改保留。日志不是性能测量；没有新的物理 inbox 写入、参与者或 provider 调用。
