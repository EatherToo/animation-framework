# Chibi Stickers 关节实验室

使用本仓库 `packages/render-engine` 的 Spine 导入器、Engine 姿态/动画/蒙皮计算和 WebGL2Backend 渲染官方 Spine 4.2 Chibi Stickers。

在仓库根目录运行：

```sh
# 拆分后的素材已包含在项目中。需要重新下载并生成时运行前两步：
node packages/chibi-demo/fetch-assets.mjs
python3 packages/chibi-demo/split-assets.py
pnpm -C packages/render-engine build
node packages/chibi-demo/server.mjs
```

拆分脚本需要 Python 3 和 Pillow。打开 http://127.0.0.1:5179/ 。可用 `PORT=5180 node packages/chibi-demo/server.mjs` 修改端口。

- 三个独立 checkbox：骨架、蒙皮、网格。关闭蒙皮仍能单独查看骨架及三角网格。
- 9 套角色皮肤，默认 Spineboy；官方第 10 个 `default` skin 是共用表情附件，自动合并到各角色。
- 31 个表情/移动动作，可播放、暂停、选择参考姿态和重置。
- 右侧列出当前 skin 的活动骨骼，提供 ±180° 旋转偏移滑杆和数值输入。零长度控制骨也可旋转子骨骼。可搜索骨骼名称，或显示骨架后在画布点击选中。
- 编辑角度会暂停动画并保留该帧姿态。手动旋转直接作用于已求解姿态，便于编辑被 IK 控制的四肢；再次播放或重置会恢复官方动画约束。
- 预览区支持拖动平移、以鼠标位置为中心滚轮缩放，以及适应画布。

## 独立部件目录

```text
assets/
├── common/             # 42 张公共部件 PNG，以及共用 skeleton.json
├── erikari/            # 19 张角色部件 PNG
├── harri/              # 13 张
├── luke/               # 15 张
├── mario/              # 11 张
├── misaki/             # 15 张
├── nate/               # 12 张
├── sinisa/             # 11 张
├── soeren/             # 13 张
├── spineboy/           # 13 张
├── parts.json          # 部件路径、尺寸、打包位置、来源和 SHA-256
└── source/             # 官方原始图集、JSON、许可证及来源 manifest
```

每个部件都是独立的透明 PNG；原图集中旋转打包的部件已恢复正常方向，图片不缩放。左右肢体可能共用一张部件图片，但仍使用各自插槽的网格和骨骼权重。

[character.js](character.js) 按 [部件索引](assets/parts.json) 加载独立 PNG 和 [公共骨架数据](assets/common/skeleton.json)，在内存中临时打包为一张 GPU 纹理，并扩展边缘像素避免线性采样接缝。这兼容引擎最多 4 页图集的约束；运行时不再读取原始大图集。[main.js](main.js) 的后端适配器提供响应式视口及蒙皮显隐；骨架与网格叠加层使用 Engine 的世界变换和调试网格数据。

离线核验和回归测试：

```sh
python3 packages/chibi-demo/split-assets.py --check
python3 packages/chibi-demo/test_split_assets.py
```

核验会检查来源 SHA-256、每张拆分 PNG 的尺寸和像素、旋转还原、部件引用以及临时纹理布局。

素材版本、来源、SHA-256 与许可见 [README-assets.md](README-assets.md) 和 [来源 manifest](assets/source/manifest.json)。原始素材及拆分结果受 [Spine Runtimes License Agreement](assets/source/LICENSE) 约束。
