# 示例 2D 图集资产

这是用于跑通真实图集链路的示例资产：布料/皮肤/牛仔/皮革纹理由 `preview/build-atlas.py` 程序化生成，不是最终美术。

## 结构

```text
assets/character/base/
├── torso.png / head.png / armL.png ...
├── atlas.json          # 页尺寸、padding/bleed、region
└── README.md
```

## 重新生成

```bash
/Users/Eather/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 preview/build-atlas.py
```

输出：

- `preview/atlas/base.png`
- `preview/atlas/base.json`
- `preview/atlas/multi-0.png` / `multi-1.png` / `multi.json`（2 页示例）

当前 10 个 region 为 256×512，放在 2048×2048 的 1 页内；`packAtlasPages` 支持最多 4 页。

## 替换真实美术

1. 用同名 PNG 替换 `assets/character/base/part.png`（RGBA、sRGB）；
2. 修改 `preview/build-atlas.py` 的 `PARTS` 尺寸/位置或直接替换 `preview/atlas/base.json`；
3. 保留 padding 4、bleed 2、region 内 1px 边距；
4. 重新生成并刷新页面；加载失败会回退程序化图集。
