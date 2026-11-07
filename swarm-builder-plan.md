# Swarm Builder 成熟库改造计划（Agent 交接文档）

> 最后更新：2026-11-07  
> 状态：**MVP 垂直切片已跑通**（见 §13 实测记录），待补完整版能力  
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

- Media 支持
- Duplicate（master + 复制）
- Guide 辅助线与吸附
- 尺寸徽章、灰盒占位、内容淡入
- 动态光标数量（可选跟随滚动）
- 速度细分（typingSpeed / drawSpeed）
- 基础音效
- `pause` / `resume` / `setSpeed` / `destroy`
- `ignore` 选择器
- `maxItems` 限制

### 4.3 高级版（第三阶段）
目标：质感与产品化。

- Flocking 群聚物理
- Tour 模式
- 更完整音效编排
- 性能模式（auto/high/low）
- 进场特效快捷模式（目标时长自动算速度）
- 主题适配（深浅色）
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
- 效果参考原版，形态参考轻量库
- 配置驱动，默认值友好
- 表现与调度分离
- 可降级，可限流
- 尽量少侵入宿主页面

---

## 6. 建议配置项（API 形态参考）

> 仅定义能力，不给实现代码。

必要配置：
- `root`
- `agentCount` / `maxAgents` / `minAgents`
- `speed` / `typingSpeed` / `drawSpeed`
- `autoStart`
- `flocking`
- `followScroll`
- `showRulers`
- `sound`
- `ignore`
- `maxItems`
- `performanceMode`
- `onStart` / `onProgress` / `onComplete`

必要方法：
- `start()`
- `pause()`
- `resume()`
- `setSpeed()`
- `skip()`
- `destroy()`

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
- 测试页面清单（简单页 / 落地页 / 深色复杂 UI）

---

## 13. MVP 实测记录（2026-11-07）

代码位置：`src/`（core / render / tasks / api），测试页 `demos/`，验收脚本 `tools/verify.mjs`（Playwright，1280 与 800 两档宽度 × 三个页面）。

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

下一步优先级（据上述结论修正）：

1. **Media（先只做 img）**——现在重建结果里完全没有图片，真实站点一眼就发空；成本最低、观感收益最大。
2. **Duplicate**——卡片行/列表行是原版"集群感"的主要来源，签名分桶规则已明确，不动调度层。
3. **Guide + 吸附**——需要先把调度器从「树序 blocker」升级为「按 y 的 gate 传播」，否则辅助线出现时机不对；这一项和 `grow` 字号步进可以一起做。
4. 之后再补 `pause/resume/setSpeed/skip`、子树级 `ignore`、fixed 定位与重建中滚动的坐标修正。

---

**一句话目标：**  
做出一个“效果接近原版 Swarm Rebuild，使用方式接近轻量库”的高定制 Web 光标集群重建库，并优先服务网站进场特效与产品演示场景。