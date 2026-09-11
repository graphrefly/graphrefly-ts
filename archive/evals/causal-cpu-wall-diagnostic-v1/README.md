# Causal CPU/wall diagnostic v1 archive

一次已批准的私有诊断：1 个 observer fixture、12 个固定 B/Q/T consumer、28,800 样本、24.5972 秒、零重试。采集和独立证据验证完成；插桩影响/归因 unresolved，D169 性能资格不变。

[人读结果与限制](../../../docs/design/causal-cpu-wall-diagnostic-v1-implementation/README.md) · [archive receipt](archive-receipt.json) · [完整文件 index](artifact-index.json) · [evidence.tar.gz](evidence.tar.gz)

压缩包内 `run/` 包含全部 266 个原始文件及源码/输入/批准/离线资格快照。顶层 index 为每个 tar 成员绑定 SHA-256；内部 `run/artifact-index.json` 绑定运行内容。原采集目录仅本地保留、由 `.gitignore` 排除；压缩包及 index 提交到仓库。

在一个新的临时目录解压后，只读取证据即可复验，不运行 consumer：

```sh
python3 -B run/source/scripts/verify-causal-cpu.py run
```

也可使用本仓库 `scripts/verify-causal-cpu.py` 对该 `run` 目录复验。原物理路径来自 reservation，仅用于核对 entry/config/argv 身份；重放不访问或执行这些路径。`status=complete-diagnostic` 只描述本次采集完成，不是性能通过或根因已查明。
