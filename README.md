# swarm-builder

把一个已经存在的页面，用一群小光标「重新搭建」一遍。

它读取当前 DOM，生成蓝图，铺一层隔离画布，然后让 1–24 个光标分别拉框、打字、贴图、画辅助线、Option 拖拽复制，最后把真实页面交还给你。
**它不克隆功能**：按钮不会因此能点，表单不会因此能提交——这是一段进场动画，不是一个可用的副本。

- 无依赖，运行时只有一个 `requestAnimationFrame` 时钟
- es 43.89 kB（gzip 13.36）/ iife 35.60 kB（gzip 12.08）
- 不改动宿主 DOM 的结构，只在 `root` 里加一个 overlay，结束时精确还原

## 安装

```bash
npm i swarm-builder
```

```js
import { SwarmBuilder } from 'swarm-builder';
```

不想打包就直接引 IIFE，全局叫 `SwarmBuilder`：

```html
<script src="https://unpkg.com/swarm-builder/dist/swarm-builder.iife.js"></script>
```

## 用法

```js
const swarm = new SwarmBuilder({
  root: document.querySelector('#app'),
  agentCount: 8,
  targetDuration: 6,          // 六秒搭完，速度自动反推
  onComplete: (result) => console.log(result.built, result.durationMs),
});

swarm.start();                // 或者 mount({...}) 直接开始
```

页面比视口高、想让镜头跟着施工：

```js
new SwarmBuilder({ root: document.querySelector('#app'), tour: true });
```

## 配置

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `root` | `HTMLElement` | `document.body` | 要重建的子树。坐标全部相对它计算 |
| `agentCount` | `number` | `6` | 光标数量，1–24 |
| `speed` | `number` | `1` | 全局时间倍率，0.25–8 |
| `targetDuration` | `number` | `0` | 目标时长（秒）。>0 时取代 `speed`，由估算器反推倍率；0 保持自然节奏 |
| `performanceMode` | `'auto' \| 'high' \| 'low'` | `'auto'` | `auto` 在 `root` 内元素数超过 250 时关掉辅助线、字号步进、音效并把复制次数压到 6；`low` 永远裁剪；`high` 永远不裁 |
| `ignore` | `string \| string[]` | `[]` | 命中选择器的元素连同子树整块跳过 |
| `maxItems` | `number` | `400` | 蓝图条目上限，超出的直接丢弃并计入 `dropped` |
| `duplicate` | `boolean` | `true` | 重复的兄弟节点只真做一个，其余用 Option 拖拽「盖章」 |
| `maxCopies` | `number` | `12` | 每组重复最多盖几个，1–48 |
| `guides` | `boolean` | `true` | 画出布局本来就存在的对齐辅助线 |
| `maxGuides` | `number` | `16` | 每次运行的辅助线数量，0–64 |
| `grow` | `boolean` | `true` | 大标题一边打字一边长到真实字号 |
| `sound` | `boolean` | `false` | 合成音效（无音频文件）。默认关：浏览器把它算进自动播放配额 |
| `flocking` | `boolean` | `true` | 光标在途中互相避让 |
| `tour` | `boolean` | `false` | 自动滚动跟随施工前沿，结束时把页面交还到页首 |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | 施工线墨色。`auto` 按 backdrop → root → body → html 第一个不透明底色判断明暗 |
| `autoStart` | `boolean` | `false` | 下一帧自动开始，不用手动 `start()` |
| `onStart` | `(agents) => void` | — | 拿到本局所有光标的 id / 名字 / 配色 |
| `onProgress` | `(built, total) => void` | — | 每建成一项回调一次 |
| `onComplete` | `(result) => void` | — | `{ built, dropped, durationMs }` |

## 方法

| 方法 | 说明 |
| --- | --- |
| `start()` | 采集并开始，重复调用无效 |
| `pause()` / `resume()` | 冻结或继续同一个时钟，暂停期间不欠时间 |
| `isPaused` | 当前是否暂停 |
| `setSpeed(multiplier)` | 运行中改倍率，0.25–8 |
| `skip()` | 立刻结束：停表、全部记为建成、揭示真实页面 |
| `destroy()` | 拆掉 overlay 并恢复宿主 DOM 的可见性 |

## 它是怎么排节奏的

`src/core/estimate.ts` 走一遍调度器真正要发的队列，把每个动作（移动、拉框、打字、淡入、盖章、辅助线、吸附）的价格累加到最长的那条队列上，再乘一个在三个测试页上拟合的标定系数 1.45。实测落点：

| 目标时长 | 实测 |
| --- | --- |
| 自然（speed 1） | 8.7s |
| `targetDuration: 3` | 3.2s（+7%） |
| `targetDuration: 10` | 8.8s（-12%） |

页面很大时先考虑 `performanceMode`，再考虑 `targetDuration`：拥挤的页面真正会崩的不是帧率（注入到 414 项时 rAF 仍是 16.67ms/帧、0 个长帧），而是四十秒的时长和满屏的辅助线噪声。

## 已知限制

- 非功能性副本：动画定格在采集那一瞬间，交互不存在
- `sticky` 元素没有专门处理；`position: fixed` 的源元素会进独立的视口钉定层，但如果它的祖先带 `transform` / `filter`，这个假设会失效
- 伪元素、复杂媒体、Web Component 的 shadow DOM 会降级成占位框
- 光标避让解决不了「两个光标同时收敛到同一坐标」，那是布局的结果
- 长页面受 `maxItems` 上限约束，超出部分计入 `dropped` 而不是重建

## 开发

```bash
npm run dev      # http://localhost:5199/demos/index.html
npm run build    # es + iife + 声明文件
npm run verify   # Playwright 跑 17 个验收场景，截图落在 .shots/
```

`demos/index.html` 是壳页：工具栏只有一份，案例从各演示页的 `#app` 片段抽出来现场替换，所以标记内容仍只有单一来源，验收脚本也照样能直接访问 `simple.html` / `console.html` / `landing.html` / `dark-ui.html`。案例里 `console.html`（密集控制台）是真实规模的那一个：415 个可重建项、页高 2018px、68 次复制、10 个 `fixed` 元素，自然速度约 28 秒——这种页面上建议同时打开「跟随」。

`swarm-builder-plan.md` 是交接文档：能力分级、每一批的实测数据、踩过的坑和还没做完的事都在里面。

## 关于来源

本项目按公开可观察的行为重新实现，没有复制任何第三方源码。
