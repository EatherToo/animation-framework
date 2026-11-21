# preview · 渲染预览页

> **2026-11-21**：2D 渲染架构见 [ADR-000](../docs/adr/000-2D渲染架构重构.md)。页面默认平涂（R0），逐三角灰面只是 `renderMode()` 返回 `'flat'` / `'texture'` 诊断模式。

> 把引擎编译出的人形按当前渲染方式画在浏览器里：正交正面、逐三角灰度面、黑色描边，右侧一组关节滑块。
> 这里只描述这个演示页本身。遮挡、取景与构建的改造方案见 [技术方案.md](./技术方案.md)；引擎与人体改造方案见 [`../docs/`](../docs/人体写实化技术方案.md)。

## 1. 跑起来

一条命令重建全部产物：

```bash
pnpm --dir preview run build
```

它依次跑三步，也可以分开跑：

| 步 | 命令 | 作用 |
|---|---|---|
| 引擎 | `pnpm --dir preview run build:engine` | 构建 `packages/render-engine` |
| 纹理 | `pnpm --dir preview run textures` | 为每个三角形生成灰图到 `textures/` |
| 页面 | `pnpm --dir preview run bundle` | 把 `main.ts` 打成 `main.js` |

纹理这一步用 esbuild 从源码打包后再执行：`dist` 的入口是给打包器用的，Node 直接导入会解析不了无扩展名的目录导入。

再起一个静态服务器：

```bash
pnpm --dir preview run serve
# 打开 http://localhost:5173/index.html
```

两个顺序不能颠倒：

- 纹理按网格逐三角形生成，网格一变就必须重跑，否则页面端校验会报「清单 N 张，网格 M 个三角形」。
- 页面用 `fetch` 读 `textures/manifest.json` 和每张灰图，直接 `file://` 打开会被拦，必须走 http。

## 2. 文件

```text
preview/
├── index.html                 画布 + 右侧面板，加载 ./main.js
├── main.ts                    全部逻辑
├── raster.ts                  逐像素深度光栅化，不依赖 DOM
├── main.js                    main.ts 的 IIFE bundle，构建产物，不要手改
├── build.mjs                  打包 main.ts
├── build-textures.mjs         打包并执行纹理生成
├── generate-textures.mjs      为每个三角形生成一张灰图
├── textures/
│   ├── manifest.json          每件的三角形张数
│   └── packed.bin             每个三角形一个灰度字节，按部件顺序拼接
└── README.md
```

`textures/packed.bin` 是 10 个部件、14404 个灰度字节，与网格三角形一一对应；`manifest.json` 记每件的张数。

## 3. 渲染流程

每次 `draw()`：

1. `createHumanoid(1.8)` → `compileHumanoid` → `createPose`，偏移全零。
2. 按滑块写姿态，`evaluateFk` 求骨头矩阵，`skinMesh` 把 10 件网格搬到角色空间；两条手臂走 2D 轮廓生成器，直接由 fk 的肩、肘、腕重建。
3. `projectParts(90)` 正交投影：屏幕横轴取角色 `z`、竖轴取 `y`，深度取 `−x`。90° 即正视角色正面。
4. `fillProjected` / `textureProjected` / `strokeContours` 分别得到面、贴图坐标和轮廓。
5. `vertexDepths` 按 `z·cos − x·sin` 算每顶点深度；`raster.ts` 的逐像素深度测试决定谁可见，填充与描边共用一张缓冲。
6. 背面剔除用**原始索引**判朝向（投影后的索引已被翻成逆时针）。
7. 取景按当前姿态收框，但缩放不超过绑定姿态的比例。

背景 `#5c5c5c`，描边 `#141414`。滑块步进 1°，两侧按钮每次 ±5°，锁死的转轴不显示。

## 4. 纹理

- 每个三角形一个灰度字节。**R0 起页面默认 `renderMode()` 默认 `'2d'`，直接用部件 `fill` 平涂，不加载逐三角贴图**；`renderMode()` 返回 `'flat'` / `'texture'` 时才加载 `packed.bin` 渲成高对比三角块，用于诊断/契约校验。

2D 图集：`assets/character/base/*.png` + `build-atlas.py` 生成 `preview/atlas/base.png/json`；页面启动加载，失败回退程序化图集。`?atlas=multi` 使用 2 页示例；WebGL 最多绑定 4 页纹理，`packAtlasPages` 支持最多 4 页。手指有 28 个独立 rotation 滑块（`data-bone`/`data-axis` 可选）。2D 路径的 `paintPackets` 支持 `fillMode: 'triangle' | 'smooth'`；当前默认 `'triangle'`，每个三角形取一个固定色，最小渲染单元就是三角形；并通过 `edges: 'triangles'` 画出每个三角形的三条边（共享边去重）；躯干 24×5 网格、头 24×3 环，四肢也补齐了轮廓/边线。渲染默认走 WebGL2；`?mode=2d` 走 CPU，`?mode=volume&view=0..359` 走 360° 体积代理。
- 字节按部件顺序拼在一个文件里（`packed.bin`），**一次请求**取回；`manifest.json` 给出 `edge`（每块图片的边长，16）与每件的张数（躯干 1920、头 600、臂 78、手 3728、腿 1536、脚 600）。
- 启动时 `loadGrayTextures` 用 `count` 校验网格与字节总数，对不上就抛错并给出重建命令。
- 静态服务器在并发下偶尔会重置连接（实测 2010 个请求里 23 个），所以取资源带 4 次重试。
- 因此**网格的三角形张数一变，必须重跑 `pnpm --dir preview run textures`**。改 `AXIAL_STEPS`、`TUBE_SIDES`、`ARM_SECTIONS`、各段站点数、头手脚几何都会触发。

## 5. 已知限制

### 5.1 截图不能当比例依据

页面是弯曲姿态 + 自适应取景 + 正交投影，直接量截图的像素比例会得到错误结论。要核对人体比例，应在绑定姿态下量网格（见 `../docs/人体写实化技术方案.md` §1）。

### 5.2 遮挡与深度

填充与描边共用一张逐像素深度缓冲：描边按最近顶点的深度再向相机偏 `1e-4`，既压得住自己的面，也穿透不了更近的部件。剩下的边界情况是**深度相等**：两块几何恰好共面时，按部件 `order` 与三角形顺序决定，画面稳定但可能与真实前后关系不同。

### 5.3 取景

按当前姿态的包围盒收放，缩放上限是绑定姿态的比例：展开时缩小不裁切，收拢时也不会被放大。因此不同姿态之间的截图比例仍不可直接比较。

## 6. 待办

- [x] 逐像素深度，填充与描边共用（`raster.ts`）。
- [x] 背面剔除。
- [x] 取景跟随当前姿态。
- [x] 构建脚本与纹理不匹配的错误提示。
- [ ] 在真实浏览器里核对一次遮挡与取景（Node 冒烟只验证管线能跑通）。

## 7. 2D 手臂验收图

`render-poses.ts` 用与页面同一条投影/填充/描边/逐像素深度管线离线出图：

```bash
./node_modules/.bin/esbuild preview/render-poses.ts \
  --bundle --platform=node --format=esm --outfile=.tmp/render-poses.mjs
node .tmp/render-poses.mjs
```

输出在 `preview/poses/`：侧视抬臂 90° 直臂、侧视抬臂 90° + 弯肘 100°、正视侧摆 90° 直臂、正视侧摆 90° + 弯肘 100°，以及四张拼成的 `contact-sheet.png`。侧视两图验证矢状面的直带与 L 形；正视两图验证页面主视角的肩、肘、腕轮廓和遮挡。另有 `one-arm-side-raise90*.png` 单臂特写，用来先确认一条手臂正常。
