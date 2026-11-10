# swarm-builder

**为你的网页开始创造模式，集群构建前端！**

把一个已经存在的页面，用一群小光标「重新搭建」一遍：读 DOM、生成蓝图、铺隔离画布，让 1–24 个光标拉框、打字、贴图、画辅助线、Option 拖拽复制，最后把真实页面交还给你。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

**它不克隆功能。** 按钮不会因此能点，表单不会因此能提交——这是一段进场动画，不是一个可用的副本。

- 零运行时依赖，全场只有一个 `requestAnimationFrame` 时钟
- 主产物 es 84.9 kB（gzip 26.2）/ iife 67.5 kB（gzip 23.7），样式由 JS 注入，单 script 可嵌入
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

三种拿包方式，产物相同。

**1. 克隆仓库（现在就能用）**

`dist/` 不提交到仓库，克隆后先构建一次：

```bash
git clone https://github.com/yancongya/swarm-builder.git
cd swarm-builder && npm install && npm run build
```

然后在你自己的项目里本地安装，或打成和正式发版一样的包：

```bash
npm i ../swarm-builder
# 或
npm pack && npm i ./swarm-builder-0.1.0.tgz
```

只想先看效果：`npm run dev` 会起案例页。

**2. npm（发版后）**

```bash
npm i swarm-builder
```

**3. CDN（随 npm 发版上线）**

```html
<script src="https://unpkg.com/swarm-builder/dist/swarm-builder.iife.js"></script>
<script>
  const { SwarmBuilder } = window.SwarmBuilder;   // 解构出来才是类
  new SwarmBuilder({ root: document.querySelector('#app') }).start();
</script>
```

> [!NOTE]
> 仓库当前处于发布准备完成、尚未上架 npm 的状态：`npm i swarm-builder` 与 CDN 地址都等发版；`npm i github:yancongya/swarm-builder` 也不可用——npm 从 git 安装不会自动构建，仓库里没有 `dist`。

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

**只作用于一个容器，长页面让镜头跟着施工。** 坐标全部相对 `root` 计算，容器有没有边框、页面滚到哪都不影响对齐。库的默认跑法就是参考扩展那一套：一条自上而下的前沿（`order: 'rows'` + `pick: 'live'` + `trigger: 'scroll'`），读者滚到哪儿就建到哪儿；想让它自己推着页面往下走，把 `tour` 打开：

```js
new SwarmBuilder({
  root: document.querySelector('#dashboard'),
  tour: true,          // 滚动跟随施工前沿，结束交还页首
}).start();
```

蓝图默认收 4000 项，超出的计入 `dropped`；比这更长的页面再抬 `maxItems`。

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
  initial: { targetDuration: 8 }, // 面板初始值；不写的项就是库默认（默认即参考扩展那一套）
  position: 'bottom-right', // 四个角可选，躲开宿主自己的悬浮件
  open: true,               // 初始展开；默认收成一颗悬浮球
  lang: 'en',               // 面板语言；不写就跟着 `<html lang>` 走，读不出就是中文
});

tuner.apply();                // 用当前面板值重跑一局
tuner.reset();                // 全部退回库默认值（不擅自重跑）
tuner.restore();              // 停掉施工，把页面原样交还——跑中途也能按
const code = tuner.snippet(); // 可粘贴代码，只列与默认值不同的项
await tuner.copy();           // 复制那份片段进剪贴板（不可用时改为选中）
tuner.open();                 // 展开；tuner.close() 收成悬浮球
console.log(tuner.status, tuner.phase, tuner.expanded); // 给宿主镜像成自己的状态栏
tuner.destroy();
```

无构建页面用一个 script 标签即可（产物自带引擎，不依赖主包）：

```html
<script src="https://unpkg.com/swarm-builder/dist/swarm-builder.tune.iife.js"></script>
<script>SwarmBuilderTune.tune({ root: '#app', open: true });</script>
```

面板按用途分成六页，一共 29 行参数：**规模**（光标数量、动态班组、条目上限、速度、目标时长、性能模式）、**顺序**（构建顺序、工时均衡、随机种子、认领方式、逐段解锁、开场聚群、积压提速）、**光标**（待时飞行、真实鼠标、光标避让、镜头跟随、键盘快捷键）、**采集**（采集方式、复制盖章、每组复制、辅助线、辅助线数、标题步进、跳过）、**声音**（音效、配乐）、**外观**（减少动效、施工线色）。一次只摊开一页，最长的一页七行；默认停在与扩展那条自上而下前沿直接相关的「规模」页。页签悬停里写着这一页的实时值（比如「停在落点 · 当圆心」「预滚动采集 · 复制 12/组」），不翻过去也知道另一头设成了什么；改过但还没应用的页签带一个铜点，翻到别页也不会漏掉。表头上方是扩展那块 HUD：阶段状态行、按 `built/total` 推进的进度条、以及最后五个忙碌光标的色点（颜色 + 首字母 + 悬停名字）。HUD 下面一条工具条改的是**正在跑的这一局**——镜头（Tour，灯亮时写「跟随中」）、1×→2×→3× 倍速、声音（声音 / 解锁 / 静音三态，浏览器还没放行时点它先解锁）、暂停/继续、跳过、重播；参数行则照旧下一局生效。默认尺寸按 900px 高的宿主量出来，一屏不用滚动：整张卡约 423px 高，比六节全开时矮了近一半。宿主变矮按视口高度分四档压缩表头、HUD、工具条、页签与行距，五档实测（宿主 984 / 933 / 841 / 733 / 640px）参数区分别 164 / 152 / 121 / 104 / 104px，都没有滚动；案例视口低于约 514px 才交给可见滚动条——那时也可以按住表头把面板拖到别处，或拽右下角的把手把它拉大，位置和大小写在内联样式里，宿主页面的规则覆盖不动。收起以后剩下的那颗悬浮球同样能按住拖走，移动满 4px 才算拖，所以拖完松手不会顺手再展开一次；球拖到贴近屏幕边上时，展开的那一瞬间面板会按自己的真实尺寸把位置夹回视口里，底部的按钮永远点得到。

面板与引擎的对应关系是照着「一局」建立的：

- 状态行下面一条细进度条按 `built/total` 推进，跑完停在 100%；未触发时它是灰的。忙碌光标的色点按最后一笔的先后排，最多五个，和扩展 HUD 上那一排一样。
- 工具条上的六颗按钮分成两拨：镜头、倍速、声音、暂停、跳过改的是**当前这一局**，不用重跑；重播（`replay()`）按同一份配置再采一遍再演一遍。
- 改过的行标成铜色并带一个 `·`，下面一行写明「N 项待生效 · 点『应用并重跑』」；点过之后变成「已与正在跑的这一局一致」。
- 每一行、每一颗按钮、连同收起后的那颗球都有 hover 提示，提示气泡由面板自己画（原生 `title` 要等一秒、字号配色也不受控）：鼠标一停就出现，永远落在视口里，拖球的时候它会自己收起来，灰掉的行会把原因接在同一句话后面。
- 有依赖的行会自动灰掉并说清原因：设了目标时长，速度倍率归估算器管，滑块就禁用，提示里写着「把目标时长改回 0 才能手调速度」；关掉复制盖章，每组复制同样灰掉；构建顺序不是「随机」，随机种子那一行也一样。
- 暂停 / 跳过 / 镜头 / 倍速 / 声音只在跑着的时候可点，结束或停掉后自动禁用；重播在跑着和跑完以后可点，从未开局时它也是灰的——第一局走「应用并重跑」。
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

面板本身是双语的。中文是源语言，英文不是另起一套界面，而是同一份结构上叠一层替换：静态文案在 shadow 树建好后按节点整块换，运行中写进去的状态行、待生效提示、灰化原因则走 `phrase(lang, 中文模板, …)`——它们本来就是中文写的，查一遍表再填参数。语言怎么定：`tune({ lang })` 优先，其次读宿主页面的 `<html lang>`（`en`/`en-US` 都算英文），都没有就是中文。所以嵌进一个英文站点不必传任何参数，面板自己就是英文的。

不想自己写接线代码，就把说明页底部那段「给 AI 的提示词」整个复制给别的 agent：里面是安装、只指向一个容器、可选的创造者模式入口、全部参数的含义、不许为了动画重构 DOM，以及验收标准。中英各一份，复制走的永远是屏幕上那一份，切到 EN 再按按钮拿到的就是英文。

## API

### 导出

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `SwarmBuilder` | `new (options?: SwarmBuilderOptions)` | 主类 |
| `mount` | `(options?) => SwarmBuilder` | 建实例并立即 `start()` |
| `tune` / `SwarmTuner` | 子入口 `swarm-builder/tune` | 创造者模式，见上 |
| 类型 | `SwarmBuilderOptions` `SwarmConfig` `SwarmResult` `SwarmStatus` `SwarmPhase` `AgentInfo` `CursorShape` | 声明文件随包发布 |
| `DEFAULT_OPTIONS` / `SPEED_STEPS` | 值与四个元素的数组 | 默认配置与工具条的 1×/2×/3× 三档，可用于对齐宿主的设置界面 |

### 选项（`SwarmBuilderOptions`）

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `root` | `HTMLElement` | `document.body` | 要重建的子树，坐标相对它计算 |
| `agentCount` | `number` | `8` | 光标数量，1–24。扩展常驻 8 个；`agents: 'auto'` 时它是下限 |
| `speed` | `number` | `1` | 全局时间倍率，0.25–8 |
| `targetDuration` | `number` | `0` | 目标秒数，0–120。>0 时取代 `speed`，由估算器反推倍率 |
| `order` | `'group' \| 'rows' \| 'cols' \| 'snake' \| 'depth' \| 'radial' \| 'random'` | `'rows'` | 光标怎么认领活儿。`rows` 自上而下——配上默认的 `pick: 'live'` + `trigger: 'scroll'` 就是扩展那条前沿（带按元素顶边切，同一位置父先于子——按中线切会把一个两屏高的通栏容器排到它自己孩子的后面，光标就得回头去偷）；`group` 一棵子树一个人（最快，画面铺满整页）；`cols` 同样切带但横过来，一条竖带一个光标——页面没有真的沟（左右两栏之间那种空隙）时自动退回 `rows`；`snake` 也是横带，但带内按 x 走、奇数带反着走；`depth` 每个 DOM 深度内部再切带，外层骨架先亮起来、叶子后填；`radial` 按到蓝图中心的距离一圈圈由内向外；`random` 用 `seed` 洗牌。队列认领（`pick: 'queued'`）下 `rows` 才是 N 个光标各守一条带同时开工 |
| `balance` | `boolean` | `false` | 把页面切成「等预估工时」的带，而不是「等件数」的带。密集页上半页比下半页厚一倍时，默认切法会让一个光标多干一倍的活、另外五个停下来等它收尾；切分用的是最优连续划分（painters partition DP），所以开了只会更平，不会更差。它只改一条带切多长，不改朝哪个方向扫，和上面任意 `order` 叠加 |
| `seed` | `number` | `0` | 只在 `order: 'random'` 下参与排程。0 = 每局现抽一个新顺序；同一个数字 = 同一场施工可重放 |
| `performanceMode` | `'auto' \| 'high' \| 'low'` | `'auto'` | `auto` 在 `root` 内元素数 ≥250 时关辅助线、字号步进并把复制压到 6；`low` 永远裁剪；`high` 永远不裁。音效不在裁剪名单里：它按秒限量发声、不产生 DOM 节点，砍掉只会让人以为选项坏了 |
| `ignore` | `string \| string[]` | `[]` | 命中选择器的元素连同子树整块跳过 |
| `maxItems` | `number` | `4000` | 蓝图条目上限，1–5000，超出计入 `dropped`。扩展也是 4000 |
| `duplicate` | `boolean` | `true` | 重复兄弟节点只真做一个，其余 Option 拖拽盖章 |
| `maxCopies` | `number` | `12` | 每组重复最多盖几个，1–48 |
| `guides` | `boolean` | `true` | 画出布局本来就存在的对齐辅助线 |
| `maxGuides` | `number` | `16` | 每次运行辅助线数量，0–64 |
| `grow` | `boolean` | `true` | 大标题一边打字一边长到真实字号 |
| `sound` | `boolean` | `true` | 合成音效，无音频文件。开着但浏览器还没放行时是「解锁」态：第一次按键 / 点按 / 滚动才真正出声，和扩展一样。设 `false` 才完全静音 |
| `flocking` | `boolean` | `true` | 光标途中互相避让（只做 separation，不做对齐/聚合） |
| `tour` | `boolean` | `false` | 滚动跟随施工前沿，结束交还页首。默认关：滚动归宿主所有 |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | 施工线墨色。`auto` 按 backdrop → root → body → html 第一个不透明底色判断明暗 |
| `autoStart` | `boolean` | `false` | 下一帧自动开始，不用手动 `start()` |
| `onStart` | `(agents: AgentInfo[]) => void` | — | 本局所有光标的 `{ id, name, color }` |
| `onProgress` | `(built: number, total: number) => void` | — | 每建成一项回调一次 |
| `onComplete` | `(result: SwarmResult) => void` | — | `{ built, dropped, durationMs, seed }` |
| `onStatus` | `(status: SwarmStatus) => void` | — | 200ms 一拍的 HUD 数据（阶段、`built/total`、在场与忙碌人数、最近五个忙碌光标、实际倍速与地面 pace、声音/解锁/镜头、`needsScroll`），阶段切换时立即再报一次。创造者模式面板就是靠它画的 |

`SwarmResult.seed` 是本局**实际**用的种子。传 0 表示「现抽一个」，抽到几只有这里知道——看到一场想重看的，把它填回 `seed` 就能按同一套认领顺序重放。

### 对齐参考实现的开关（`flight` / `pointer` / `agents` / `gather` / `pick` / `trigger` / `adaptiveSpeed` / `scan` / `score` / `reducedMotion` / `keys`）

这十一项不是「打开才像扩展」的预设：**库默认就是参考扩展这一套**——光标待时绕轨道飞、鼠标当圆心、班组自动增减、开场先聚群、活按运行时价钱挑、只有滚到的那一段才放行、积压自己提速、采集前先滚一遍、声音与生成式配乐开着、读者要求减少动效时直接交还、Esc 与 M 可用。每一项都能关回简单模式；关掉的时候与之对应的轨道场、指针监听、每帧定价、convolver 都不构造，不是「加了个 if 每帧照样算」。创造者模式面板把 29 项按用途分进六个页签（规模 / 顺序 / 光标 / 采集 / 声音 / 外观），一次摊开一页，每行一个 hover 说明。

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `flight` | `'idle' \| 'live'` | `'live'` | 光标干完活在干什么。`live` 放回群蜂里绕圆心转：135px 轨道环会呼吸、径向弹簧收在 [-2600, 1400]、90px 内邻域对齐（自己 0.7 / 邻居 0.3）、箭头朝速度方向偏过去并按下时压扁。数值逐条对过原版。`idle` 停在落点不动，画面安静 |
| `pointer` | `'ignore' \| 'follow' \| 'repel'` | `'follow'` | `flight: 'live'` 时真实鼠标算什么。`follow` = 轨道圆心，群蜂整群跟着手走；`repel` = 48px 排斥环，撞进去给 260 的向外冲量；`ignore` 当它不存在。只有非 `ignore` 才挂 `pointermove` 监听 |
| `agents` | `'fixed' \| 'auto'` | `'auto'` | 人数会不会变。`auto` 时 `agentCount` 只是下限、48 是上限：滚动每快 40px/s 加一个人、可领的活每两件加一个人，一次只从画面左右外 40px 放进场、间隔 35ms；干过活又闲了 2.5 秒的临时光标自己离场，原始班底不走。代价是同一套参数不再对应同一场戏，`seed` 也管不住什么时候多招一个人；`fixed` 就是「光标数量」那几个 |
| `gather` | `boolean` | `true` | 开局先演扩展那个开场：原始班底从两侧画面外飞进来、围着视口中心绕圈，读者一滚轮或鼠标擦到 48px 内立刻散开领活，没人碰最多 2.4 秒自己开工。这段时间镜头不动、活一件不发、配乐也不起。关着就是光标直接出现在任务旁、第一帧开工 |
| `pick` | `'queued' \| 'live'` | `'live'` | 怎么领活。`queued` 按 `order` 先把队列切好，各干各的区；`live` 是原版的运行时定价——每帧给所有可领的活算一次分（不在视口 ×1e6，出带的那一段 ×0.6，离光标 y 的距离 ×0.4，辅助线 −5e5），谁分低谁拿走，于是一群人会追着眼前的活跑而不是守着各自的格子。每帧多一趟 O(活数 × 人数) |
| `trigger` | `'immediate' \| 'scroll'` | `'scroll'` | 什么时候放行一项。`scroll` 只放已经进过这一屏的：前沿就是视口底边（扩展的 `frontier = viewBot`），只降不升。要配 `tour` 或宿主自己滚动，否则页面下半截永远不亮；页面本来就不比视口高时整页一次解锁 |
| `adaptiveSpeed` | `boolean` | `true` | 活堆起来就把时钟拧快：`speed × min(1 + 积压 × 0.45, 4)`，积压按「已解锁、还没人领」每帧重算。开了之后 `speed` 和 `targetDuration` 变成下限而不是节奏——收尾会更快，但节奏不再由你定 |
| `scan` | `'single' \| 'pre-scroll'` | `'pre-scroll'` | 采集能看到多少页面。`single` 是一次同步走完 `root`，布局成什么样就建什么样。`pre-scroll` 是原版那一趟：先等字体和图片（都有时限）、找出**真正在滚动的那个元素**（`main{overflow:auto}` 的页面滚动条不在 window 上）、按最多 28 个视口高度走下去让懒加载与 `content-visibility` 的内容先长出来，再回顶部落定采集；顺带剔掉读屏专用盒、`content-visibility: hidden` 子树、闭合的 `<details>`，并按绘制顺序（z-index → 定位 → 文档顺序）排。代价是开始以前多等一段——重建别人的站点时这是唯一能用的档，缺图和不能滚动就是这一趟没走 |
| `score` | `'off' \| 'generative'` | `'generative'` | `sound` 开着时出什么样的声。`off` 只有按键、画笔、盖章的点击声；`generative` 是原版的编排：104 BPM 十六分格、MIDI 40 起的 E 小调五声、带 2.756 不谐和泛音的玻璃钢琴音色，方块面积选八度、横向位置选音级，每格最多一声、同时在响不超过 28 个、混响用现生成的 3.2 秒房间冲响，按键声按光标位置声像，结束时扫一个 E 大调加九 |
| `reducedMotion` | `'run' \| 'skip'` | `'skip'` | 系统要求「减少动效」时怎么办。`run` 照跑：这是进场装饰，是宿主主动要的，不是无意识的视差；`skip` 按原版的规矩，一项都不建，直接把真实页面交还并立即上报 |
| `keys` | `boolean` | `true` | 接不接管键盘。`true` 时 Esc 结束这一局、M 静音/解除静音、任意键或指针按一下解锁浏览器的音频配额；在输入框里打字不会被抢走 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `start()` | 采集并开始；重复调用无效 |
| `toggle()` | 扩展那颗开关：跑着的收工、跑完的重放、没跑过就开局 |
| `stop(reveal = false)` | 立刻交还页面并忘掉这一局（扩展的 `stop` / 「Go live」）。`reveal` 为真时演出场落下的那一下；实例仍可 `start()` / `replay()` |
| `replay()` | 拆掉这一局，按同一份配置重新采集、重新演 |
| `pause()` / `resume()` | 冻结 / 继续同一个时钟，暂停期间不欠时间 |
| `isPaused` | 当前是否暂停 |
| `setSpeed(multiplier)` | 运行中改倍率，0.25–8；`cycleSpeed()` 走扩展 HUD 的 1×→2×→3× 循环 |
| `setSound(on)` / `toggleSound()` | 开关声音。声音开着但浏览器还没放行时，`toggleSound()` 先解锁而不是静音（扩展那颗喇叭的「Tap for sound」态）；`isSoundOn` 读当前状态 |
| `setTour(on)` / `toggleTour()` | 运行中开关镜头跟随，不必重跑；`isTouring` 读当前状态 |
| `status` | 当前的 `SwarmStatus`，和 `onStatus` 是同一份数据 |
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

估算按条目线性计价，而真实成本在整页规模上是超线性的（每多一个幽灵盒子，其余盒子的重排都更贵）。把 `maxItems` 从 400 抬到 2000、吃下密集控制台整页 440 项之后，自然节奏 53.1s、`targetDuration: 10` 实测 19.9s——定速仍然把节奏砍掉一半以上，但落点会从目标值偏出去。验收里 400 项那一档按 ±35% 卡死，整页那一档只卡「必须显著快于自然速度」，偏差如实报出来。

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
- 外壳里输入第三方地址，能不能重建取决于「读不读得到长好的 DOM」：同源页和愿意给 `Access-Control-Allow-Origin` 的站点可以直连；其余大多数会被浏览器挡下，这时走本地 dev server 上的 `/__page` 转发口（只读正文、不带凭据、上游的 `Set-Cookie` 不回传）。转发口会先用无头 Chromium 把页面**真渲染一遍**（滚过全页触发懒加载、等图落地、再序列化 DOM），渲染不可用才退回静态 fetch。**这个转发口只在 `npm run dev` 存在**，静态托管上没有后端可转发，那类站点仍然降级为原样嵌入——读不到 DOM 就不假装能盖
- 双语覆盖的是仓库里的这几页和创造者模式面板；抓进来的第三方页面保持它自己的原文，字典不该替别人翻译内容
- 页面不可见时浏览器会节流 rAF，动画随之停摆——这是平台行为，不是库的 bug

## 来源与差异

效果基准是 [DhvanilPatel/swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors)（Chrome 扩展「Swarm Rebuild」），嵌入形态基准是 [ZhengLinLei/cursor-swarm.js](https://github.com/ZhengLinLei/cursor-swarm.js)，灵感站点 [califa/swarm-site](https://github.com/califa/swarm-site)。

复用尺度按 License 分两档写清楚，因为「能不能抄」不是一个答案能盖住的：

- **cursor-swarm 是 MIT**（`LICENSE`，© ZhengLinLei）。它的算法该直接用的就直接用，不再自己想一遍——它的解锁线（元素顶边越过视口 88%）只当过最初一版的草稿，最终按扩展的 `frontier = viewBot` 对齐到视口底边、`_rate()` 的 `speed × min(1 + backlog × 0.45, 4)` 就是这里的 `adaptiveSpeed`，数值与式子照它。
- **swarm-cursors 扩展与 califa/swarm-site 都没有 License**（扩展的 `README.md` 写着 "License: None yet… please don't reuse this code without checking with Joel Califa"，GitHub API 查 califa/swarm-site 的 `license` 也是 `null`）。所以这一份**一行源码都没搬**：把它的常量、式子和判据逐条量出来（`follow()` 的 135/0.18/300/4/[-2600,1400]/600/90/0.7-0.3/180/6/48/260/1.6，`makeCursor()` 的 25% 快班与各档 `rand()` 区间，`pick()` 的 1e6/0.6/0.4/−5e5，班组的 40px·2 件·35ms·2.5s），再用我们自己的类型与结构写一遍。这能对着原文件逐行核验，也不冒充是谁的代码。想把它真的搬进来，得先去拿授权。

| | 原版扩展 | 轻量库 | 本库 |
| --- | --- | --- | --- |
| 形态 | Chrome 扩展，装才能用 | 可嵌入 JS 库 | 仓库源码 / npm / CDN，ESM/CJS/IIFE |
| 作用范围 | 整页 | 页面 | 任意 `root` 子树 |
| 效果完整度 | 完整（六类拆解、群聚、辅助线吸附、复制、音效编排） | 基础光标协作 | 默认即原版主路径（飞行、聚群、叫价、逐段解锁、配乐、音效全开） |
| 程序可控 | 扩展 UI | 可配置 | 配置 + 控制方法 + 回调 + 类型 |
| 许可 | 无明确授权 | 见上游 | MIT |

原版的长处是效果完整、编排细腻；短处是扩展形态进不了自己的网站、无授权导致源码不可复用、也没有供程序调用的配置与完成回调。轻量库的长处正是嵌入轻、可配置；短处是效果厚度不及原版清单。本库要做的是把两者接起来——**默认跑法就是原版那一套**（不只外观，声音、交互、生命周期接口一起对齐：`toggle / stop / replay / cycleSpeed / toggleSound / toggleTour / status`、Esc 与 M、开场聚群、运行时叫价、逐段解锁、积压提速、预滚动采集、生成式配乐），上面那张表里的十一项都能单独关回简单模式——并补上它们都没有的产品化部分：

- `targetDuration` 定速进场、`performanceMode` 自动降级、`theme` 深浅色自适应
- `tour` 镜头跟随、`fixed` 视口钉定层、重建中滚动的坐标修正
- `order` 七套认领算法（子树并行 / 横带 / 竖带 / 蛇形 / 逐层 / 由内向外 / 随机）+ `balance` 等工时切带 + `seed` 可复现的随机排程（原版与轻量库都是固定顺序，看第二遍和第一遍一模一样）
- `ignore` / `maxItems` + `dropped` 计数、`pause/resume/setSpeed/skip/destroy`
- 完整 TypeScript 声明、三格式产物、消费端冒烟门禁、可嵌入的创造者模式（悬浮球入口可拖拽、面板可缩放、每项都有 hover 提示）

换来的代价也写清楚：它是**进场特效**，不是懒加载——页面照样一次性布局，只是分镜亮起来，长页第一屏之外的内容仍然要等 DOM 齐；扩展装完在任何网站零改造即得，本库要在自己页面里写一次 `new SwarmBuilder({ root })`；跨源的图片与画布拿不到像素时只能降级成灰盒或截帧，这是浏览器的规则，不是实现偷懒；密集页上 `maxItems` 与 `performanceMode` 的自动裁剪会改变画面，看到的不等于全量。

没做的也记下来：`typingSpeed/drawSpeed` 细分倍率——会让暂停、跳过、定速三套互相打架，收益抵不上复杂度（理由见交接文档 §6）；以及原版那个始终开着的 `tempo` 节奏阀 `clamp(2.1 + vel/900 + avail/cursors × 0.5, 2.1, 4.5) × speed`。它和 `targetDuration` 是同一种东西的两个版本——都要抢 `speed` 的解释权，两个都开就没有一个能保证了，所以这里把它做成可选的 `adaptiveSpeed`，用的是轻量库那条更简单的式子，原式留在注释里可查。至于动态增减光标，以前算在「没做」里，现在它是 `agents: 'auto'`。

## 开发与验收

```bash
npm run dev              # http://localhost:5199/demos/index.html
npm run build            # 主包 es/cjs/iife + tune 子入口 + 声明文件
npm run typecheck        # tsc --noEmit
npm run verify           # Playwright 31 个验收场景，截图落在 .shots/
npm run verify:consumer  # 把 tarball 装进独立目录，按真实消费者入口各走一遍
npm publish --dry-run    # 发布预检：跑完整 prepublishOnly，只打包不上传
```

`demos/index.html` 是唯一的预览入口：一个铺满屏幕的 mockup 浏览器窗口，标签页切案例（产品说明页 / 简单页基准 / 密集控制台 / 深色落地页 / 复杂工作台 / 长页面跟随 / 别人的站点），地址栏、前进后退、重新载入、GitHub 入口和底部状态栏都按真的浏览器样子画。第一页 `home.html` 是这个项目自己的说明页——功能、用法、参数速查、已知边界都在里面，它和其余案例走同一条重建链路，所以「它能不能重建自己」这件事不用另外证明。案例页本身没有工具栏，参数只在案例 iframe 内的创造者模式面板里改——iframe 不是偷懒：镜头跟随读的是 `window.scrollY / innerHeight`，换成内联滚动容器会让相机跟着错误的视口走。`tall.html` 专门做镜头跟随：实测页高 2767px、默认 `order: 'rows' + tour: true`，一眼能看出页面是一层层往下盖的。`tune.html` 假装成「别人家的站点」（满屏裸选择器 + 故意和面板撞名的类），专门用来验证面板隔离。每个案例的预设都默认开着 `sound` 与 `tour`，验收直接读面板上打勾的控件核对，不读 HTML 里的字符串。

双语那套机制值得单独说：**中文是源语言**，英文是查表换出来的。外壳与案例页靠 `demos/lang.ts`——`?lang=en` 时按文本节点整段匹配 `demos/dicts/<页>.ts` 的字典，运行时才写进 DOM 的句子走 `tr()` / `trf()`。创造者模式面板同理，字典在库里的 `src/tune/locale.ts`：`localize()` 换建好就固定的标签、选项与 hover 提示，`phrase()` 换带 `{0}` 的状态行，语言由 `tune({ lang })` 决定、不写就跟 `<html lang>` 走。之所以不做成「英文为源」：注释、验收断言、README 全是中文，反过来会让默认语言变成二次翻译的结果。第三方网页只换外壳和面板，被重建的那一页留着它自己的文字。验收的 `i18n @1280` 不只看字典覆盖率（`window.__sbI18n.missed`），还把渲染后的整棵 DOM 连同 iframe、shadow root 扫一遍，汉字与中文标点一个都不许漏——上一版靠人眼抽查，漏了整块参数提示。

「别人的站点」那个标签能重建任意地址，靠的是本地开发服务器上的 `/__page?url=` 转发口（`vite.config.ts` 里的插件 + `tools/relay-render.mjs`）：浏览器不让跨源 `fetch` 读正文，没有 `Access-Control-Allow-Origin` 就直接抛，所以 `demos/browser.ts` 先试直连、再走同源转发，只放行 http(s)、不带访问者凭据。转发口不是 `curl` 一下那么简单：静态 HTML 只是站点发货时的空壳（B 站首页静态只有 13 张 `<img>`、文档高 1078px），所以它开一台共享的无头 Chromium，让页面自己的脚本跑完、一屏一屏滚下去逼出懒加载、等图落地后再序列化 DOM——同一页渲染后是 56 张图、四千多像素高。一次渲染有总预算、滚动步数与距离上限、序列化体积上限，视频流直接掐掉；Playwright 或浏览器二进制不在时一律退回原来的静态 fetch，dev server 照常起。响应头 `x-relay-render: headless | fallback | fetch` 写明这次走的是哪条路（`?render=off` / `?render=fail` 可以现场演示两条退路）。静态托管上没有这个转发口，那里诚实地降级为直接嵌，状态栏写清楚为什么没盖。

还有一处坑写进配置里：vite 默认把 `**/dist/**` 排除在 watch 之外，dev server 会一直发它缓存过的旧产物，走 IIFE 的 `demos/cdn.html` 于是拿着旧的面板字符串，看起来像「面板不跟语言」。`server.watch.ignored` 已经把 `dist` 收回来，`npm run build` 之后刷新即见新产物；验收脚本每次自己起服务器，不受影响。

手机模式统一收在 `@media (max-width: 760px)` 这一档（定在 760 而不是 800，验收矩阵的 @800 一档仍是桌面版）：多栏网格换单列、控制台与工作台把两侧面板收到主列下面、代码块自己横滚；外壳的标签条横滚、地址栏单独换一行——标签条**必须**滚得起来，滚不起来就说明它把窗口撑宽了，这条是正向断言。创造者模式面板另外按视口高度分档，壳里那块案例视口只有 607px 高（标签条 + 顶栏 + 状态栏要吃掉一百多像素），默认展开的 13 行参数 + 6 个节标题仍然不滚动全露；其余四节默认折起（标题上写着当前值），正是按这一档量的——607px 下把 29 行全铺开必然出滚动条，`panel-fit` 场景按 984/983/933/932/841/840/733/732/640 九个宿主高度逐档量 `scrollHeight ≤ clientHeight`，并要求每一档都恰好露出 13 行 + 6 节。`mobile @390` 场景逐页量 `documentElement.scrollWidth`，还采样施工中的那一趟——光标箭头和名字标签贴着右边缘时最容易把文档悄悄撑宽，窄屏上实测多出的曾是整整一屏，撑宽了就是一条闪出来的横向滚动条。`swarm-builder-plan.md` 是交接文档：能力分级、每批实测数据、踩过的坑都在里面。

`prepublishOnly` 串起 typecheck → build → verify → verify:consumer，任何一环红了都发不出去。消费端门禁会真的 `npm pack` + 安装，检查 ESM/CJS/两个 IIFE 全局形状、声明文件正例过反例拦、以及装完包之后页面里真跑一场。

发布目标由包自己的 `publishConfig.registry` 钉在 `registry.npmjs.org`，不受本地默认 registry（例如只读的 npmmirror 镜像）影响。门禁的嵌套 npm 命令会显式关掉 `npm_config_dry_run`——否则 `npm publish --dry-run` 传下来的这个变量会让它们只打印不写盘，`node_modules` 空掉、报错看起来像包坏了。

## 许可

[MIT](./LICENSE) © 2026 tycon