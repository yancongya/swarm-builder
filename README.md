# swarm-builder

把一个已经存在的页面，用一群小光标「重新搭建」一遍：读 DOM、生成蓝图、铺隔离画布，让 1–24 个光标拉框、打字、贴图、画辅助线、Option 拖拽复制，最后把真实页面交还给你。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

**它不克隆功能。** 按钮不会因此能点，表单不会因此能提交——这是一段进场动画，不是一个可用的副本。

- 零运行时依赖，全场只有一个 `requestAnimationFrame` 时钟
- 主产物 es 43.92 kB（gzip 13.38）/ iife 35.63 kB（gzip 12.10），样式由 JS 注入，单 script 可嵌入
- 不改宿主 DOM 结构，只在 `root` 里加一个 overlay，结束时精确还原
- 自带一个可嵌进任意页面的[创造者模式](#创造者模式)：一颗悬浮球入口，改完一键导出可粘贴配置

<details>
<summary>目录</summary>

- [它是什么](#它是什么)
- [安装](#安装)
- [快速开始](#快速开始)
- [四种引入方式](#四种引入方式)
- [创造者模式](#创造者模式)
- [API](#api)
- [节奏与性能](#节奏与性能)
- [框架集成](#框架集成)
- [已知限制](#已知限制)
- [来源与差异](#来源与差异)
- [开发与验收](#开发与验收)
- [许可](#许可)

</details>

## 它是什么

进场动画常见的做法是写死一套 keyframes，页面一改就失效。swarm-builder 反过来：**以你当前的 DOM 为唯一素材**，现场量出每个盒子和每段文字的位置、样式、重复关系，再编排一群光标把它们「施工」出来。所以同一份代码落在落地页、控制台、深色工具界面上都能跑，不需要为每个页面调动画。

代价是它只负责「看起来被搭出来」：快照定格在 `start()` 那一瞬间，期间的交互、路由、数据更新都不参与。

```js
import { mount } from 'swarm-builder';

mount({ root: document.querySelector('#app'), agentCount: 8, targetDuration: 6 });
```

## 安装

```bash
npm i swarm-builder
```

> [!NOTE]
> 仓库当前处于发布准备完成、尚未上架 npm 的状态。本地消费用 `npm i ./swarm-builder-0.1.0.tgz`（`npm pack` 产出），或直接从 [GitHub](https://github.com/yancongya/swarm-builder) 引源码；上架流程见[开发与验收](#开发与验收)。

不想打包就直接引 IIFE。**全局是命名空间对象，不是类本身**：

```html
<script src="https://unpkg.com/swarm-builder/dist/swarm-builder.iife.js"></script>
<script>
  const { SwarmBuilder } = window.SwarmBuilder;   // 解构出来才是类
  new SwarmBuilder({ root: document.querySelector('#app') }).start();
</script>
```

## 快速开始

**整页进场，六秒搭完。** `targetDuration` 会让估算器反推速度倍率，比手调 `speed` 可靠：

```js
import { SwarmBuilder } from 'swarm-builder';

const swarm = new SwarmBuilder({
  root: document.body,
  agentCount: 8,
  targetDuration: 6,
  onComplete: ({ built, dropped, durationMs }) => {
    console.log(`搭了 ${built} 项，丢弃 ${dropped}，用时 ${durationMs}ms`);
  },
});
swarm.start();
```

**只作用于一个容器，长页面让镜头跟着施工。** 坐标全部相对 `root` 计算，容器有没有边框、页面滚到哪都不影响对齐。默认的 `group` 会同时开工在整页各处，页面比视口高时看起来是「到处乱跳」——想要从头铺到尾，把顺序换成 `rows`：

```js
new SwarmBuilder({
  root: document.querySelector('#dashboard'),
  tour: true,          // 滚动跟随施工前沿，结束交还页首
  order: 'rows',       // 每个光标守一条横带，自上而下往下盖
  maxItems: 800,       // 长页面抬上限，超出的计入 dropped
}).start();
```

**自己掌控播放。** 暂停不欠时间，跳过直接交还真实页面：

```js
const swarm = new SwarmBuilder({ root: app, autoStart: false });
swarm.start();
btnPause.onclick = () => (swarm.isPaused ? swarm.resume() : swarm.pause());
btnSkip.onclick = () => swarm.skip();
window.addEventListener('pagehide', () => swarm.destroy());
```

## 四种引入方式

| 方式 | 写法 | 说明 |
| --- | --- | --- |
| ESM / TS | `import { SwarmBuilder } from 'swarm-builder'` | 走 `exports.import`，带完整声明文件 |
| CJS | `const { SwarmBuilder } = require('swarm-builder')` | 走 `exports.require` → `dist/swarm-builder.cjs` |
| script 标签 | `const { SwarmBuilder } = window.SwarmBuilder` | IIFE 全局是**命名空间**，`mount` 也在里面 |
| SSR / Node | `import` 安全 | 模块顶层不碰 `document`；构造实例才需要 DOM |

> [!CAUTION]
> 包标了 `sideEffects: false`，样式是在**构造实例时**注入的。裸 `import 'swarm-builder'` 而不使用任何导出会被 tree-shake 掉，连带样式一起消失——要么真的 `new` 一个实例，要么别这么引。

## 创造者模式

给「别人的网站」或自己的真实页面现场改参数：入口是一颗悬浮球，球面上是自绘的标记（石墨球体 + 铜色轨道与光标），轻点展开参数、按住就能挪位置；改完应用重跑，或一键复制成可粘贴的代码片段交给 agent。它是**独立子入口**，不进主包，生产构建不引它就一个字节都不加载。

```js
import { tune } from 'swarm-builder/tune';

const tuner = tune({
  root: '#app',             // 元素或选择器；默认 document.body
  initial: { agentCount: 6, targetDuration: 8 },
  position: 'bottom-right', // 四个角可选，躲开宿主自己的悬浮件
  open: true,               // 初始展开；默认收成一颗悬浮球
});

tuner.apply();                // 用当前面板值重跑一局
tuner.reset();                // 全部退回库默认值（不擅自重跑）
tuner.restore();              // 停掉施工，把页面原样交还——跑中途也能按
const code = tuner.snippet(); // 可粘贴代码，只列与默认值不同的项
tuner.open();                 // 展开；tuner.close() 收成悬浮球
console.log(tuner.status, tuner.phase, tuner.expanded); // 给宿主镜像成自己的状态栏
tuner.destroy();
```

无构建页面用一个 script 标签即可（产物自带引擎，不依赖主包）：

```html
<script src="https://unpkg.com/swarm-builder/dist/swarm-builder.tune.iife.js"></script>
<script>SwarmBuilderTune.tune({ root: '#app', open: true });</script>
```

面板把 18 个纯数据选项一行不落全铺开：光标数量、构建顺序、工时均衡、随机种子、速度、目标时长、条目上限、复制盖章、每组复制、辅助线、辅助线数、标题步进、光标避让、镜头跟随、音效、施工线色、性能模式、跳过选择器。默认尺寸是按 900px 高的宿主量出来的，18 行不用滚动就能看全；宿主太矮才交给滚动条，那时滚动条也是可见的——也可以按住表头把面板拖到别处，或拽右下角的把手把它拉大，位置和大小写在内联样式里，宿主页面的规则覆盖不动。收起以后剩下的那颗悬浮球同样能按住拖走，移动满 4px 才算拖，所以拖完松手不会顺手再展开一次；球拖到贴近屏幕边上时，展开的那一瞬间面板会按自己的真实尺寸把位置夹回视口里，底部的按钮永远点得到。

面板与引擎的对应关系是照着「一局」建立的：

- 状态行下面一条细进度条按 `built/total` 推进，跑完停在 100%；未触发时它是灰的。
- 改过的行标成铜色并带一个 `·`，下面一行写明「N 项待生效 · 点『应用并重跑』」；点过之后变成「已与正在跑的这一局一致」。
- 每一行、每一颗按钮、连同收起后的那颗球都有 hover 提示，提示气泡由面板自己画（原生 `title` 要等一秒、字号配色也不受控）：鼠标一停就出现，永远落在视口里，拖球的时候它会自己收起来，灰掉的行会把原因接在同一句话后面。
- 有依赖的行会自动灰掉并说清原因：设了目标时长，速度倍率归估算器管，滑块就禁用，提示里写着「把目标时长改回 0 才能手调速度」；关掉复制盖章，每组复制同样灰掉；构建顺序不是「随机」，随机种子那一行也一样。
- 暂停 / 跳过只在跑着的时候可点，结束或停掉后自动禁用；暂停按钮文字在「暂停 / 继续」之间切。
- 底部三颗按钮各管一段：复制配置（剪贴板不可用时改成选中文本）、重置（回库默认值，不重跑）、恢复原状（`destroy()` 当前这局并把页面原样交还，跑中途可用）。

导出的片段长这样：

```js
// 由 swarm-builder 创造者模式导出，只列出与默认值不同的选项。
import { SwarmBuilder } from 'swarm-builder';

const swarm = new SwarmBuilder({
  root: document.querySelector('#app'),
  agentCount: 12,
  targetDuration: 8,
});
swarm.start();
```

三个设计约束，都是踩出来的：

- **面板活在 shadow root 里、挂在 `root` 之外。** 宿主的裸选择器（`* { font-family: … }`、`button { … }`）渗不进来，面板也不会被快照当成待重建内容。
- **面板带 `data-sb-chrome` 标记。** `root` 默认是 `body` 时面板是 body 的子节点，隔离层靠这个标记跳过它，否则运行中面板会被一起遮掉。
- **除速度外，改动下一局才生效。** 蓝图在 `start()` 那一刻冻结；设了 `targetDuration` 时速度倍率归估算器管，面板的速度滑块不再实时介入。剪贴板不可用（非安全上下文）时片段会留在面板里并自动选中，按 Ctrl+C 即可。

## API

### 导出

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `SwarmBuilder` | `new (options?: SwarmBuilderOptions)` | 主类 |
| `mount` | `(options?) => SwarmBuilder` | 建实例并立即 `start()` |
| `tune` / `SwarmTuner` | 子入口 `swarm-builder/tune` | 创造者模式，见上 |
| 类型 | `SwarmBuilderOptions` `SwarmResult` `AgentInfo` `CursorShape` `PlainConfig` | 声明文件随包发布 |

### 选项（`SwarmBuilderOptions`）

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `root` | `HTMLElement` | `document.body` | 要重建的子树，坐标相对它计算 |
| `agentCount` | `number` | `6` | 光标数量，1–24 |
| `speed` | `number` | `1` | 全局时间倍率，0.25–8 |
| `targetDuration` | `number` | `0` | 目标秒数，0–120。>0 时取代 `speed`，由估算器反推倍率 |
| `order` | `'group' \| 'rows' \| 'cols' \| 'snake' \| 'depth' \| 'radial' \| 'random'` | `'group'` | 光标怎么认领活儿。`group` 一棵子树一个人（最快，画面铺满整页）；`rows` 一个光标一条横带，自上而下盖下来（配 `tour` 最自然）；`cols` 同样切带但横过来，一条竖带一个光标——页面没有真的沟（左右两栏之间那种空隙）时自动退回 `rows`，否则只是把同一行劈成两半；`snake` 也是横带，但带内按 x 走、奇数带反着走，扫完一条不必横穿整页回起点；`depth` 每个 DOM 深度内部再切带，外层骨架先亮起来、叶子后填；`radial` 按到蓝图中心的距离一圈圈由内向外；`random` 用 `seed` 洗牌 |
| `balance` | `boolean` | `false` | 把页面切成「等预估工时」的带，而不是「等件数」的带。密集页上半页比下半页厚一倍时，默认切法会让一个光标多干一倍的活、另外五个停下来等它收尾；切分用的是最优连续划分（painters partition DP），所以开了只会更平，不会更差。它只改一条带切多长，不改朝哪个方向扫，和上面任意 `order` 叠加 |
| `seed` | `number` | `0` | 只在 `order: 'random'` 下参与排程。0 = 每局现抽一个新顺序；同一个数字 = 同一场施工可重放 |
| `performanceMode` | `'auto' \| 'high' \| 'low'` | `'auto'` | `auto` 在 `root` 内元素数 ≥250 时关辅助线、字号步进并把复制压到 6；`low` 永远裁剪；`high` 永远不裁。音效不在裁剪名单里：它按秒限量发声、不产生 DOM 节点，砍掉只会让人以为选项坏了 |
| `ignore` | `string \| string[]` | `[]` | 命中选择器的元素连同子树整块跳过 |
| `maxItems` | `number` | `400` | 蓝图条目上限，1–5000，超出计入 `dropped` |
| `duplicate` | `boolean` | `true` | 重复兄弟节点只真做一个，其余 Option 拖拽盖章 |
| `maxCopies` | `number` | `12` | 每组重复最多盖几个，1–48 |
| `guides` | `boolean` | `true` | 画出布局本来就存在的对齐辅助线 |
| `maxGuides` | `number` | `16` | 每次运行辅助线数量，0–64 |
| `grow` | `boolean` | `true` | 大标题一边打字一边长到真实字号 |
| `sound` | `boolean` | `false` | 合成音效，无音频文件。默认关：受自动播放配额限制，需页面已有用户手势 |
| `flocking` | `boolean` | `true` | 光标途中互相避让（只做 separation，不做对齐/聚合） |
| `tour` | `boolean` | `false` | 滚动跟随施工前沿，结束交还页首。默认关：滚动归宿主所有 |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | 施工线墨色。`auto` 按 backdrop → root → body → html 第一个不透明底色判断明暗 |
| `autoStart` | `boolean` | `false` | 下一帧自动开始，不用手动 `start()` |
| `onStart` | `(agents: AgentInfo[]) => void` | — | 本局所有光标的 `{ id, name, color }` |
| `onProgress` | `(built: number, total: number) => void` | — | 每建成一项回调一次 |
| `onComplete` | `(result: SwarmResult) => void` | — | `{ built, dropped, durationMs, seed }` |

`SwarmResult.seed` 是本局**实际**用的种子。传 0 表示「现抽一个」，抽到几只有这里知道——看到一场想重看的，把它填回 `seed` 就能按同一套认领顺序重放。

### 方法

| 方法 | 说明 |
| --- | --- |
| `start()` | 采集并开始；重复调用无效 |
| `pause()` / `resume()` | 冻结 / 继续同一个时钟，暂停期间不欠时间 |
| `isPaused` | 当前是否暂停 |
| `setSpeed(multiplier)` | 运行中改倍率，0.25–8 |
| `skip()` | 立刻结束：停表、全部记为建成、揭示真实页面 |
| `destroy()` | 拆 overlay、恢复宿主可见性、还原临时改写的 `root.position` |

### 它往页面里加了什么

一个 `<style id="swarm-builder-style">`（构造时注入，幂等）和 `root` 内的一个 `.sb-overlay`；运行中还有 `.sb-item` / `.sb-text` / `.sb-cursor` / `.sb-guide`，`fixed` 源元素进独立的 `.sb-fixed` 视口层。被遮的宿主子元素带 `.sb-hidden`，结束或 `destroy()` 时全部摘除。带 `data-sb-chrome` 的宿主子元素既不被遮也不参与重建——留给宿主的常驻悬浮件。

## 节奏与性能

`src/core/estimate.ts` 走一遍调度器真正要发的队列，把每个动作（移动、拉框、打字、淡入、盖章、辅助线、吸附）的价格累加到最长那条队列上，再乘一个在三个测试页上拟合的标定系数 1.45。实测落点：

| 目标时长 | 实测 |
| --- | --- |
| 自然（speed 1） | 8.7s |
| `targetDuration: 3` | 3.2s（+7%） |
| `targetDuration: 10` | 8.8s（-12%） |

估算按条目线性计价，而真实成本在整页规模上是超线性的（每多一个幽灵盒子，其余盒子的重排都更贵）。把 `maxItems` 从默认 400 抬到 2000、吃下密集控制台整页 440 项之后，自然节奏 53.1s、`targetDuration: 10` 实测 19.9s——定速仍然把节奏砍掉一半以上，但落点会从目标值偏出去。验收里 400 项那一档按 ±35% 卡死，整页那一档只卡「必须显著快于自然速度」，偏差如实报出来。

页面很大时先考虑 `performanceMode`，再考虑 `targetDuration`：拥挤页面真正会崩的不是帧率（注入到 414 项时 rAF 仍是 16.67ms/帧、0 个长帧），而是四十秒的时长和满屏辅助线噪声。真实规模参照 `demos/console.html`：415 个可重建项、页高 2018px、68 次复制、10 个 `fixed` 元素，自然速度约 28s；这种页面上建议同时开 `tour`。

## 框架集成

没有官方包装层（刻意不做），原生 API 已经够薄。两个容易踩的点：

**React.** 在 effect 里建、在清理里 `destroy()`。StrictMode 会双挂载，不清理就会叠两个 overlay：

```jsx
useEffect(() => {
  const swarm = new SwarmBuilder({ root: ref.current, targetDuration: 6 });
  swarm.start();
  return () => swarm.destroy();
}, []);
```

**Next / SSR.** 模块顶层不碰 DOM，`import` 在服务端安全；但实例只能在客户端建，组件加 `'use client'` 或放进 `useEffect` / `onMount`。

## 已知限制

- 非功能性副本：动画定格在采集那一瞬间，交互不存在
- `sticky` 没有专门处理；`position: fixed` 源元素进独立视口钉定层，但若其祖先带 `transform` / `filter`，该假设失效
- 伪元素、复杂媒体、Web Component 的 shadow DOM 降级成占位框；`aria-hidden="true"` 的整棵子树按装饰跳过
- 光标避让解决不了「两个光标同时收敛到同一坐标」，那是布局的结果
- 长页面受 `maxItems` 约束，超出计入 `dropped` 而不是重建
- 页面不可见时浏览器会节流 rAF，动画随之停摆——这是平台行为，不是库的 bug

## 来源与差异

效果基准是 [DhvanilPatel/swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors)（Chrome 扩展「Swarm Rebuild」），嵌入形态基准是 [ZhengLinLei/cursor-swarm.js](https://github.com/ZhengLinLei/cursor-swarm.js)，灵感站点 [califa/swarm-site](https://github.com/califa/swarm-site)。**本项目按公开可观察的行为重新实现，没有复制任何第三方源码**——原版没有明确 License，其 README 也要求复用前先与作者沟通，所以这里只学习思路与能力模型。

| | 原版扩展 | 轻量库 | 本库 |
| --- | --- | --- | --- |
| 形态 | Chrome 扩展，装才能用 | 可嵌入 JS 库 | npm + CDN，ESM/CJS/IIFE |
| 作用范围 | 整页 | 页面 | 任意 `root` 子树 |
| 效果完整度 | 完整（六类拆解、群聚、辅助线吸附、复制、音效编排） | 基础光标协作 | 对齐原版主路径 |
| 程序可控 | 扩展 UI | 可配置 | 配置 + 控制方法 + 回调 + 类型 |
| 许可 | 无明确授权 | 见上游 | MIT |

原版的长处是效果完整、编排细腻；短处是扩展形态进不了自己的网站、无授权导致源码不可复用、也没有供程序调用的配置与完成回调。轻量库的长处正是嵌入轻、可配置；短处是效果厚度不及原版清单。本库要做的是把两者接起来，并补上它们都没有的产品化部分：

- `targetDuration` 定速进场、`performanceMode` 自动降级、`theme` 深浅色自适应
- `tour` 镜头跟随、`fixed` 视口钉定层、重建中滚动的坐标修正
- `order` 七套认领算法（子树并行 / 横带 / 竖带 / 蛇形 / 逐层 / 由内向外 / 随机）+ `balance` 等工时切带 + `seed` 可复现的随机排程（原版与轻量库都是固定顺序，看第二遍和第一遍一模一样）
- `ignore` / `maxItems` + `dropped` 计数、`pause/resume/setSpeed/skip/destroy`
- 完整 TypeScript 声明、三格式产物、消费端冒烟门禁、可嵌入的创造者模式（悬浮球入口可拖拽、面板可缩放、每项都有 hover 提示）

没做的也记下来：滚动时动态增减光标（`maxAgents/minAgents`）、`typingSpeed/drawSpeed` 细分倍率——前者要重排已发队列、后者会让暂停/跳过/定速互相打架，收益抵不上复杂度，理由见交接文档 §6。

## 开发与验收

```bash
npm run dev              # http://localhost:5199/demos/index.html
npm run build            # 主包 es/cjs/iife + tune 子入口 + 声明文件
npm run typecheck        # tsc --noEmit
npm run verify           # Playwright 20 个验收场景，截图落在 .shots/
npm run verify:consumer  # 把 tarball 装进独立目录，按真实消费者入口各走一遍
npm publish --dry-run    # 发布预检：跑完整 prepublishOnly，只打包不上传
```

`demos/index.html` 是唯一的预览入口：一个铺满屏幕的 mockup 浏览器窗口，标签页切案例（简单页基准 / 密集控制台 / 深色落地页 / 复杂工作台 / 长页面跟随 / 别人的站点），地址栏、前进后退、重新载入和底部状态栏都按真的浏览器样子画。案例页本身没有工具栏，参数只在案例 iframe 内的创造者模式面板里改——iframe 不是偷懒：镜头跟随读的是 `window.scrollY / innerHeight`，换成内联滚动容器会让相机跟着错误的视口走。`tall.html` 专门做镜头跟随：实测页高 2767px、默认 `order: 'rows' + tour: true`，一眼能看出页面是一层层往下盖的。`tune.html` 假装成「别人家的站点」（满屏裸选择器 + 故意和面板撞名的类），专门用来验证面板隔离。`swarm-builder-plan.md` 是交接文档：能力分级、每批实测数据、踩过的坑都在里面。

`prepublishOnly` 串起 typecheck → build → verify → verify:consumer，任何一环红了都发不出去。消费端门禁会真的 `npm pack` + 安装，检查 ESM/CJS/两个 IIFE 全局形状、声明文件正例过反例拦、以及装完包之后页面里真跑一场。

发布目标由包自己的 `publishConfig.registry` 钉在 `registry.npmjs.org`，不受本地默认 registry（例如只读的 npmmirror 镜像）影响。门禁的嵌套 npm 命令会显式关掉 `npm_config_dry_run`——否则 `npm publish --dry-run` 传下来的这个变量会让它们只打印不写盘，`node_modules` 空掉、报错看起来像包坏了。

## 许可

[MIT](./LICENSE) © 2026 tycon