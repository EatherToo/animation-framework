# preview · Render Engine Core2D 预览

只使用 `@animation-framework/render-engine` 的新 API。`createHumanoid('simple2d')` 生成 18 骨人形；
每根骨按 world 矩阵构建一个 region packet，默认采样程序化图集纹理，经 `viewProjection2D` 投影后由
CPU 或 WebGL2 后端绘制。

图集由 `preview/procedural-atlas.ts` 生成：512×512 RGBA8 单页，4×4 个 128×128 区域，内含棋盘格、
斜条纹、渐变和部位色；`AtlasData` 的 uvMatrix 做半 texel 内缩，材质 `sprite id=1` 指向 page 0。

## 运行

```sh
pnpm --dir preview run build
python3 -m http.server 5173 --directory preview
# 浏览器打开 http://localhost:5173/
```

## URL 参数

- `?mode=cpu|webgl`：渲染后端，默认 `cpu`。CPU 用 `CpuBackend.readPixels` + `ImageData`；WebGL2 自编译 shader，图集纹理与顶点色都在 PMA 域调制，颜色走 `ONE / ONE_MINUS_SRC_ALPHA`。
- `?pose=tpose|walk|raise`：姿态，默认 `tpose`。`walk` 用 `sampleAnimation` 驱动 rotate/translate 时间轴。
- `?speed=1.0`：`walk` 播放速度。
- `?texture=1|0`：默认 `1` 采样程序化图集；`0` 退回 flat 顶点色块。
- `?mask=0|1`：默认 `0`；`1` 时为左臂（upperArmL/lowerArmL/handL）挂 stencil mask，其余 packet `maskPath=-1`。

侧栏滑杆（右上臂、右前臂、左上臂、右大腿、左大腿）是叠加旋转增量；reset 清零并复位动画时间。
失败时舞台左上角会显示红色错误条。

## 离线校验

```sh
pnpm --dir preview run build
pnpm exec esbuild preview/render-check.ts --bundle --platform=node --format=esm --outfile=.tmp/render-check.mjs
node .tmp/render-check.mjs
```

生成 `preview/golden/core2d-texture.bmp`（默认纹理帧）和 `preview/golden/core2d-mask.bmp`（左臂 mask 帧）。
脚本断言：非背景像素充足、纹理帧颜色种类 > 8 且多于 flat 对照、发生纹理采样、mask 后左臂像素与全图
非背景像素都减少。
