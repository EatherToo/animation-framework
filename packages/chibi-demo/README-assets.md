# Chibi Stickers 素材来源与拆分

素材来自 Esoteric Software 官方 [spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes)，分支 `4.2`，固定提交 [`5cb78e77d3711ddcd80c7bd043bb11cf70fcc88c`](https://github.com/EsotericSoftware/spine-runtimes/commit/5cb78e77d3711ddcd80c7bd043bb11cf70fcc88c)。后续下载固定使用该提交，不随分支更新。

官方素材目录：[examples/chibi-stickers/export](https://github.com/EsotericSoftware/spine-runtimes/tree/5cb78e77d3711ddcd80c7bd043bb11cf70fcc88c/examples/chibi-stickers/export)。

## 来源归档

原始文件保存在 [assets/source](assets/source/)：straight-alpha 图集定义、Spine JSON、10 张非 PMA 图集 PNG，以及同一提交的官方仓库根目录许可证。下载地址、字节数、SHA-256 和骨骼数据概况记录于 [来源 manifest](assets/source/manifest.json)。

[官方许可证](assets/source/LICENSE) 为 Spine Runtimes License Agreement，更新日期 2025-04-05。原始文件及拆分后的部件均保留原许可约束。

从仓库根目录重新下载和拆分：

```sh
node packages/chibi-demo/fetch-assets.mjs
python3 packages/chibi-demo/split-assets.py
```

[下载脚本](fetch-assets.mjs) 使用 Node.js 内置 API，无额外依赖。已有 manifest 时，脚本会核对下载内容与记录的 SHA-256；也会检查 PNG 签名、atlas 恰好引用全部 10 张纹理、未声明 PMA 和 JSON 的 Spine 4.2 版本。全部网络下载与校验完成后才写入来源归档。

## 独立部件

[拆分脚本](split-assets.py) 使用 Python 3 和 Pillow，生成 **164 张独立透明 PNG**：

| 目录 | PNG 数量 | 内容 |
| --- | ---: | --- |
| [common](assets/common/) | 42 | 眼睛、嘴形、泪滴、表情符号、阴影等共用部件 |
| [erikari](assets/erikari/) | 19 | 角色身体、头发、服装和装饰 |
| [harri](assets/harri/) | 13 | 角色部件 |
| [luke](assets/luke/) | 15 | 角色部件 |
| [mario](assets/mario/) | 11 | 角色部件 |
| [misaki](assets/misaki/) | 15 | 角色部件 |
| [nate](assets/nate/) | 12 | 角色部件 |
| [sinisa](assets/sinisa/) | 11 | 角色部件 |
| [soeren](assets/soeren/) | 13 | 角色部件 |
| [spineboy](assets/spineboy/) | 13 | 角色部件 |

部件按官方 region 路径命名，例如 `common/eye-heart.png` 和 `spineboy/arm.png`。原图集中有 48 个旋转打包的部件，输出时恢复正常方向；保留原始像素尺寸、透明通道，不缩放或有损压缩。

[公共骨架数据](assets/common/skeleton.json) 是官方 JSON 的原样副本，保留所有皮肤、插槽网格、骨骼权重、约束和动画。左右手脚共用纹理时，不重复生成同一图片；各插槽仍使用独立的网格和骨骼绑定。

[部件索引](assets/parts.json) 记录每张 PNG 的路径、尺寸、SHA-256、来源图集区域和虚拟打包位置。浏览器从这些独立文件加载，临时合成 GPU 纹理；来源归档不参与页面渲染。

核验生成结果和运行回归测试：

```sh
python3 packages/chibi-demo/split-assets.py --check
python3 packages/chibi-demo/test_split_assets.py
```

## 骨骼数据概况

- Spine 导出版本：`4.2.22`。
- Bones：44；slots：61。
- Skins：10 个，`default`、`erikari`、`harri`、`luke`、`mario`、`misaki`、`nate`、`sinisa`、`soeren`、`spineboy`。`default` 为公共表情附件，另外 9 个为角色皮肤。
- 动画：31 个，其中 `emotes/` 下 23 个表情，`movement/` 下 8 个移动/待机动画。
- IK 约束：2 个，左右腿各一，分别控制对应的上下腿骨骼。
- Transform 约束：1 个；无 path、physics 约束。

表情动画（均带 `emotes/` 前缀）：`angry`、`burp`、`confused`、`crying`、`dead`、`determined`、`dramatic-stare`、`excited`、`fawning`、`flushed`、`hooray`、`idea`、`just-right`、`laugh`、`love`、`scared`、`see-no-evil`、`shrug`、`sulk`、`sweat`、`thinking`、`tongue-out`、`wave`。

移动动画（均带 `movement/` 前缀）：`idle-back`、`idle-front`、`idle-left`、`idle-right`、`trot-back`、`trot-front`、`trot-left`、`trot-right`。
