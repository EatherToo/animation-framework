# preview · Render Engine Core2D 预览

只使用 `@animation-framework/render-engine` 的新 API。`createHumanoid('simple2d')` 生成 18 骨人形；
每根骨按 world 矩阵构建一个 region packet，经 `viewProjection2D` 投影后由 CPU 或 WebGL2 后端绘制。

## 运行

```sh
pnpm --dir preview run build
python3 -m http.server 5173 --directory preview
# 浏览器打开 http://localhost:5173/
```

## URL 参数

- `?mode=cpu|webgl`：渲染后端，默认 `cpu`。CPU 用 `CpuBackend.readPixels` + `ImageData`；WebGL2 自编译 shader，颜色走 PMA 与 `ONE / ONE_MINUS_SRC_ALPHA`。
- `?pose=tpose|walk|raise`：姿态，默认 `tpose`。`walk` 用 `sampleAnimation` 驱动 rotate/translate 时间轴。
- `?speed=1.0`：`walk` 播放速度。

侧栏滑杆（右上臂、右前臂、左上臂、右大腿、左大腿）是叠加旋转增量；reset 清零并复位动画时间。
失败时舞台左上角会显示红色错误条。

## 离线校验

```sh
pnpm --dir preview run build
pnpm exec esbuild preview/render-check.ts --bundle --platform=node --format=esm --outfile=.tmp/render-check.mjs
node .tmp/render-check.mjs
```

生成 `preview/golden/core2d-frame.bmp`（24 位 BMP），并打印 packets 数、非背景像素数和人形包围盒。
