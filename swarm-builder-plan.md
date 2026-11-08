# Swarm Builder 成熟库改造计划（Agent 交接文档）

> 最后更新：2026-11-08  
> 状态：**全部批次完成**——完整版（批次 1–5）+ 高级版 + 预览壳页与真实规模案例（§13.11）+ 发布护栏（§13.12）+ 调参面板（§13.13）+ 上架准备（§13.14）+ 预览统一进 mockup 浏览器与创造者模式收口（§13.15）+ 构建顺序与种子、密集页音效、长页面镜头（§13.16）+ 入口改名创造者模式与悬浮球（§13.17）+ 悬浮球贴边展开的视口钳制（§13.18）+ 五种分布顺序与等工时切带（§13.19，参数面 18 项）+ 第一页换成产品说明页、GitHub 入口与手机模式（§13.20），验收 24 个场景全绿、`npm publish --dry-run` 全链路通过；只差本人 npm 登录后正式发 0.1.0  
> 目标：让其他 Agent 可直接接手推进

---

## 1. 项目背景与目标

### 1.1 背景
用户希望基于以下两个项目，重新架构一个**成熟、可高度定制、可嵌入网站**的光标集群重建库：

1. **原版完整效果参考**  
   - 仓库：https://github.com/DhvanilPatel/swarm-cursors  
   - 形态：Chrome 扩展（Swarm Rebuild）  
   - 价值：效果完整（拆解、任务调度、群聚、辅助线、复制、音效等）

2. **轻量库形态参考**  
   - 仓库：https://github.com/ZhengLinLei/cursor-swarm.js  
   - 形态：可直接嵌入的 JS 库  
   - 价值：使用方式轻、可配置、适合网站集成

### 1.2 核心目标
做一个新的库（暂定名 **Swarm Builder**），满足：

- 效果尽量接近原版 Swarm Rebuild 的完整表现
- 形态接近轻量库（可 npm / script 引入，可嵌入任意网站）
- 高度可定制（速度、集群数量、行为开关、触发方式等）
- 可作为网站进场加载特效使用
- 也可用于产品演示、模拟复杂 Web UI（如 Blender 风格界面）的重建展示

### 1.3 非目标（当前阶段不做）
- 不做 Chrome 扩展
- 不直接复制原版源码进行发布
- 不追求 100% 复刻所有边角兼容
- 不先做可视化编辑器

---

## 2. 关键约束与风险

### 2.1 版权约束（必须遵守）
- 原版 Swarm Rebuild **目前无明确 License**
- README 明确要求：复用前需与作者及 Joel Califa 沟通
- **禁止直接大段复制** `swarm.js` 源码
- 允许：学习思路、数据结构、能力模型，然后**重新实现**

### 2.2 技术约束
- 纯前端，零或极少依赖
- 优先支持现代浏览器
- 需要性能降级策略（低端设备可关闭 flocking、减少光标数）
- 支持只作用于指定容器（不必强制整页）

### 2.3 产品约束
- 必须能作为「进场特效」稳定使用（有完成回调）
- 配置项要足够丰富，但默认值要好用
- 中等复杂度页面不应明显卡顿

### 2.4 嵌入前提（MVP 实现时确认，完整版必须继续守住）
- **坐标系**：所有 item 坐标相对 `root` 的 border box；隔离层用负 `left/top` 抵消 root 自身边框，因此容器有没有边框、页面滚到哪都不影响对齐
- **背景不丢**：快照会识别覆盖 root 55% 以上的第一个着色盒作为 backdrop，直接画在隔离层上而不参与动画，否则重建期间整页会闪白
- **空快照不闪屏**：item 数为 0（宿主隐藏或宽度为 0）时不建隔离层，直接触发 `onComplete`，避免真实页面被遮一帧
- **清理**：`destroy()` 必须移除隔离层、恢复被遮住的子元素、还原被临时改写的 `root.position`
- **时钟**：所有动画走同一个 rAF 时钟并按 `speed` 缩放，`pause/resume/setSpeed` 之后不需要改任务层
- **已知未解**：`position: fixed` 子元素、页面在重建过程中滚动、open shadow root、`prefers-reduced-motion` —— 都归入完整版/高级版处理

---

## 3. 原版完整能力清单（对照基准）

### 3.1 核心流程
- Snapshot：遍历 DOM（含 open shadow root）生成蓝图
- Blank：用隔离层覆盖原页面
- Rebuild：多光标按任务重建
- Toggle / Go Live / Replay

### 3.2 拆解类型（Snapshot 输出）
- Rect：填充、边框、圆角、阴影、渐变、遮罩、背景模糊
- Text：计算样式文本（含链接、行内代码、伪元素等）
- Line：单边框、hr
- Media：img / svg / video / canvas / iframe（复杂场景截图降级）
- Duplicate：重复兄弟元素（master + copies）
- Guide：对齐辅助线（左边缘、基线等）

### 3.3 光标与集群
- 多光标协作
- 光标命名与配色
- 滚动加速时动态增加光标
- 群聚物理（轨道、对齐、避让）
- 最小/最大光标数控制

### 3.4 重建动作
- 拉框（十字准星 + 宽高徽章 + 灰盒占位 + 内容淡入）
- 打字（I 型光标、闪烁 caret、大标题字号步进）
- 画线（钢笔锚点 + 橡皮筋）
- 拉辅助线并吸附
- Option 拖拽复制（带间距标注）

### 3.5 交互控制
- 手动触发 / 自动触发
- 滚动跟随
- Tour 自动滚动
- 速度倍率（如 1x/2x/3x）
- 音效开关
- 随时退出

### 3.6 音效
- 打字机械键盘音
- 点击音
- 辅助线吸附音
- 搭建音符音（位置声像、大小影响音高）
- 过程过渡音（溶解、散开、完成、Go Live）

### 3.7 已知限制（原版）
- 非功能克隆，只做视觉
- 动画定格在触发瞬间
- 长页面有层数/高度上限
- 部分伪元素、复杂媒体、Web Component 会降级

---

## 4. 新库能力分级（实现优先级）

### 4.1 MVP（第一阶段，已完成）
目标：跑通可用闭环，可嵌入页面。

- 基础 Snapshot（Rect + Text 为主）
- Overlay 隔离层
- 多光标移动与基础拉框
- 基础打字效果
- 可配置：`agentCount`、`speed`
- 支持 `root` 指定容器
- `start()` / `onComplete`
- 可手动触发或自动触发
- **尺寸徽章、灰盒占位、内容淡入**（原属 §4.2，已提前到 MVP：它们是 Rect 任务的渲染副产品，成本极低，但没有它们无法判断观感方向是否正确）

### 4.2 完整版（第二阶段）
目标：观感接近原版主路径。

- Media 支持（已完成，见 §13.1）
- Duplicate（master + 复制）（已完成，见 §13.2）
- Guide 辅助线与吸附（已完成，见 §13.3）
- 尺寸徽章、灰盒占位、内容淡入
- 动态光标数量（可选跟随滚动）
- 速度细分（typingSpeed / drawSpeed）
- 基础音效（已完成，见 §13.5）
- `pause` / `resume` / `setSpeed` / `skip` / `destroy`（已完成，见 §13.4）
- `ignore` 选择器，支持 string 与 string[]（已完成，见 §13.4）
- fixed 定位与重建中滚动的坐标修正（已完成，见 §13.4）
- `maxItems` 限制

### 4.3 高级版（第三阶段）
目标：质感与产品化。

- Flocking 群聚物理 ✅ 见 §13.7（只做避让，对齐/聚合经实测不做）
- Tour 模式 ✅ 见 §13.8
- 更完整音效编排
- 性能模式（auto/high/low）✅ 见 §13.6
- 进场特效快捷模式（目标时长自动算速度）✅ 见 §13.6
- 主题适配（深浅色）✅ 见 §13.9
- 更完善的进度回调与事件
- 文档与示例站

---

## 5. 架构方向（重新架构，不写具体代码）

### 5.1 模块划分建议
- `core`：Snapshot、Blueprint、Scheduler、Agent、AgentPool、Flocking
- `render`：Overlay、CursorRenderer、EffectRenderer
- `tasks`：Rect/Text/Media/Line/Guide/Duplicate
- `effects`：SoundEngine、Transition
- `api`：主入口与配置归一化

### 5.2 数据流
1. Snapshot 生成蓝图任务
2. Blank 创建隔离渲染层
3. Scheduler 按依赖与策略分发任务
4. Agent 执行动作（移动 → 执行 → 完成）
5. 全部完成后回调，并可 Go Live

### 5.3 设计原则
- **任何常驻 tickable 必须自带退出条件**：`Engine` 只在 tickable 集合清空时才 idle，`onComplete` 才可能触发。ProgressTicker 与 TourCam 都靠这一点自己摘掉自己；漏掉就是整场运行悬挂（§13.8）
- 效果参考原版，形态参考轻量库
- 配置驱动，默认值友好
- 表现与调度分离
- 可降级，可限流
- 尽量少侵入宿主页面

---

## 6. 配置项（已实现，权威版本见 README）

> 落地时改名或砍掉的项都标在下面，避免下一个 Agent 按旧名字找。

配置：`root`、`agentCount`、`speed`、`targetDuration`、`order`（§13.4/§13.19，七套认领算法）、`balance`（§13.19，等工时切带）、`seed`（§13.16）、`performanceMode`、`ignore`（string|string[]）、`maxItems`、`duplicate`、`maxCopies`、`guides`、`maxGuides`、`grow`、`sound`、`flocking`、`tour`、`theme`、`autoStart`、`onStart` / `onProgress` / `onComplete`
方法：`start()`、`pause()` / `resume()` / `isPaused`、`setSpeed()`、`skip()`、`destroy()`，另有 `mount(options)` 一步开局
创造者模式（独立子入口 `swarm-builder/tune`，§13.13 起、§13.17 换成悬浮球入口）：`tune(options)` / `SwarmTuner`，方法 `apply()` / `reset()` / `restore()` / `snippet()` / `copy()` / `open()` / `close()` / `destroy()`，只读口 `status` / `phase`（`idle|running|paused|done`）/ `expanded`；选项 `root`（元素或选择器）/ `initial` / `position` / `open`。收起态入口是一颗 46px 悬浮球（自绘 SVG 标记 + 球下「创造者模式」一行），轻点展开、按住可拖到视口任意位置

- `followScroll` → **`tour`**（`scroll` 太容易被理解成「滚动行为开关」，它实际是镜头跟随 + 结束交还页首）
- `showRulers` → **`guides`**（与 §3.4 的「拉辅助线并吸附」同名，只有一处拼写）
- `maxAgents` / `minAgents` → **没做**：滚动加速时动态增减光标需要重排已发出的队列，收益抵不上调度器改造；`agentCount` 固定 + `targetDuration` 已经能覆盖同一个诉求
- `typingSpeed` / `drawSpeed` → **没做**：所有时长都过同一个 `engine.speed`，单独开两个倍率会让「暂停/跳过/目标时长」三件事互相打架；内部常量 `typeInterval` / `moveSpeed` / `fadeDuration` 留在 `normalizeOptions` 里，需要时再公开

---

## 7. 推荐实施路径

### Phase 0：研究（0.5–1 天）
- clone 两个仓库
- 完整体验原版扩展效果
- 体验轻量库嵌入方式
- 对照「原版完整能力清单」做差异记录

### Phase 1：MVP
- 重新实现最小可用链路
- 先保证 Rect + Text + 基础光标协作
- 先打通配置与完成回调

### Phase 2：完整版
- 补齐 Media / Duplicate / Guide
- 补齐主要视觉细节与基础音效
- 补齐常用控制方法

### Phase 3：高级版与产品化
- Flocking、Tour、性能模式
- 进场特效模式
- 文档、示例、边界测试

---

## 8. 验收标准（Definition of Done）

### MVP 验收
- 可在任意普通网页/本地页通过脚本触发
- 能重建主要布局框与文本
- 可配置光标数与速度
- 完成后可靠触发 `onComplete`

### 完整版验收
- 观感明显接近原版主路径
- 对常见落地页/产品页稳定可用
- 可只作用于指定容器
- 中等复杂度页面不明显卡顿

### 高级版验收
- 可作为官网进场特效稳定使用
- 具备性能降级策略
- 配置项完善，文档与示例齐全

---

## 9. 已知决策

1. **路线选择**：参考原版重新架构，不做“在轻量版上小修小补”的路线  
2. **代码策略**：不直接复制原版源码，按能力清单重写  
3. **产品定位**：库优先，不是扩展  
4. **优先场景**：
   - 网站进场加载特效
   - 产品宣传/演示
   - 复杂 Web UI（如模拟 Blender 界面）重建展示

---

## 10. 已锁定决策（2026-11-07 确认）

1. **库名**：`swarm-builder`（npm 包名与全局名 `SwarmBuilder` 一致）
2. **分发**：npm + CDN 双分发，产物为 `dist/swarm-builder.es.js` 与 `dist/swarm-builder.iife.js`；样式由 JS 注入，不产出独立 CSS 文件，保证单 script 可嵌入
3. **音效**：默认关闭（`sound: false`），Phase 2 再接入
4. **Flocking**：留在高级版（Phase 3），完整版不做
5. **框架包装层**：不做，先纯原生 JS；React/Vue 包装等 MVP 之后由需求决定

---

## 11. 参考链接

- 原版扩展：https://github.com/DhvanilPatel/swarm-cursors
- 轻量库：https://github.com/ZhengLinLei/cursor-swarm.js
- 原版灵感站点：https://github.com/califa/swarm-site
- Chrome 商店（原版）：https://chromewebstore.google.com/detail/swarm-rebuild/diaeaocnhdhbknkbfbnkjikfcgokainm

---

## 12. 交接说明（给下一个 Agent）

你接手后建议按这个顺序推进：

1. 阅读本文完整内容  
2. 本地 clone 并体验两个参考仓库  
3. 基于「能力分级」从 MVP 开始设计与实现  
4. 任何时候都优先保证：
   - 不侵权复制
   - 可嵌入
   - 可配置
   - 可完成回调
5. 完成 MVP 后，再扩展到完整版能力

如果需要补充文档，优先补：
- 更细的模块职责说明
- MVP 任务拆分看板
- 测试页面清单（产品说明页 / 简单页 / 密集控制台 / 落地页 / 深色复杂 UI / 长页面 / 别人的站点），由 `demos/index.html` 这个 mockup 浏览器窗口统一切换，第一页是本项目自己的说明页（§13.15、§13.20；早期是带工具栏的壳页，顶栏已删）

---

## 13. MVP 实测记录（2026-11-07）

代码位置：`src/`（core / render / tasks / api），测试页 `demos/`，验收脚本 `tools/verify.mjs`（Playwright，1280 与 800 两档宽度 × 四个页面 + 13 个专项场景）。

| 页面 | 快照项数 | 1x 耗时 | 同屏并发 |
| --- | --- | --- | --- |
| simple（少量块+文本） | 19 | 3.5s | 2 准星 / 5 I 型 |
| landing（典型落地页） | 41 | 6.3s | 3 准星 / 4 I 型 |
| dark-ui（Blender 风格密集面板） | 98 | 6.0s | 7 准星 / 2 I 型 |

三页在两个宽度下均无控制台报错，`onComplete` 全部可靠触发，结束后隔离层清除且原页面恢复可见。

实现过程中被实测推翻的一处设计：**任务不能按文档顺序连续切块**。这样父元素会跨光标阻塞，6 个光标退化成串行，落地页耗时 15.5s；改为「按子树成组 + 大组再切 + 组内取首个就绪项」后降到 6.3s。调度层的这条约束要保留。

参考仓库只读对照（`.refs/`，仅记录行为规则，不复制源码）：

- **Duplicate 判定**：兄弟节点按 `tag + class 集合 + 层 + 内部 item 种类序列` 生成签名分桶；只考虑含 1–48 个 item 的节点；单个超过 40 字的段落不参与复制（宁可打字）；桶内还需盒尺寸相似（纯文本节点放宽），≥2 个才成组，第一个为 master、其余为 copies。
- **Media**：`img` 直接按解析后的 src 建新元素并保留 `object-fit/object-position`；`svg` 克隆样式节点并设 100% 宽高；canvas/video/iframe 走截图降级。
- **Guide 生成**：候选是字号 ≥13、宽度 >30 的文本项；按 900px 纵向分带，在带内取被 ≥3 个文本共用的左边缘 x 作为竖向辅助线（全局上限 16 条），取带内字号最大的前 2 个（距顶部 450px 内）作为吸附成员并记录各自的 x 偏移；同样取共用的顶边 y 生成横向辅助线；辅助线任务本身排在成员上方 30px。
- **大标题字号步进**：字号 ≥28 且高度 <400 的文本项开启 grow。
- **调度**：任务带纵向坐标、依赖表和所属层；一次反向传播把「所有依赖自己的任务里最早的 y」写成本任务的 gate，使辅助线先于吸附它的元素出现。我们目前只有树序 blocker，缺这一层。

实施顺序按批次推进，Media（§13.1）与 Duplicate（§13.2）已完成，剩余优先级见本文最后一条「下一步优先级」。

### 13.1 完整版批次 1：Media（2026-11-07）

新增 `kind: 'media'` 与 `MediaPayload`（`img` / `svg` / `still` / `fallback` 四种模式）。快照阶段冻结内容：`img` 取解析后的 `currentSrc || src`；`svg` 用 `cloneNode(true)` 带走；`canvas`/`video` 用 `toDataURL` 截一帧，抛错（污染画布）或尚未就绪则记为 `fallback`；`iframe` 直接 `fallback`。媒体项用 `contentBox()`（扣掉自身 border+padding）而不是 border box，避免把边框画进图里。

任务侧复用矩形批次已有的 `DragRectAction` 拉出盒子，再由 `RevealMediaAction` 在 `begin()` 灌入真实内容并淡入到原始 opacity；`fallback` 保留灰盒外观并打上降级标记，验收脚本据此断言「零降级」。

| 页面 | 快照项数 | 媒体项 | 1x 耗时 | 同屏并发 |
| --- | --- | --- | --- | --- |
| simple | 19 | 0 | 3.5s | 3 准星 / 5 I 型 |
| landing | 50（+9） | 5（1 svg + 4 img） | 10.1s | 4 准星 / 5 I 型 |
| dark-ui | 100（+2） | 1（canvas still） | 6.0s | 7 准星 / 6 I 型 |
| cdn | 11 | 0 | 2.2s | 2 准星 / 3 I 型 |

两档宽度全部 PASS，无控制台报错，媒体槽位 100% 呈现、零降级。构建产物 es 26.04 kB（gzip 8.17）/ iife 21.40 kB（gzip 7.34）。

三条实测结论：

- **`aria-hidden="true"` 的元素整棵被跳过**（`isVisible()` 的规则），所以装饰性 svg 图标不会进入蓝图。测试页把 logo 改成 `role="img" + aria-label` 才覆盖到 svg 路径。这条规则本身是对的（原版同样不重建纯装饰节点），但要在文档里写明，否则用户会以为漏抓。
- **落地页 6.3s → 10.1s** 不是串行退化：同一页 6 光标 8.9s、12 光标 5.7s，说明关键路径是「组内 blocker 链」而不是总项数。每个媒体项给所在子树链加了 drag(≤380ms)+fade(≈140ms)。真正把时长压到目标值要靠高级版的 `targetDuration`（反推 speed），已记入 §4.3。
- **dark-ui 100 项只分成 2 组**（根节点只有 2 个子元素），组内 LPT 切分虽然保住了 6.0s，但组数太少会让「多光标」失去意义。批次 2/3 动调度器时一并评估：切分阈值按组内项数而非 `target*1.5`。

验收脚本 `tools/verify.mjs` 结构调整：先做 10 次密集采样抓徽章/拖框这类瞬时特征，再以同样采样频率轮询直到完成，保证「累计最大值」覆盖整轮运行——否则媒体这类后段才出现的项会被漏计（第一次跑出 4/5 就是这么来的）。另有 `tools/probe.mjs <page> [--items]` 可直接 dump 蓝图的种类分布、分组数与逐项目坐标/blocker，批次 2 的 Duplicate 分桶验证会用到。

### 13.2 完整版批次 2：Duplicate（2026-11-07）

快照阶段为每个元素记录「候选」：`tag + 排序后的 class 集合 + 深度 + 子树 item 种类序列` 作为签名，连同该子树产出的全部 item id、盒尺寸、是否含 >40 字长文本。`applyDuplicates()` 按 **父元素身份 + 签名** 分桶（父级分桶让"同一行的卡片"天然聚在一起，跨区块的同名结构不会误判），过滤掉 item 数不在 1–48 之间、或含长文本的候选，要求盒尺寸在 15% 内相似（纯文本桶只比高度），≥2 个成员才成立：第一个是 master，其余每个复制项只保留第一条 item 作为「盖章任务」，同子树其余 item 标记 `consumed`。

调度与呈现：`Scheduler` 把 `consumed` 项排除在队列与 `known` 之外（否则会出现永远等不到的 blocker），但 `total` 仍按全部 item 计，进度数字才和「重建了多少」一致；复制任务的 blocker 指向 master 首项，所以一定排在母本之后。任务三段式 = 移动到母本盒 → `StampDragAction` 拖出虚影框（`⌥ W × H` 徽章，时长按距离 180–460ms）→ `StampRevealAction` 用 `Overlay.buildFinal()` 把整棵子树的 rect/text/media 一次性建成终态再统一淡入，同时 `markBuilt()` 归还计数。

| 页面 | 快照项数 | 盖章任务 | 被吞掉的 item | 1x 耗时 |
| --- | --- | --- | --- | --- |
| simple | 19 | 3 | 5 | 3.5s → **4.2s** |
| landing | 50 | 9 | 10 | 10.1s → **5.9s** |
| dark-ui | 100 | 29（+4 嵌在复制子树内） | 30 | 6.0s → **3.8s** |
| cdn | 11 | 0 | 0 | 2.2s |

两档宽度 8/8 PASS，媒体零降级，无控制台报错。构建产物 es 30.58 kB（gzip 9.43）/ iife 24.98 kB（gzip 8.45）。

四条实测结论：

- **耗时主要来自重复子树**：落地页 50 项从 10.1s 降到 5.9s，dark-ui 从 6.0s 降到 3.8s，与 §13.1 记录的「关键路径是组内 blocker 链」一致——复制项把长链截断了。
- **嵌套复制会被父复制吞掉**：dark-ui 33 个复制根里 4 个位于另一个复制子树内，它们随父项 `consumed`，不再单独盖章。所以验收断言要数「盖章任务」而不是「dup 标记数」，第一次跑出 29/33 就是这个原因。
- **瞬时元素不能用采样计数**：虚影框只活几百毫秒，`querySelectorAll` 的峰值只能反映同屏并发（最多等于光标数）。改成在页面里挂 `MutationObserver` 累加新增节点，才拿到真实的 29/9/3。
- **短标签复制不再逐字打字**：导航链接、chip 这类 1–3 项的桶直接盖章，`已打字` 从 291 掉到 161（dark-ui）——观感上"打字"集中在真正的主标题和正文，符合原版取舍。

`tools/probe.mjs` 现在直接输出 `stamped / nestedInsideCopies / consumed`，批次 3 的辅助线验证继续用它。

### 13.3 完整版批次 3：Guide + 吸附 + 标题字号步进（2026-11-07）

新增 `src/core/guides.ts`：`applyGuides()` 在 Duplicate 之后跑，把文本项（字号 ≥13、宽度 >30）按 900px 纵向分带，带内按取整后的左边缘 x / 顶边 y 分桶，≥3 个成员共用同一条边即成为辅助线；线段范围取成员在该轴上的最小起点到最大终点。全局上限 16 条，按 `轴 + 位置` 排序后插入到「第一个成员」的 item 位置之前，因此和成员同组、同光标，天然排在前面。

- **gate 传播**：不做全量 gate。最初给每条线的所有成员都 push 了 guide blocker，落地页从 5.7s 涨到 8.7s——一个组的头几项被卡住会连带整条子树等待。改成只 gate「该线上字号最大的 2 个成员」+ 吸附成员，其余成员照常并行。
- **吸附**：竖向线额外找 6–32px 的近邻（排除已在线上的），按字号取最大的 2 个，记 `snapFrom = 线 x − 成员 x`；成员的 action 列表末尾追加 `SnapSettleAction`，元素先画在线的位置、再滑回真实位置。为此给 overlay 创建的每个元素打上 `data-item`，后续动作按 id 反查（`Overlay.elementOf`）。
- **辅助线任务** = 移动到线头 → `DrawGuideAction`（160ms 画线，徽章 `x=48` / `y=228`）→ `DropGuideAction`（170ms 淡出并移除）。踩过的坑：`.sb-guide` 默认 `opacity:0`，而淡入只在 drop 阶段设置，导致画线全程不可见；改为 draw 的 `begin()` 就置为 `GUIDE_OPACITY`（0.55）。
- **标题字号步进**：快照阶段对字号 ≥28 且高度 <400 的文本项打 `grow`，打字时从 62% 字号随进度升到实际字号，`end()` 写回原值保证终态一致。

| 页面 | 项数（含线） | 辅助线 | 吸附成员 | grow 标题 | 1x 耗时 |
| --- | --- | --- | --- | --- | --- |
| simple | 22 | 3 | 2 | 1 | 3.8s |
| landing | 55 | 5 | 2 | 5 | 8.7s（无 guide 5.7s） |
| dark-ui | 100 | 0 | 0 | — | 3.8s |
| cdn | 11 | 0 | 0 | — | 2.2s |

两档宽度 8/8 PASS。构建产物 es 35.89 kB（gzip 10.87）/ iife 29.16 kB（gzip 9.72）。

dark-ui 一条线都没生成是符合规则的：面板内文本左边缘各不相同，没有 3 个以上共用同一条边。

A/B 脚本 `tools/ab.mjs <page>` 固定跑三档（关复制 / 只开复制 / 复制+辅助线）来隔离每一项观感特性的时间成本。落地页的结论：Duplicate 省 3.2s，Guide 花 1.6s。**这 1.6s 是「5 条线各自 330ms + 移动」的串行代价，不是调度退化**；真正把总时长压到目标值要靠高级版的 `targetDuration`（反推 speed），已排入 §4.3。

### 13.4 完整版批次 4：控制方法 + ignore 数组 + fixed/滚动坐标修正（2026-11-07）

**时钟侧**：`Engine` 增加 `pause()/resume()/isPaused`。pause 直接 `cancelAnimationFrame` 并把 `frame` 归零，`add()` 在暂停态不再启动循环；resume 时若已无 tickable 就立刻走 idle 回调，否则重开循环并把 `last` 重置为当前时刻——所以恢复后不会把暂停期间的时间一次性补算。因为库里所有时长都是「墙上时间 × speed」，`setSpeed()` 只改 `engine.speed`，任务层零改动。

**API 侧**：`SwarmBuilder.pause()/resume()/isPaused/setSpeed(mult)/skip()`。

- `skip()` 的最终实现比第一版小很多。第一版是「停表 → 把没建完的项逐个补齐（`Overlay.finish`）→ reveal」，实测发现补齐完全不可见：`complete()` 在同一 tick 里就把 overlay 移除并恢复真实页面，而重建的终态本来就是真实页面。于是删掉 `Overlay.finish()/clearTransient()` 与 `Scheduler.isDone()`，`skip()` 缩成「停表 + 全部计为已建 + complete」。保留的语义是 `onComplete` 的 `built` 等于 `total`（辅助线也算，它本来就没有终态内容）。
- `demos/main.ts` 加了「暂停/继续」「跳过」两个按钮，速度下拉框改成 `change` 即时 `setSpeed`（原来只在重放时生效）。

**ignore**：`ignore?: string | string[]`，`normalizeIgnore()` 过滤空串；`shouldIgnore()` 本来就是「自身匹配或祖先匹配」，所以子树级跳过自动成立，不需要新逻辑。

**fixed 与重建中滚动**：这是本批次唯一需要改坐标系的部分。

- 快照阶段 `walk()` 多带一个 `insideFixed`，元素自身 `position: fixed` 或位于 fixed 祖先内，则它产出的所有 item 打 `fixed: true`（含文本、媒体、复制项）。
- Blueprint 新增 `rootOffset`（快照时 root 的视口位置）。`Overlay` 据此懒建一个 `.sb-fixed` 层：`position: fixed; left:0; top:0` + `transform: translate(rootOffset.x, rootOffset.y)`。fixed item 的坐标仍然是「相对 root」的文档坐标，所以这个 translate 恰好把它还原到快照那一刻的视口位置；而 fixed 元素的视口位置在纯滚动下是不变量，**因此不需要每帧做滚动补偿**，普通层照常随 root 滚动，两层各走各的。
- 文本光标（caret）与复制拖影也按 item 归属进对应的层；`Overlay.layerRectOf(item)` 让 `TypeAction` 在正确的层里测量，否则 fixed 文本的 caret 会偏移一个滚动量。
- 辅助线候选排除 fixed 项：它们的左边缘是视口边（`right: 26px` 这类），不是版面边，混进桶里会造出假线。

| 页面 | 项数（含线） | fixed 项 | 辅助线 | 1x 耗时 |
| --- | --- | --- | --- | --- |
| simple | 22 | 0 | 3 | 3.8s |
| landing | 58（+3：新增 fixed 客服块） | 3 | 5 | 5.9–8.7s |
| dark-ui | 100 | 0 | 0 | 3.8s |
| cdn | 11 | 0 | 0 | 2.2s |

验收从 8 个场景变成 11 个（`node tools/verify.mjs` 全绿）：

- `controls @1280`：暂停后 1s 内光标 transform 与元素数完全不变；继续后恢复推进；中途 `setSpeed(4)` 能跑完；`重建中 5/58` 时点跳过 → `完成 58 项`，overlay 已清除、原页面已恢复。
- `fixed-scroll @1280`：跑到 fixed 块已重建后把窗口滚 500px，fixed 元素视口 top 818 → 818（纹丝不动），同一时刻普通元素 top 46 → -454（正常跟着滚），滚动后仍然 58/58 建完。截图 `.shots/fixed-scrolled.png`。
- `ignore[] @1280`：同一页跑两遍，`ignore: ['.cards']` 从 22 项降到 11 项，被忽略子树的文本一次都没出现，`第一项` 等其余内容照常重建。

构建产物 es 37.61 kB（gzip 11.35）/ iife 30.56 kB（gzip 10.17）。

已知边界（都记在这里，避免下个批次误判）：

1. `position: sticky` 未特殊处理——它只在「吸附中」的那段区间表现得像 fixed，快照无法预判，暂时按普通流处理。
2. fixed 层依赖 `position: fixed` 真的相对视口。若 root 或其后代带 `transform / filter / will-change / contain`，浏览器会把 fixed 后代收进那个盒子，本层会跟着滚；这类页面需要宿主自己调整，尚未做探测补偿。
3. 重建中滚动时，fixed 项的光标位置仍按文档坐标画（光标是瞬时装饰，不影响终态），没有把光标也搬进 fixed 层。

### 13.5 完整版批次 5：基础音效（2026-11-07）

`src/core/sound.ts` 只有一个 `SoundBus`：四种事件各自一段振荡器包络，不加载任何音频文件。

| 事件 | 波形 | 频率走向 | 时长 | 峰值增益 | 同类最小间隔 |
| --- | --- | --- | --- | --- | --- |
| `type`（每敲一个字符） | square | 1500 → 950Hz | 35ms | 0.045 | 30ms |
| `draw`（开始拖一个盒子） | triangle | 300 → 760Hz | 120ms | 0.08 | 70ms |
| `stamp`（复制落位） | sine | 680 → 230Hz | 160ms | 0.12 | 60ms |
| `guide`（画辅助线） | sine | 1180 → 1120Hz | 90ms | 0.06 | 60ms |

- 触发点全部落在 action 的 `begin()` / 打字真正改变字符的那一帧：`DragRectAction.begin` → draw，`TypeAction.tick` → type，`StampRevealAction.begin` → stamp，`DrawGuideAction.begin` → guide。`RunContext` 多了一个 `sound: SoundBus | null`，任务层不需要知道有没有开。
- **默认关闭**（§10 已锁的决策），并且 `AudioContext` 是第一次发声时才创建、不是构造时——浏览器把 context 数量算进自动播放策略，绝大多数宿主根本不开音效，不该替他们留一个。`destroy()` 里 `close()`。
- 限流用 `performance.now()` 而不是 `ctx.currentTime`：context 被自动播放策略挂起时 `currentTime` 不走，用它会「只响第一声」。这是写代码时踩到、当场改掉的一个真问题。
- 每个 `type` 事件带 ±70 音分随机 detune，六个光标同时打字才不会糊成一条平音。

验收新增第 12 个场景 `sound @1280`：headless 里听不见声音，所以改为在页面里替换 `AudioContext` 与 `createOscillator` 来数节点，并读回 context 的真实状态。

| 配置 | AudioContext | 发声次数 | context 状态 | 时钟 |
| --- | --- | --- | --- | --- |
| `sound` 未传（默认） | 0 | 0 | — | — |
| `sound: true`，simple @4x | 1 | 25 | running | 1.06s |

`state === 'running'` 且 `currentTime` 推进到 1.06s，说明图真的在渲染（headless 没有扬声器，这一步能证到的就是「有信号在跑」，音色好不好听仍需人耳）。12/12 场景全绿。

构建产物 es 39.44 kB（gzip 11.97）/ iife 32.01 kB（gzip 10.76）。

### 13.6 高级版批次 1：`targetDuration` 定速 + `performanceMode` 裁剪（2026-11-07）

`src/core/estimate.ts` 走一遍调度器真正要发的队列，把每个动作的成本（移动、拖框、打字、淡入、复制、辅助线、吸附）累加到**最长队列**上，得到速度 1x 下的自然时长；`api.start()` 再用 `natural / target` 反推 `engine.speed`（仍夹在 0.25–8 之间）。传了 `targetDuration` 就不再看 `speed`——节奏此时是目标，不是倍率；运行中 `setSpeed()` 依旧可以覆盖。

实测（1280×900、6 光标、speed 1）：

| 页面 | 项数 | 模型预测 | 标定后 | 真实墙钟 | 标定前偏差 |
| --- | --- | --- | --- | --- | --- |
| simple | 22 | 2.24s | 3.25s | 3.80s | 1.69x |
| landing | 58 | 6.81s | 9.88s | 8.72s | 1.28x |
| dark-ui | 100 | 6.99s | 10.14s | 11.48s | 1.64x |

- 先试过「每项 +40ms 动作交接」这种机理建模，三页残差 1.22–1.60 不收敛；缺口其实来自 **blocker 等待**（光标下一个项被祖先挡住时整帧空转）和动作边界的丢帧，属于调度器的性质而不是页面的性质。改成单一标定系数 1.45 后，三页全部收进 ±14%，代码里只留一个有注释的常数。

验收新场景 `pace-perf @1280`：

| 配置 | 实测 | 目标 | 偏差 |
| --- | --- | --- | --- |
| 自然（speed 1） | 8.7s | — | — |
| `targetDuration: 3` | 3.2s | 3.0s | +7% |
| `targetDuration: 10` | 8.8s | 10.0s | -12% |

`performanceMode` 的阈值是量出来的，不是猜的：**帧率在这些页面上根本不是瓶颈**——注入到 414 项 / 1655 个 DOM 节点时，rAF 依旧 16.67ms/帧、0 个超过 20ms 的长帧；崩掉的是时长（6.8s → 38.6s → 42.5s）和满屏的辅助线噪声。所以 auto 用节点数判定拥挤（55 节点→58 项算轻，355 节点→367 项已经很挤），阈值取 250，裁剪 guides / grow / sound / maxCopies→6。`maxItems: 400` 在这条路上确实兜住了底：注入 800 个盒子只有 414 项进蓝图，1254 项被丢弃。

| 拥挤页（255 节点 / 254 项，speed 8） | 辅助线 | 项数 | 用时 |
| --- | --- | --- | --- |
| `performanceMode` 默认 auto | 0 条 | 254 | 6.3s |
| `performanceMode: 'high'` | 10 条 | 264 | 7.2s |

- 裁剪必须在 `snapshot()` **之前**决定：guides 与 grow 是采集期就算好的，运行中切 `performanceMode` 不会生效。
- demo 工具栏加了「时长」下拉（自然 / 3 / 6 / 10 秒），1280/1000/800/640 四档宽度实测无溢出、无裁切。

已知限制：估算是「最长队列」模型，work-stealing 之后真实关键路径可能跨队列；标定系数是在这三页上拟合的，页面结构差别大时误差会回到 ±25% 量级。

构建产物 es 40.86 kB（gzip 12.37）/ iife 33.25 kB（gzip 11.20）。

### 13.7 高级版批次 2：Flocking 光标避让（2026-11-07）

`src/core/flocking.ts` 只有一个 `Flock`：登记所有光标，`offset(point)` 把 90px 半径内的邻居按 `1 - d/90` 加权求和成一个侧向推力（最大 26px）。`MoveAction.tick` 在插值点上叠加这个推力，`swell` 在 80% 行程前保持满值、最后 20% 线性收零，所以**落点仍然精确**（`end()` 本来也会对齐一次）。完全重叠时没有方向，按登记序号取一个角度岔开，避免两根光标朝同一侧躲。

关掉/打开避让的实测（landing @1280、8 光标、speed 2，只统计「两根以上光标同时处于位移中」的帧）：

| 指标 | 关闭避让 | 开启避让 |
| --- | --- | --- |
| 同行采样帧 | 166 | 167 |
| <40px 擦过帧 | 4（2%） | 2（1%） |
| <18px 重叠帧 | 2 | 2 |
| 平均最近距离 | 374px | 375px |
| 用时 / 建成 | 3.3s / 58 项 | 3.3s / 58 项 |

- **这条数据同时解释了为什么只做「避让」，不做「对齐 + 聚合」**：光标队列本来就按子树分组 + LPT 均衡发过，同屏光标的典型间距是 200–400px，本来就不太撞；剩下的 <18px 帧是两根光标**同时收敛到同一个坐标**（同一张卡片的相邻元素），那是布局的结果，侧向绕行改不了它——把半径从 46 提到 90、把 `swell` 从「中段峰值」改成「全程保持」，<18px 帧数都纹丝不动（12→10、17%→15%）。真要消除这种重叠得让调度器在开工前排他，那是另一个量级的改动，不值得为一个观感特性付。
- 因此验收断言用「<40px 擦过帧不得变多」而不是「重叠帧必须减少」；平均最近距离在这个样本里被 400px 级别的帧淹没，纯噪声，已经从断言里删掉。
- 默认开启，`flocking: false` 可关；关掉时根本不把 agent 注册进 `Flock`，`offset()` 直接返回零向量，没有额外分支。

构建产物 es 41.58 kB（gzip 12.63）/ iife 33.74 kB（gzip 11.44）。

### 13.8 高级版批次 3：Tour 自动滚动跟随（2026-11-07）

`src/core/tour.ts` 的 `TourCam` 是一个挂在同一个时钟上的观察器：每 180ms 取一次所有**还在干活**的光标的 y 区间，把「工作前沿」推回视口内（上下各留 90px 边距），然后进入 500ms 冷却——平滑滚动是浏览器自己的动画，提前重新瞄准会和它打架。结束时把页面**交还给页首**（`scrollTo(rootTop)`），让 reveal 看起来是一整张图而不是滚到一半的碎片。

默认关闭：动滚动位置是宿主页面的资产，不是库的。`tour: true` 才注册这个 tickable，demo 工具栏加了「跟随」勾选。

实测（landing 1280×1802、视口 900、6 光标、speed 2）：

| 配置 | 最大滚动 | 光标在视口内的采样占比 | 结束位置 | 建成 |
| --- | --- | --- | --- | --- |
| `tour` 默认关闭 | 0px | 5% | — | 58 |
| `tour: true` | 904px | 88% | 回到 0px | 58 |

- 关掉时只有 5% 的时间能看见光标在干活——页面比视口高一倍，而构建是自上而下的，这正是 Tour 要解决的问题；开启后 88%，剩下 12% 是冷却窗口内的正常滞后。
- **踩到的坑**：`TourCam` 第一版没有在干完活时把自己从时钟上摘掉，`Engine` 只在 tickable 集合清空时才 idle，于是 `onComplete` 永远不触发、验收直接超时。`ProgressTicker` 早就有同一行注释（「ticker 必须自己离开时钟」），这次是第二次踩，说明这条约束值得写进 §5 的架构说明里：**任何常驻 tickable 都必须自带退出条件**。
- 光标位置用的是 overlay 坐标系里的 `translate3d`，加上 overlay 自己的 `getBoundingClientRect().top` 换算到视口；批次 4 的 fixed 图层让「滚动中重建」这件事本身是安全的，Tour 才敢真的去滚。

构建产物 es 43.0 kB（gzip 13.0）/ iife 34.8 kB（gzip 11.8）。

### 13.9 高级版批次 4：施工线的主题自适应（2026-11-07）

`src/render/theme.ts` 只做一件事：按「backdrop → root → body → html」的顺序找第一个不透明的背景色，算相对亮度，>0.5 记 `light`，否则 `dark`，写进 overlay 的 `data-sb-theme`。CSS 里把三个墨色改成变量（`--sb-ghost` 占位底、`--sb-edge` 拉框虚线、`--sb-copy-edge` 复制框虚线），浅页用深墨、深页用浅墨。`theme: 'light' | 'dark'` 可以强制覆盖，默认 `'auto'`。

| 页面 | 判定 | 虚线墨色亮度（0–100） |
| --- | --- | --- |
| simple（`#fbfbfd`） | light | 9（深墨） |
| landing（`#0b0d12`） | dark | 100（浅墨） |
| dark-ui | dark | 100 |
| landing + `theme: 'light'` | light | 9 |

- 光标本体、名牌、辅助线粉色、徽章底色**没有**进主题：它们本来就有各自的描边或半透明底，在两种底色下都可读，改动反而引入回归。真正只在深色下可见的是那条 `rgba(255,255,255,.5)` 的虚线，也就是原来在浅色页「拉框看不见」的那一个。
- 判定用 backdrop 优先于 root：overlay 铺的就是 backdrop 那块颜色，墨色必须跟着它，而不是跟着宿主元素的 style。

构建产物 es 43.89 kB（gzip 13.36）/ iife 35.60 kB（gzip 12.08）。

### 13.10 高级版批次 5：文档、入口修正与终验（2026-11-07）

README 是对外唯一的 API 文档，`swarm-builder-plan.md` 退居交接文档。写文档时顺手抓到两个真问题：

- `package.json` 的 `module` / `exports.import` 指向 `dist/swarm-builder.js`，而 vite 实际产出 `dist/swarm-builder.es.js`；`types` 指向 `dist/types/src/index.d.ts`，而 `tsc -p tsconfig.build.json` 的 `declarationDir` 产出的是 `dist/types/index.d.ts`。**也就是说：装完包 import 会直接找不到文件**。现在改成 es + iife 双入口（`unpkg` / `jsdelivr` 指 iife），补 `sideEffects: false`（样式是 `injectStyle()` 在构造时注入的，import 本身没有副作用），并加了 `npm run verify`。
- §6 的提案名和落地名不一致（`followScroll` → `tour`、`showRulers` → `guides`），`maxAgents` / `minAgents` / `typingSpeed` / `drawSpeed` 明确记为「不做 + 原因」，否则下一个 Agent 会照着旧名字找代码。

终验：`tsc --noEmit` 干净，`npm run build` 出 es 43.89 kB（gzip 13.36）/ iife 35.60 kB（gzip 12.08），`node tools/verify.mjs` 16 个场景全绿（4 页 × 2 宽度 + controls / fixed-scroll / ignore[] / sound / pace-perf / flocking / tour / theme）。

许可协议已于 2026-11-08 拍板为 **MIT**（用户选定），落地见 §13.12；本条不再是未决项。

### 13.11 预览壳页 + 真实规模案例（2026-11-08）

用户反馈「现在就一个很简单的案例而已」——四个演示页确实都是我自己写的小玩具（22 / 58 / 100 项），能证明链路跑通，证明不了扛得住真实页面。这一批补两件事。

**壳页 `demos/index.html` + `demos/shell.ts`。** 工具栏只留一份，案例内容用 `fetch` 取各演示页的 HTML、`DOMParser` 解析后把 `#app` 的 children 换进壳页的 `#app`。选这个做法的原因：

- 案例标记仍然只有单一来源，不复制一份到壳页里；
- `tools/verify.mjs` 现有的 `/demos/<name>.html` 直连路径全部保持不变，不用改验收；
- `main.ts` 抓的是 `#app` **元素本身**，只换 children 就不必重新绑定控制条——所以壳页先 `await transplant()` 再 `await import('./main')`，顺序保证 `?auto` 触发时内容已经就位。

切换案例时要先点「销毁」再换内容：覆盖层挂在 `#app` 里面，先让上一场自己清理干净，否则 `destroy()` 会去摘一个已经被 innerHTML 换掉的节点。

**密集案例 `demos/console.html`（Orbit 运营台，浅色）。** 实测规模：

| 指标 | 简单页 | 密集控制台 |
| --- | --- | --- |
| 可重建项 | 22 | 415（上限 400 时建成 399、丢弃 41） |
| 页高 | — | 2018px |
| 复制盖章 | 3 | 68 |
| `fixed` 元素 | 0 | 10 |
| 辅助线 | 3 | 16 |
| 自然速度 | 3.8s | 28.0s |
| 定速 10s（上限 2000） | — | 实测 12.7s（440 项） |

**抓到一个真 bug：`demo.css` 的工具栏规则没限定作用域。** `.bar { position: fixed; z-index: 50; ... }` 是裸类选择器，密集案例的图表柱条写作 `.chart .bar`，于是每根柱子都被变成固定定位的深色块——既串了样式，又因为 `z-index: 50` 盖住工具栏，Playwright 点击「重建」直接被柱条 intercept 掉而超时。改成 `body > .bar`（工具栏本来就是 body 直接子节点，和既有的 `body > #app` 一致）。这类冲突只有在内容变密、类名开始撞车时才暴露，玩具页永远碰不到。

**观感上值得记的一条**：6 个光标各吃一段连续队列，所以运行中会出现「上方一段已经建完、中间一段还是空的、下方正在建」的空洞；加上隔离层把原件遮住，中段看起来像漏建。这不是排序 bug，是并行队列的结果，原版同样如此；密集页打开「跟随」把相机拉到工作面前，观感立刻正常。

新增验收场景 `shell-case @1280`：壳页初始案例、切到密集案例的建成数与丢弃数、抬上限后建成数增加、定速 10s 的误差（±35%）、案例内 `.bar` 的计算样式必须是 `static`（就是上面那个 bug 的回归哨兵）、切回落地页后内容正确、控制台零报错。全量 17 个场景重跑（含 `.bar` 作用域改动对既有页面的影响）全绿。

### 13.12 发布护栏：MIT + CJS + 消费端冒烟（2026-11-08）

用户问「可以封装为 npm 库了吗」，实测答案是「ESM/TS/CDN/SSR-import 可以，CJS 不行，且没有许可与发布护栏」。本批把缺口全补：

- **MIT**：`LICENSE`（© 2026 tycon）+ `package.json.license`。§13.10 的未决项就此关闭。
- **CJS 入口**：`dist/swarm-builder.cjs`。包是 `"type": "module"`，CJS 产物若叫 `.js` 会被 Node 当 ESM 而 `require` 失败，所以后缀必须是 `.cjs`；`main` 与 `exports.require` 都指它。
- **`exports` 双条件**：`types` / `import` / `require` 三条件齐全，`./tune` 子入口同构（§13.13）。
- **`prepublishOnly`**：typecheck → build → verify → verify:consumer，任何一环红了发不出去。
- **`tools/consumer.mjs`**：真的 `npm pack` 再把 tarball 装进独立的 `.consumer/`，检查关键文件在位、ESM/CJS 导入形状、tsc 正例过反例拦、起一个本地 http 服务让页面从 `node_modules` 引产物真跑一场（途中采样峰值 + 结束覆盖层清除 + 零控制台报错）。

消费端门禁顺手抓到一处**文档错误**：README 的 CDN 示例写 `new SwarmBuilder(...)`，但 vite 的 IIFE `lib.name` 产出的是**命名空间对象**（`window.SwarmBuilder.SwarmBuilder` / `.mount`），照文档写第一行就抛。已把「IIFE 全局形状」做成消费端断言，并修正 README 为解构写法。`demos/cdn.html` 一直用的是正确的解构写法，错的只有文档。

实测：tarball 106.0 kB / 解包 318.3 kB / 39 文件（含 `CHANGELOG.md`）；主产物 es 43.92 kB（gzip 13.38）/ cjs 35.60（12.07）/ iife 35.63（12.10）。

### 13.13 调参面板（创造者模式）（2026-11-08）

用户提议：在要改的 web 里加一个悬浮窗，现场改参数、应用，或一键复制给 agent。落地为**独立子入口** `swarm-builder/tune`（`src/tune/`：`index.ts` 编排、`panel.ts` shadow DOM 面板、`snippet.ts` 导出），第二个 vite 配置 `vite.tune.config.ts` 产出 es/cjs/iife。不进主包：生产构建不引它就零字节；产物**自带引擎**，所以无构建页面一个 script 标签就能开面板（tune iife 48.05 kB / gzip 17.18）。

面板覆盖全部纯数据选项（15 行控件）+ 暂停/跳过/复制。导出的是**可粘贴代码**而非 JSON：只列与默认值不同的项、`root` 转成选择器、剥掉面板自己的 ignore；给人和给 agent 是同一份。剪贴板在非安全上下文不可用时回退为「片段留在面板里并自动选中」。

两个实测踩出来的坑，都已做成回归断言：

- **外层 document 规则优先于 `:host`，且继承属性会从 host 元素流进 shadow tree。** 宿主页一句 `* { font-family: Georgia }` 就把面板字体改掉了（`btn` 的边框/底色没被改，因为那些不是继承属性）。字体重置必须写在 shadow **内层节点**（`.card,.fab`）上，写 `:host` 无效。
- **`root` 默认是 `body` 时面板是 body 的子节点，会被隔离层一起遮掉。** 新增 `data-sb-chrome` 标记：`Overlay.create` 跳过带标记的子节点（不遮），tuner 把它注入 `ignore`（不重建）。这个标记也留给宿主自己的常驻悬浮件。

验收场景 `tune-panel @1280`（第 18 个）：15 行控件、字体/底色/按钮边框不被宿主串改、运行中面板可见、导出片段跟上面板改动且不含 chrome 选择器、剪贴板与 `snippet()` 一致、root=body 时面板可见且左栏无 item、destroy 后宿主清除、零控制台报错。

两条**测试自身的 bug** 也记下来，免得下次再犯：Windows 剪贴板把 `\n` 归一成 `\r\n`，比较前要还原；用「item 与面板屏幕矩形相交」判断「面板被重建」是错的——真实正文本来就压在面板下面，改判「正文左缘以左的左栏里有没有 item」。

### 13.14 上架准备：registry、元数据与 dry-run 陷阱（2026-11-08）

用户提醒「npm 包发版、README 更新不要忘了」，逐项查下来发现三个真问题，两个已修。

- **默认 registry 是只读镜像。** 本机 `npm config get registry` = `https://registry.npmmirror.com`，`npm publish` 照这个配置走必然失败。已在 `package.json` 加 `publishConfig.registry = https://registry.npmjs.org` + `access: public`，把发布目标钉死在包自己身上，不依赖 whoever 的本地配置。dry-run 末行确认：`Publishing to https://registry.npmjs.org with tag latest and public access`。
- **`npm publish --dry-run` 会把消费端门禁跑成假动作。** dry-run 仍然执行 `prepublishOnly`，并往子进程导出 `npm_config_dry_run=true`；`tools/consumer.mjs` 里嵌套的 `npm pack` / `npm install` 继承之后**只打印文件名、不写盘**。实测受控验证：空目录里 `npm_config_dry_run=true npm pack` 输出 `swarm-builder-0.1.0.tgz` 但写下 0 个文件。于是 `node_modules` 是空的，报错长得像「包坏了」（`MODULE_NOT_FOUND` + `Cannot read properties of undefined (reading 'start')`），真因被埋掉。两处修复：`run()` 给子进程显式设 `npm_config_dry_run: 'false'`；装不上时立刻 `report()` 退出，不再往下跑到浏览器阶段才崩。修完 `npm publish --dry-run` 全链路 EXIT=0，内含 18 场景全绿 + `[consumer] PASS`。
- **npm 登录态失效。** `~/.npmrc` 里有 `//registry.npmjs.org/:_authToken`，但 `npm whoami --registry=https://registry.npmjs.org` 返回 **401**（token 过期或被吊销）。这一步只能由本人 `npm login` 完成，不代跑。

名字可用：`npm view swarm-builder` 返回 404，即 npmjs.org 上未被占用。

元数据补齐：`author`（只写名字，不把邮箱暴露到公开的 npm 元数据里）、`keywords`、`repository` / `homepage` / `bugs`。仓库地址不是猜的——用户拍板「先建 GitHub 仓库再发」，`gh repo create` 实建后拿到 **https://github.com/yancongya/swarm-builder**（gh 账号 yancongya，与 git commit 里的 author 名 tycon 不是一回事，按证据取）。公开前扫过：55 个跟踪文件、无 `.env`/`.npmrc`/私钥类文件名、内容里无 `ghp_`/`npm_`/`AKIA`/`sk-`/PEM 私钥模式。

实测（含 CHANGELOG 与新元数据）：tarball 106.1 kB / 解包 318.6 kB / 39 文件。

下一步优先级：

1. **本人 `npm login --registry=https://registry.npmjs.org`**（当前 token 401），之后 `npm publish` 发 0.1.0。护栏与产物已就绪，dry-run 全绿。
2. 上架后把 README 的「尚未上架 npm」NOTE 换成真实安装说明，并补 npm 版本徽章（徽章要等真的能取到数才加，不留死图）；核对 unpkg / jsdelivr 两条 CDN 链接可用。
3. 真实页面上的肉眼验收：先在 `demos/index.html` 的密集控制台案例上开「跟随」看一遍，再用 `demos/tune.html` 的面板在真实站点上调一轮参。


---

### 13.15 预览统一进 mockup 浏览器，参数收口到创造者模式（2026-11-08）

用户四点要求：预览模板统一在一个 mockup 浏览器里演示并切换；去掉之前的顶栏改参数；统一为创造者模式改；参数全部暴露；同时优化创造者模式的前后端交互。并且明确「先等我是确定没问题了再推送发版」——所以这一批**只做本地提交，不 push、不 publish**。

**为什么是 iframe。** `TourCam` 直接读写 `window.scrollTo / scrollY / innerHeight`，镜头跟随是照真视口写的。把案例内联进壳页的一个滚动 div 里，相机会去滚外层窗口、`position: fixed` 也会钉到错误的视口上，所以案例只能是 frame。frame 顺带把样式隔离也做实了：§13.11 那类「工具栏 `.bar` 规则串进案例，把柱条变成 fixed 块挡住点击」的事故，从根上没有土壤——顶栏整族删掉，`demos/demo.css` 里的 `body > .bar` 规则与 `body > #app { padding-top }` 一起清空。

**改动清单。** `demos/index.html` 重写成 mockup 浏览器（窗口灯 + 标签页 + 前进/后退/重载 + 假域名地址栏 + 创造者模式开关 + 底部状态栏），配套 `demos/browser.ts` / `demos/browser.css`；`demos/main.ts`、`demos/shell.ts` 删除，五个案例页统一挂 `demos/creator.ts`（`tune({root:#app, open:true})`，案例自带默认值写在 `<body data-swarm>`，`?auto` 才自动起跑）；`demos/cdn.html` 收敛成一行 script 标签用 tune IIFE。

**面板与引擎的交互按「一局」重建。** 蓝图在 `start()` 冻结，所以面板不再假装实时生效：改动行标蓝带 `·`，提示行写「N 项待生效 · 点『应用并重跑』」，应用后变「已与正在跑的这一局一致」；状态行下加 `built/total` 进度条（idle 灰、done 100%）；`Phase = idle|running|paused|done` 同时驱动暂停/跳过的可用性（只有跑着才能按）与外壳状态栏的圆点；有依赖的行自动灰掉并在 title 里写原因（设了目标时长→速度归估算器管；关掉复制盖章→每组复制灰）；底部三颗钮各管一段：复制配置 / 重置（回库默认值但不重跑）/ 恢复原状（跑中途 `destroy()` 并把页面原样交还）。`SwarmTuner` 相应多出 `reset()` / `restore()` 与 `status` / `phase` / `expanded` 三个只读口，外壳的状态栏镜像就靠它们（200ms 轮询，不是引擎回调，免得面板被外壳的生命周期绑住）。

**「参数都暴露」做成了可测的几何。** 首版 15 行里有 4 行（施工线色、性能模式、跳过）藏在卡片内部滚动下面且没有任何线索。行高从 28px 压到 24px、`.fields` 上限从 46vh 提到 58vh，实测 1280/1100/1000/800 四档 `scrollHeight === clientHeight`，全部参数一屏看全；万一宿主更矮，`scrollbar-width:thin` + 可见滑块兜底。验收里 `入口: 顶栏 0 个 · 面板 15 行 全露` 就是这条断言。

**测试自身的四处修正。** 一是 `page.waitForFunction(fn, {timeout})` 少传了 `arg` 位，options 被当成参数、超时静默退回默认 30s——原来那个「120s 等密集案例」其实一直没生效；现在统一 `fn, null, {timeout}`。二是 shadow root：Playwright 的选择器引擎会穿透 open shadow root，所以 `page.click('[data-apply]')` 直接可用，但 `page.evaluate(() => document.querySelector(...))` 穿不进去，状态读取必须走 `host.shadowRoot`。另外 evaluate 的函数体是序列化后在页面里执行的，Node 侧的辅助函数带不过去，所以每个 helper 里都得把 shadowRoot 写全。三是 `demos/cdn.html` 加载的是 `dist/` 里的 tune IIFE，改完 `src/tune/**` 不重新 build 就会红——新加的「面板 15 行不用滚动」断言第一次就是这么红的，报的是产物过期而不是代码坏了。四是这条链本身有洞：验收脚本一直硬吃 `5199` 上那个手工开着的 dev server，没人开着就整片连不上；更阴的是长跑的 vite 会把 `dist/` 缓存住，磁盘上已经是 `58vh`、`curl` 回来的还是 `46vh`，于是同一份代码在「我这边」绿、「门禁」红。现在 `tools/verify.mjs` 自己 spawn 一个 `vite --port 0`（`BROWSER=none`，否则每次验收都弹一个真浏览器），从它的 stdout 里读回地址——注意 vite 给横幅上了色，`Local:` 与 URL 之间夹着 ANSI 转义码，匹配前必须先把 `\x1b[…m` 抹掉。`npm run verify` 从此不再依赖任何环境里的手工作。

**这一批已知的手工预览坑（不影响门禁）。** 5199 上那个 dev server 是我早期手工起的，它还在吐过期的 tune 产物；肉眼验面板时要先重启 `npm run dev`，否则看到的仍是旧行高。

**一个真实的引擎边界（不是这一批引入的）。** 定速在默认 400 项这一档是准的：`targetDuration: 10` 实测 9.8s。把 `maxItems` 抬到 2000 吃下整页 440 项后，自然节奏 53.1s 而 10s 目标实测 19.9s。原因是 `estimateRun` 按条目线性计价，真实成本超线性（幽灵盒子越多，其余盒子的重排越贵）。这一批不动引擎：验收改成默认档按 ±35% 卡死、整页档只卡「显著快于自然速度」，并把偏差作为信息行报出来；README「节奏与性能」同步写了这条限制。真要收口，办法是跑中闭环校正（按 elapsed/progress 的比值持续调 `engine.speed`），代价是节奏会中途变——留给用户拍板。

**mockup 浏览器场景（原 `shell-case` 换成 `mockup-browser @1280`）覆盖：** 初始标签/假域名/前进后退都禁用、载入即自动跑一局、状态栏按阶段镜像（要等 200ms 轮询追上，不能拿面板瞬时值比）、切密集案例后 URL 与标签同步、案例内 `.bar` 计算样式仍是 static 且顶栏残留 0、面板抬上限后建成数增加、定速压得下来、后退/前进真的回到上一个案例（历史栈两步时才启用）、创造者模式开关把卡片收成 fab 再展开、重新载入回到案例自带默认（iframe 语义，面板不擅自把改动写进 URL 或 storage）、切回落地页、零控制台报错。

实测产物尺寸（面板加了进度条/依赖说明/两枚新按钮 + 行高压缩后）：tune es 62.83 kB（gzip 20.07）/ cjs 52.24（18.49）/ iife 52.27（18.51）；主包不变 es 43.92（13.38）/ cjs 35.60 / iife 35.63。

本批收口顺序：验收 18 场景全绿 → 本地一个 commit → 等本人肉眼确认「没问题」→ 才谈 push 与 `npm publish`（§13.14 的 1/2/3 步在那之后）。

**收口后的清理（同日）。** 预览入口收到一个：`demos/tune.html` 同时挂成 mockup 浏览器的第五个标签「别人的站点」（`load()` 对每个案例都 `tuner.apply()`，所以它进窗口即自动跑一局，不必再单独开页），窗口共 5 个标签、1280 宽度下标签条不换行不溢出。删掉 `tools/ab.mjs`（A/B 结论已落在 §13.6/§13.7，脚本里的 `ROOTS` 还停在三个旧案例，属于会误导人的死代码）、`.pubdry.log`、`.verify.log` 与旧 `.shots/`（验收重跑即再生）。`.refs/`（41MB，无许可的参考实现源码，已 gitignore）保留不动：它是效果基准的唯一凭据，删了不可恢复。5199 上发现两个手工起过的 vite 实例（一个 IPv4、一个 IPv6），都还在吐 11 月 7 日缓存的 tune 产物——全部停掉后重启，`curl` 回来才是 `58vh`。长跑 dev server 缓存 `dist/` 这件事已经写进上面第四处修正，属于同一个坑的人肉版本。

### 13.16 密集页音效、长页面镜头、构建顺序与种子、面板提示与几何（2026-11-08）

用户这一批提了五点：简单页有音效而复杂页没有；要有长页面测镜头跟随；滚动时不是从上往下构建，能不能把种子和构建顺序算法暴露到参数接口；每个参数都该有 hover 提示；面板要能拖位置、能改大小。仍然「先等我是确定没问题了再推送发版」——本批照旧只做本地提交。

**密集页没声音不是音频问题，是性能模式把选项吃掉了。** 三次升级的取证（外壳 → 面板 → 裸 API）先排掉了自动播放策略：iframe 里 `AudioContext` 根本没被构造（`created: 0`），而页面之外直接调 API 也复现——问题在库内。真凶是 `applyPerformanceMode()` 里的 `opts.sound = false`：音效按秒限量（type .03s / draw .07s / stamp .06s / guide .06s 的墙钟间隔），一个密集页也只发二百多次振荡器，不产生 DOM 节点，砍掉它省不到一帧，只会让「我明明勾了音效」变成无声。修法是把它从裁剪名单里删掉，注释写明为什么不在名单里。验收 `sound @1280` 加了一档密集页子场景（`demos/console.html`，399 项）：`AudioContext=1 · 发声=252`（修复前 0）。

**构建顺序进了参数接口：`order: 'group' | 'rows' | 'random'` + `seed`。** `src/core/rng.ts` 用 mulberry32（可播种、跨引擎可重放，`Math.random()` 两样都做不到）配 Fisher–Yates。调度器从「按子树分堆」扩成三种分法：`group` 保留原样（子树成组、大的先切小再摊平给最闲的队列）；`rows` 按中心 y 排序后等分成 `agentCount` 条横带，第 i 条带直接交给第 i 个光标，光标 0 在最上面那条——这就是「自上而下」；`random` 洗牌后按 `target` 切块再摊平。种子只在 `random` 下参与排程，0 表示现抽一只，实际用的那颗从 `Scheduler.seed` 回显到 `SwarmResult.seed`，看到想重放的填回去即可。
`take()` 同时改成先扫自己的队列、再按固定轮转去别人的队列借一件能做的。这不是锦上添花：横带把一棵子树切给了两个光标，子元素等父元素完成，父元素却在隔壁带上没人认领——不借就是死锁。借完之后有个不变量兜底：阻塞关系永远是「更浅的祖先」，所以只要还有队列非空，其中深度最浅的那件必然已就绪，于是「全局无就绪」等价于「所有队列已空」，光标可以在正确的时刻收工。

**长页面案例 `demos/tall.html`。** 实测页高 2767px、7 个章节，默认 `data-swarm` 写死 `order:'rows' + tour:true`，是 mockup 浏览器的第 6 个标签「长页面跟随」。两个新场景：`order-seed @1280` 观测点选的是 DOM 里 item 的出现顺序——每个光标第一帧各认领一件，所以前 `agentCount` 件完全由排程决定、不受飞行时间影响，同种子两次必须逐位相等、换种子必须不等、种子 0 两次抽到的 `result.seed` 必须不同。`rows` 卡的是它真正保证的两件事：6 光标时开工的前 6 件 y 严格递增且跨满整页（实测 48 549 1158 1442 1926 2470，跨 2422px——第 i 个光标拿第 i 条横带，带 i 整条在带 i+1 上面）；再用 `agentCount:1` 单独跑一局，此时没有并发横带互相穿插，整条创建序列必须自上而下（实测 58 件 57 对里 54 对顺势、最大回跳 505px，阈值卡 ≥90%）。第一版这里写的是「全局创建顺序前 1/4 中位 y → 后 1/4 中位 y 至少下移 400px」，跑出来 -416px：6 条带同时在盖，前后四分位都横跨整页，这个指标恒不成立，属于口径错了而不是实现错了。`group` 的开工顺序只报不卡：`#app` 只有一个子树，`group` 会退化成按文档顺序切块，而文档顺序在这页上≈y 顺序，卡它属于碰运气。`tall-tour @1280` 每 200ms 采一次 `scrollY` 与「正在建的元素是否在视野内」，卡页面高度 ≥2.5 倍视口、最深滚动 ≥600px、停下再起步 ≥2 次（平滑滚动是一段动画，逐帧增量会把它数成很多次，所以数的是「静止→再动」的转变）、收尾 `scrollY < 120`（交还页首也走平滑滚动，先等它落定再判，超时不报错、交给断言说结果）。

**面板：提示自己画、位置与大小归用户。** 原生 `title` 要等一秒、字号配色不受控，而且和自绘气泡会撞成两层，所以 17 行参数、信息钮、折叠钮、底部三颗、工具条三颗、把手全部改成 `data-tip` + 一个 shadow 内的 `.tip`（`position:fixed` 按悬停元素的矩形定位，右→左→压回视口三级退让，并挂 `aria-describedby`）。灰掉的行把原因接在同一句话后面，仍然只有一条提示。表头与 fab 可拖（`pointerdown` + 窗口级 `pointermove/pointerup`，落在按钮上不触发拖拽），拖完 `data-pos="free"` 并把 left/top 写成**内联**样式——宿主页面的规则能覆盖 `:host`，覆盖不动内联声明；右下角 `.grip` 改卡片宽高，卡片改成 `display:flex;flex-direction:column`、`.fields` 变 `flex:1 1 auto;min-height:0`，于是拉高多出来的高度全部给了参数行。

**「参数全露」这条几何断言跟着改了基线。** 原来是 `max-height:58vh` + 15 行；17 行以后改成「卡片自然高度 + `max-height:88vh`」，900px 高的宿主里 17 行仍然 `scrollHeight === clientHeight`，验收行变成 `面板 17 行 全露`。这是量出来的、不是偏好：门禁真的比较 `scrollHeight > clientHeight + 1`，并且新卡「拉到 200px 以上还必须要滚」这一条——能拉大就等于没有借口。`tune-panel @1280` 因此多出四组断言：逐行/逐钮提示覆盖率与非零的 `title` 残留、悬停后气泡出现且落在视口内、拖表头后 `pos=free` 且 left/top 确实挪了 ≥100px 并写成内联、拉把手后卡片宽高都变大。

**其余同步项。** `types.ts` 新增 `BuildOrder` 与两个选项、`SwarmResult.seed`；`tune/snippet.ts` 的 `DEFAULT_CONFIG` 跟上（`order:'group'`、`seed:0`，导出的片段因此仍然只列与默认值不同的项）；面板里「随机种子」一行在顺序不是随机时灰掉并说明原因，验收为此专门走一遍这条依赖。场景数 18 → 20。

### 13.17 入口改名为创造者模式、悬浮球 logo、更多构建顺序的方案（2026-11-08）

用户两点：入口改名为「创造者模式」并设计一个 logo，形态是**可拖拽的悬浮球**；构建分布顺序「可以再多几种算法」，但方案由他先选。

**收起态从胶囊按钮换成一颗球。** `.fab`（`<i></i>调参`）改成 `.entry` = `.orb`（46×46、`border-radius:50%` 的石墨球，`radial-gradient(circle at 34% 26%, #3d3a32, var(--card) 60%)` 给出一枚高光）+ `.tag`（球下面一行「创造者模式」）。表头也跟着换主次：`<b>创造者模式</b><span class="sub">swarm-builder</span>`，原来正好相反。导出片段的头注释、`demos/tune.html` 的标题与撞名探针（`.fab` → `.orb`、`.tag`）、README 的目录锚点（`#调参面板创造者模式` → `#创造者模式`）一起跟上——名字改了，文档里不能还有三处叫旧名。

**logo 是自绘 SVG，不是图片文件。** 一枚光标停在虚线轨道上，轨道上还有三颗正在赶路的光标（一颗铜色领点 + 两颗灰阶同伴）：一群光标围着同一个点施工，这就是这个库在做的事。 viewBox 28、球面 29px，`aria-hidden` + 按钮自带 `aria-label="创造者模式"`。跑动时只有外面那圈轨道在缓慢自转（`animation:sb-orbit 3.6s linear`，`transform-box:view-box` + `transform-origin:14px 14px`，`prefers-reduced-motion` 下停转）。第一版把颜色写成 `fill="var(--ink)"` 这种 presentation attribute，Chrome 实测能解析（`rgb(236,234,223)`），但 WebKit 不支持在 attribute 里做 `var()` 替换，所以全部改成 `.orb .ring{stroke:…}` / `.arrow{fill:…}` 这类 CSS 规则——库要嵌进别人的页面，不能只在自己测过的浏览器里成立。

**球兼任两件事，靠 4px 阈值分开。** `bindDrag(handle, allowButtons)`：表头保持「落在按钮上就不拖」，球自己就是按钮，必须放开。`pointermove` 里先累计位移，满 4px 才判定为拖，并在真正开始拖时才 `preventDefault()`——早早在 `pointerdown` 上 `preventDefault` 会把兼容性鼠标事件一起取消，`click` 也跟着没了，球就再也点不开（这是这一批唯一一次「改完功能反而坏了」的坑）。拖动过程中 `data-dragging="true"` 让光标变 `grabbing`、把 hover 气泡收起来；松手记下 `draggedAt`，250ms 内的 click 忽略。位置仍然写成内联 `left/top`，钳制改成按元素实际宽高留 8px 边（原来是硬留 120px，球这种窄元素会被推到屏幕外半截）。

**验收新增的四条：** 球是正圆（`offsetWidth === offsetHeight` 且 `border-radius ≥ 半径`）、里面有 ≥3 个自绘图元、名字在球下和 `aria-label` 里都是「创造者模式」、往右下拖 190×150 后 `pos=free` 且**没有**顺手展开、轻点才展开；`.orb` 也进了 hover 提示覆盖率名单。拖拽方向是量出来的：这一步球贴在视口上沿（前一条断言刚把面板拖到 646,58），往左上拖立刻撞到 8px 钳位，实测只走 50px，断言就变成在测钳位而不是在测拖拽。轻点展开前要先等 300ms——面板用 250ms 内的事件窗口把「拖完紧接着的 click」判成拖的一部分，Playwright 的 click 紧跟着上一次 `mouse.up` 就会真的被吞掉，这不是测试的毛病，是同一个手势在 0ms 内确实分不开。

**这一批还纠了一个上一批的错口径。** `order-seed @1280` 原来卡「全局创建顺序前 1/4 中位 y → 后 1/4 中位 y 至少下移 400px」，实测 -416px 判红。指标本身站不住：6 条横带同时在盖，任何四分位都横跨整页。改成卡两条真实保证（见 §13.16 同一处的更正）。

**跑验收期间不要改 `src/`。** 门禁的 dev server 有文件监听，页面中途被整页重载，`[data-apply]` 那一局的进度直接归零，`waitPanelDone` 60s 超时报错——现象长得像功能坏了，实际是测试被自己打断。要么先跑完再改，要么改完重跑。

**更多构建顺序算法：方案已列给用户选，用户答「这些都进行」，实现见 §13.19。** 候选是竖带 `cols`（rows 的转置）、蛇形 `snake`（横带来回扫）、逐层 `depth`（按 DOM 深度，骨架先立起来）、径向 `radial`（由中心向外）、权重配额 `balance`（让所有光标同时收工，可叠加在任意空间顺序上）。`spiral`（由外向内）没做：它和 `radial` 只是把带子倒过来，同一个开关的一个方向已经够，多一个选项多一次验收。

### 13.18 悬浮球贴边展开会把按钮顶出视口（2026-11-08）

上一批的门禁最后一条红了：`tools/verify.mjs:1302` 点 `[data-copy]` 超时，Playwright 报的不是「找不到元素」而是 **element is outside of the viewport** —— 元素在、可点，只是在视口外面。原因不在测试：悬浮球本来就能拖到任意位置，而展开时卡片是从球那个位置**往下长**的（`max-height:88vh`），球贴在上半屏往下拖 150px 以后，208 + 792 > 900，底部的「应用并重跑 / 复制配置」整排落到了屏幕外。拖表头那一步没暴露它，是因为表头只允许在卡片已经展开时拖，钳制用的就是卡片宽高；球是收起态，钳制按 46px 的球算，展开以后就没人再管位置了。

**修的是面板，不是断言。** `setExpanded(true)` 之后补一次 `fitInView()`：只有 `data-pos="free"`（也就是被人拖过）才处理，读 `host.getBoundingClientRect()` 拿到展开后的真实尺寸，把 `left/top` 按 `[8, 视口 - 尺寸 - 8]` 夹回来。顺序是关键——先写 `dataset.open`，再读尺寸，再写样式：这三步都在同一帧的同步代码里，浏览器还没画，所以不会出现「先跳到底下再弹回来」的一帧闪烁。`box.width/height` 为 0 时直接返回，避免在还没布局的状态下把面板推到 0,0。

**门禁加了一条正向断言**（不是把坐标改回去绕开它）：拖到贴近下沿 → 轻点展开 → `[data-copy]` 的 `bottom ≤ innerHeight` 且 `right ≤ innerWidth`，实测 `拖球 657,58 → 836,208 · 展开后按钮底边 882 ≤ 视口 900`。同时把这条写进 README 与 CHANGELOG 的创造者模式条目，因为它属于「面板能在别人家页面上活下来」这一类承诺，和「位置写内联样式覆盖不动」是同一件事。

**这一批之后 20 个场景全绿**（`npm run verify` exit=0），消费端冒烟 `npm run verify:consumer` 也 PASS（包内 11/11 关键文件、ESM/CJS/tune 双入口、类型正反例、script 标签全局形状、创造者模式全局入口、真实页面 0 报错）。

### 13.19 五种分布顺序 + 等工时切带（2026-11-08）

用户对 §13.17 的方案回答「这些都进行」，于是 A `cols` / B `snake` / C `depth` / D `radial` / E `balance` 全做。`spiral`（由外向内）没做：它和 `radial` 只差把带子倒过来读，多一个选项多一套验收，不值。

**三个只有量出来才会发现的问题**，都是临时探针直接读 `Scheduler.agentQueues` 抓到的，不是看画面看出来的——画面在有 work stealing 的情况下会把分发错误遮掉：

1. **`cols` 的沟检测一开始在所有演示页上都是 1 块**，也就是永远退回横带。原因是页头、通栏容器这类 `width == 页宽` 的元素横跨左右两栏，它们一参与 x 区间合并，任何页面都会被压成一块。改法是统计沟之前先扔掉 `width > 页宽 60%` 的元素。改完 `dark-ui` 认出 4 块并真的按 x 切带（带间在 x 上不重叠），其余四页仍是 1 块、仍退回横带——单栏页按 x 切只是把同一行劈成两半，画面更乱。
2. **`snake` 第一版只 `reverse()` 奇数带，等于把一串按 y 排的项倒过来念**：带内顺序继承自切带用的 `centerY`，压根没有左右方向可言，「首尾 x 差正负交替」这条断言当场失败。改法是带内先按 `centerX` 排（tie-break 回 centerY），再反转奇数带；实测长页面首尾 x 差 `-577 336 -577 336 -382 336`，密集页 `-1196 932 -937 906 -881 819`，交替且幅度是页宽级。
3. **`balance` 第一版会让画面更不均匀**：按 `total/agentCount` 贪心收口，尾部 leftovers 全压进最后一条带，实测 landing rows `1.612→1.637`、simple rows `2.93→4.955`。换成 painters partition DP（最优连续划分，`splitPoints()`）之后一律变好：长页面 `1.959→1.102`、密集控制台 `1.252→1.034`、simple `2.93→1.123`、逐层在四张页面上 `3.14→1.13 / 1.90→1.08 / 2.82→1.20 / 9.68→1.23`。DP 的最优性顺带给了一个可断言的性质——等件数切带本身也是一种连续切带，所以 `spread(on) ≤ spread(off)` 恒成立，反过来一出现就是实现坏了。

**为什么均衡必须发生在「切」那一步，而不是装箱那一步。** 第一版把 balance 只接到 `lighten()`（LPT 装箱）上，于是七个 order 的散布 off 和 on 一模一样：带的条数正好等于光标数时，装箱只能决定「哪条带给谁」，而每条带有多重是切的时候就定死的，重排是恒等置换。改完后 `bands()` 与 `layers()` 都吃 `cost`，`lighten()` 只在单元数多于光标数时（`group` / `random`）起作用。工时直接复用估算器的 `itemCost(item, opts, item.x, item.y)`——把自己当自己的起点，位移项归零，剩下的就是与起点无关的那部分成本；包一层导出成 `itemWeight()`，排程和 `targetDuration` 用的还是同一个成本模型，没有第二套价目表。

**验收 `order-more @1280` 卡的是分发本身。** 观测点不是 DOM 出现顺序而是 `Scheduler.agentQueues`（纯函数，不受飞行时间和 work stealing 影响），逐条对上算法承诺：dark-ui 上 cols 的带在 x 上互不重叠且分布确实不同于 rows；长页面单栏无沟 → cols 的队列 id 序列与 rows 完全相同；snake 首尾 x 差正负交替；depth 每条队列的 `depth` 单调不减（骨架先于叶子）；radial 各队列到蓝图中心的半径中位数递增；balance 五空间顺序 × 两页全部 `on ≤ off` 且至少三组压平 >0.15。最后七种 order 在 simple 上各跑一遍真实施工，建成件数必须彼此相等（rows 那趟带着 balance），证明新分发没把谁卡死。

**这一批之后 21 个场景全绿**（新增 `order-more @1280`），消费端冒烟照旧 PASS。实测：`竖列（dark-ui 70 件）按 x 切带互不重叠=true`、`蛇形 首尾 x 差 -577 336 -577 336 -382 336`、`逐层 6 条队列深度单调=6/6`、`工时均衡 长页面 rows 1.96→1.10 · depth 3.14→1.13 · 多栏页 cols 1.55→1.12`、`跑完性 group/rows/cols/snake/depth/radial/random 全部 22/22`。

**顺手修掉一处会一直骗人的门禁常量。** `[simple|landing|dark-ui] @800` 报的是 `创造者模式面板只有 18 行参数`——断言写死了 17，而 §13.19 加了 `balance` 之后就是 18。这种过期常量只会用「失败」提醒人，改法是把期望值换成库自己给出的配置面：面板每行打上 `data-row-key`（控件那侧已经占了 `data-key`，`[data-key=…]` 若先命中 `<label>` 就会让 §13.13 那套写值 helper 全线静默失效，所以换了名字），门禁 `import('/src/tune/snippet.ts')` 取 `DEFAULT_CONFIG` 的键集，断言**每个配置键都有一行**、外加不滚动就看得全。以后再加参数，这条断言会在漏暴露的那一刻红，而不是在一个数字上红。


### 13.20 第一个模板改成产品说明页 + GitHub 入口 + 手机模式（2026-11-08）

用户四点：第一页换成「这个库自己的说明页」（功能、怎么用）、导航栏加一颗能跳仓库的 GitHub 图标、整体适配手机模式、全部预设默认开着音效与镜头跟随。

**第一页是这个项目自己。** `demos/home.html` 按真实产品页写：导航栏（自绘品牌标记 + 功能/怎么用/参数/边界四个锚点 + GitHub）、hero（版本 kicker、h1、两句 lead、`[data-replay]` 再盖一遍、6/7/18/0 四个计数）、六张功能卡、三步用法带代码块、参数速查表、五条已知边界、页脚写明「行为重新实现、未取上游源码」。它和其他案例走同一条链路，所以「能不能重建自己」不需要另外证明——`mockup-browser @1280` 直接报 `产品说明页: 178 项 · 完成 · 12.3s`。排序上只改一处：`CASES` 里 home 排第一，默认标签取 `CASES[0].key`，不再单抄一遍 key——「第一页 = 打开时看到的那一页」这件事由列表顺序保证，没有第二个真相来源。home 同时进了验收矩阵的 `PAGES`，拿到和其他页一样的两档宽度覆盖（媒体/复制/辅助线/面板行覆盖/无顶栏/零报错）。

**GitHub 入口只占一颗图标钮的宽度。** 顶栏已经很挤（后退/前进/重载 + 地址栏 + 创造者模式），所以外壳里是 27×27 的图标钮，文字标签留给 hover 与 `aria-label="GitHub 仓库：源码、Issue 与发行说明"`；说明页导航栏那条是图标 + "GitHub" 文字，因为那一行本来就宽。两处同一个 `href`，门禁卡 `href.startsWith('https://github.com/')` + `_blank` + `rel` 含 `noreferrer`（`target=_blank` 不带 `noreferrer` 会把 `window.opener` 交给对方页面）。

**手机模式定在 760 而不是 800。** 验收矩阵的 `@800` 一档锁的是建成数/媒体数/复制数，如果断点落在 800，那一档会突然变成手机版、所有期望值都要重量。760 既覆盖 390/414 这类真实手机宽度，又让 800 保持桌面版。规则写在各自的样式表里（选择器住在哪儿就改哪儿），`demo.css` 管案例页、`console.css` 管密集页、`tune.html` 管它自己那张教程页、`browser.css` 管外壳：多栏网格换单列、控制台与工作台把侧栏收到主列下面、代码块 `overflow-x:auto` 自己横滚、密集页那张 6 列提交表在窄屏隐掉中间三列（`nth-child(3/4/5)`）。外壳是标签条 `overflow-x:auto` + 隐藏滚动条、地址栏 `flex:1 1 100%` 单独换一行、红黄绿假灯省掉。实测 `壳: 文档 390/390 · 标签条 658/390（横滚）· 顶栏 73px`——标签条**必须**滚得起来，`scrollWidth > clientWidth` 在这里是正向断言：滚不起来就说明它把窗口撑宽了。

**施工中撑宽文档这件事有两个来源，都是量出来的不是看出来的。** 390 宽的 iframe 里，跑动途中 `documentElement.scrollWidth` 一度到 796~851px（多出一屏），现象是手机上闪一条横向滚动条。
1. 名字标签和尺寸徽章挂在光标锚点右侧（`left:14px/16px`），光标走到页面右边缘时它们伸到蓝图画框之外。修在 `CursorLayer`：handle 多带 `overhang`（`add()` 时量一次 `label.offsetWidth`，`setBadge()` 改写文本后重量 label/徽章的较大者——徽章在 `is-dragging` 之前是 `display:none`，量不到，所以先挂文本再量），`setPosition()` 每帧按 `x + LABEL_GAP + overhang > width` 决定 `data-flip`，CSS 用 `left:auto;right:14px` 把标签翻到左侧。判定靠缓存的宽度而不是每帧 `offsetWidth`，因为光标每帧都在动，读布局会把这一帧变成强制回流。
2. 翻完还剩 403px：箭头那枚 SVG 本身 17px 宽，贴边时照样出框。修在 `.sb-overlay` 加 `overflow-x:clip;overflow-clip-margin:4px`。**用 `clip` 不用 `hidden`**：`hidden` 会顺带把另一轴变成滚动容器（施工层本来只该裁不该滚），而 `clip` 永远不产生可滚动溢出；4px 余量是给带边框的 root 留的——画框按 padding box 算，比 border box 短一个左边框宽，不留余量会把贴着右边的元素裁掉一两个像素。改完每个采样点都是 `文档 390/390`，`施工中溢出: 说明页最多 0px · 密集页最多 0px`，门禁直接卡这个数（`> 1px` 判红）。

**面板在手机上要 18 行全露，靠按视口高度分档压缩——而且量的是壳里那个视口，不是屏幕。** `.card{max-height:88vh}` 的预算在 740 高宿主里放不下 18 行（每行之外还有表头/状态/脚注/按钮的固定开销），第一版只能滚动。加了两档 `@media (max-height:780px)`/`(max-height:620px)`，压的是行距与字号（表头、状态行、每行 padding、note、footer、util 依次收紧），不是把参数藏进滚动条里。独立页在 390×740 下测出 `参数 423/423`（`scrollHeight == clientHeight`，七页一致）、`面板右下 374/724`，看起来完事了——**但手机壳里那一屏根本不是 740**：mockup 浏览器自己要吃掉标签条 35 + 顶栏 73 + 状态栏 25，案例 iframe 只有 607px 高，88vh 就是 534，面板当场又开始滚动（`379/363`）。所以把第二档的门槛从 620 提到 660 并加大力度（行的上下留白直接归零、`.fields` 内边距 4→2、表头/状态/note/按钮排再各收几像素），实测壳里 `案例视口 607px 高 · 参数 339/339 · 卡片底边 591`，18 行连底部三颗按钮都在屏幕里。门禁不再只测独立页：`mobile @390` 现在也进壳里读 iframe 自己的 `innerHeight` 与 `.fields` 的 `scroll/client`，滚动一下就是红。这跟 §13.18 那条是同一路承诺：面板在别人家页面上要活下来，包括手机那么高的宿主——而「别人的宿主」最常见的形态就是这块 607px 的屏。

**预设统一开音效 + 跟随，七页逐个核对。** home/simple/console/landing/dark-ui/tall 的 `data-swarm` 与 tune.html 的 `initial` 都写上 `"sound":true,"tour":true`（tall 原先只有跟随，这轮补上音效；其余页两个都是新加的）。查的方式刻意不是读 HTML 字符串：门禁逐页打开案例，读面板上 `[data-key="sound"]`/`[data-key="tour"]` 两颗控件**真正打勾的状态**——字符串写了但没接进配置、或接进了但面板显示不一致，都算不过。七页输出 `音效=true 跟随=true`。

**顺手处理的两处小账。** `src/tune/panel.ts` 里「17 行 × 24px」那条注释在 §13.19 加了 `balance` 之后就是错的，改成 18 行；README 创造者模式那段原来写「宿主太矮才交给滚动条」，现在矮宿主是先压缩、压到极限才滚动，那句话跟着改。

**考虑过但没做：** 窄屏把面板自动收成悬浮球。看着省事，实际会顶掉一批「面板是开着的」这条前提的门禁断言，而且外壳每次接上一个案例都会按创造者模式开关调 `tuner.open()`，用户真想看的正是手机上那一屏参数——压缩行距能留住这个，藏进球里不能。

**这一批之后 24 个场景全绿**（矩阵从 8 格变 10 格：home 进 `PAGES`；新增 `mobile @390`），消费端冒烟照旧 PASS。home 两档宽度都量过：`@1280 完成 178 项 · 12.4s · 复制 14 · 辅助线 12`，`@800 完成 179 项 · 12.8s · 复制 12 · 辅助线 13`，于是 `EXPECTED_COPIES.home = 12`、`EXPECTED_GUIDES.home = 12` 取的是两档里的最小值——量出来的下限，不是拍脑袋的数。`mockup-browser @1280` 里第一屏就是它：`标签 home · 地址 https://swarm-builder.dev · 产品说明页 178 项 · 状态栏 done`。

---

**一句话目标：**  
做出一个“效果接近原版 Swarm Rebuild，使用方式接近轻量库”的高定制 Web 光标集群重建库，并优先服务网站进场特效与产品演示场景。