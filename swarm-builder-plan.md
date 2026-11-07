# Swarm Builder 成熟库改造计划（Agent 交接文档）

> 最后更新：2026-11-08  
> 状态：**全部批次完成**——完整版（批次 1–5）+ 高级版（定速、性能模式、Flocking、Tour、主题适配、README/API 文档）+ 预览壳页与真实规模案例（§13.11），验收 17 个场景全绿  
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

配置：`root`、`agentCount`、`speed`、`targetDuration`、`performanceMode`、`ignore`（string|string[]）、`maxItems`、`duplicate`、`maxCopies`、`guides`、`maxGuides`、`grow`、`sound`、`flocking`、`tour`、`theme`、`autoStart`、`onStart` / `onProgress` / `onComplete`
方法：`start()`、`pause()` / `resume()` / `isPaused`、`setSpeed()`、`skip()`、`destroy()`，另有 `mount(options)` 一步开局

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
- 测试页面清单（简单页 / 密集控制台 / 落地页 / 深色复杂 UI），由 `demos/index.html` 壳页统一切换

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

未决（需要人拍板，不是代码问题）：`package.json` 没有 `license` 字段。§10 锁的五项决策不含许可协议，而参考的 swarm-cursors 仓库本身没有授权，本仓库要公开发布就得先定自己的协议。

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


下一步优先级：

1. 全部计划内批次已完成；剩下的只有发布前的许可协议决策（§13.10）与真实页面上的肉眼验收（先在 `demos/index.html` 的密集控制台案例上开「跟随」看一遍）。


---

**一句话目标：**  
做出一个“效果接近原版 Swarm Rebuild，使用方式接近轻量库”的高定制 Web 光标集群重建库，并优先服务网站进场特效与产品演示场景。