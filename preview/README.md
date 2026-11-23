# preview · Spine 示例预览

默认播放本地官方 Spineboy 示例，侧栏可切换 Raptor、Stretchyman、动画、CPU/WebGL2 后端和速度。
这些官方资产受 Spine Runtimes License 约束，只从本地 `test/fixtures/spine/` 读取，不提交仓库。
`?sample=core2d` 保留原有程序化人形场景，图集由 `preview/procedural-atlas.ts` 生成。

## 运行

`preview` 是独立的 pnpm workspace package，包含自己的打包器、TypeScript 配置和 Node HTTP 服务。

```sh
pnpm install
pnpm fetch:spine-samples # 首次使用或本地没有官方示例时
pnpm --dir preview run build
pnpm --dir preview run serve
# 浏览器打开 http://127.0.0.1:5173/
```

独立姿态编辑页：`http://127.0.0.1:5173/pose.html`。它使用 Spineboy 原始侧面贴图调整骨骼，提供近似正面与原始姿态、13 个旋转滑杆；由于缺少正面头脸/躯干素材，不是真正的正面视图。

## URL 参数

- `?sample=spineboy|raptor|stretchyman|core2d`：默认 `spineboy`；前三项从本地官方 JSON、atlas、PNG 载入，`core2d` 是旧人形演示。
- `?mode=cpu|webgl`：渲染后端，默认 `cpu`。CPU 用 `CpuBackend.readPixels` + `ImageData`；WebGL2 需要浏览器支持 WebGL2。
- `?pose=tpose|walk|raise`：仅 Core2D 场景使用，默认 `tpose`。
- `?speed=1.0`：仅 Core2D 场景使用，`walk` 播放速度。Spine 示例速度由侧栏滑杆控制。
- `?texture=1|0`：默认 `1` 采样程序化图集；`0` 退回 flat 顶点色块。
- `?mask=0|1`：默认 `0`；`1` 时为左臂（upperArmL/lowerArmL/handL）挂 stencil mask，其余 packet `maskPath=-1`。

侧栏滑杆（右上臂、右前臂、左上臂、右大腿、左大腿）是叠加旋转增量；reset 清零并复位动画时间。
失败时舞台左上角会显示红色错误条。

## 离线校验

```sh
pnpm --dir preview run build
pnpm --dir preview exec esbuild render-check.ts --bundle --platform=node --format=esm --outfile=.tmp/render-check.mjs
node preview/.tmp/render-check.mjs
```

生成 `preview/golden/core2d-texture.bmp`（默认纹理帧）和 `preview/golden/core2d-mask.bmp`（左臂 mask 帧）。
脚本断言：非背景像素充足、纹理帧颜色种类 > 8 且多于 flat 对照、发生纹理采样、mask 后左臂像素与全图
非背景像素都减少。
