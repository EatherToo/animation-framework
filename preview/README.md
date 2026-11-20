# preview · 渲染预览页

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
│   └── <partId>/<序号>.png    16×16 单色灰图
└── README.md
```

`textures/` 下共 10 个部件、7968 张图，与网格的三角形一一对应。

## 3. 渲染流程

每次 `draw()`：

1. `createHumanoid(1.8)` → `compileHumanoid` → `createPose`，偏移全零。
2. 按滑块写姿态，`evaluateFk` 求骨头矩阵，`skinMesh` 把 10 件网格搬到角色空间。
3. `projectParts(90)` 正交投影：屏幕横轴取角色 `z`、竖轴取 `y`，深度取 `−x`。90° 即正视角色正面。
4. `fillProjected` / `textureProjected` / `strokeContours` 分别得到面、贴图坐标和轮廓。
5. `vertexDepths` 按 `z·cos − x·sin` 算每顶点深度；`raster.ts` 的逐像素深度测试决定谁可见，填充与描边共用一张缓冲。
6. 背面剔除用**原始索引**判朝向（投影后的索引已被翻成逆时针）。
7. 取景按当前姿态收框，但缩放不超过绑定姿态的比例。

背景 `#5c5c5c`，描边 `#141414`。滑块步进 1°，两侧按钮每次 ±5°，锁死的转轴不显示。

## 4. 纹理

- 每个三角形一张 16×16 纯灰图，相邻三角形灰度不同，所以画面呈现高对比的三角块。
- 列表在 `textures/manifest.json`：`edge` 是边长，`parts[].count` 是该件的三角形数（躯干 784、头 272、臂 736、手 1720、腿 736、脚 264）。
- 启动时 `loadGrayTextures` 会用 `count` 校验网格，对不上就抛错，整页不渲染。
- 因此**网格的三角形张数一变，必须重跑 `pnpm --dir preview run textures`**。改 `AXIAL_STEPS`、各段站点数、头手脚几何都会触发。

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
