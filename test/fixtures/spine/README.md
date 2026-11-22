# Spine 官方样例资产

本目录不提交官方资产（体积/授权原因）。验收前运行：

```bash
node scripts/fetch-spine-samples.mjs
```

期望结构：

```text
spineboy/spineboy-pro.json|atlas|png
raptor/raptor-pro.json|atlas|png
stretchyman/stretchyman-pro.json|atlas|png
```

资产存在时 `test/acceptance/spine-samples.test.ts` 自动启用；不存在时整套跳过并在 CI 报告缺资产。

> 资产来自 [spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes)，使用其 License（需自备 Spine Editor License）。
> 本仓库不提交这些资产；下载后仅本地运行验收。
