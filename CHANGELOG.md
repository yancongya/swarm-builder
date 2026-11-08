# Changelog

本项目的所有显著变更都记录在这里。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-08

首个版本：把「光标集群重建页面」从 Chrome 扩展的效果基准，重做成可嵌入任意网站的零依赖库。

### 新增

- 核心链路：Snapshot → Blueprint → 隔离层 → 调度器 → 多光标动作队列 → Go Live，全场单一 rAF 时钟
- 六类拆解：Rect / Text / Media（img、svg、canvas/video 截帧、污染降级）/ Duplicate（master + Option 拖拽盖章）/ Guide（对齐辅助线 + 吸附）/ 尺寸徽章与灰盒占位
- 配置面：`root` `agentCount` `speed` `targetDuration` `order` `balance` `seed` `performanceMode` `ignore` `maxItems` `duplicate` `maxCopies` `guides` `maxGuides` `grow` `sound` `flocking` `tour` `theme` `autoStart` 与三个回调
- 控制方法：`start` `pause` `resume` `isPaused` `setSpeed` `skip` `destroy`，另有 `mount()` 一步开局
- 定速进场：`targetDuration` 由队列估算器反推速度倍率；`performanceMode` 在拥挤页面自动裁剪，但裁剪名单里不含音效——音效按秒限量发声、不产生 DOM 节点，砍掉它省不到帧，只会让密集页面看起来像选项坏了
- 构建顺序可选，七套认领算法：`order: 'group'`（一棵子树一个光标，最快）/ `'rows'`（每个光标守一条横带，页面自上而下盖下来）/ `'cols'`（一条竖带一个光标，页面没有真的栏间沟时自动退回 `rows`）/ `'snake'`（横带 + 带内按 x 走、奇数带反着扫）/ `'depth'`（每个 DOM 深度内部再切带，外层骨架先亮、叶子后填）/ `'radial'`（按到蓝图中心的距离由内向外一圈圈）/ `'random'`（种子洗牌）；队列认领支持跨带借用，横带之间的依赖不会把光标卡死。`seed` 固定即可重放同一场施工，`SwarmResult.seed` 回显本局实际用的种子
- `balance: true` 把切带从「等件数」换成「等预估工时」，用的是最优连续划分（painters partition DP）：实测长页面 rows 的队列工时散布 1.96→1.10、逐层 3.14→1.13，密集控制台 1.25→1.03。因为是「所有连续切法里最平的一种」，开着永远不会比不开更差
- 坐标健壮性：`position: fixed` 源元素进独立视口钉定层，重建中滚动不漂移；容器边框与滚动偏移抵消
- 主题自适应：施工线墨色按页面底色判断明暗
- 创造者模式子入口 `swarm-builder/tune`：shadow DOM 悬浮面板，收起后的入口是一颗带自绘标记的悬浮球（石墨球体 + 铜色轨道与光标，跑动时轨道缓慢转）；18 项参数一屏全露；每一行、每一颗按钮、连那颗球都有自绘的 hover 提示（灰掉的行会把原因接在同一句话后面）；按住表头或悬浮球可挪位置、拽右下角把手可改大小，位置与尺寸写在内联样式里，宿主页面规则覆盖不动——移动满 4px 才判定为拖，所以拖完松手不会顺手展开；球贴着屏幕边展开时面板会按自身尺寸把位置夹回视口，底部按钮不会被顶出屏幕；待生效标记、依赖灰化并写明原因、进度条与阶段驱动的暂停/跳过可用性、重置与「恢复原状」，并可一键导出可粘贴配置片段
- 预览统一为一个铺满整屏的 mockup 浏览器窗口 `demos/index.html`：标签页切案例、假域名地址栏、前进/后退/重载、底部状态栏镜像面板进度；案例页不再有顶栏，参数只在创造者模式里改。视觉语言换成「石墨 + 铜」，外壳、面板、光标套色与施工线墨色一起走，不留旧的蓝色
- 第一页是本项目自己的产品说明页 `demos/home.html`：功能卡片、三步用法、参数速查表、已知边界与页脚出处，和其他案例走同一条重建链路（实测 178 项 / 12.4s，打开即看到它）；外壳顶栏与说明页导航栏各有一颗 GitHub 图标入口，`_blank` + `noreferrer`
- 手机模式：统一 `@media (max-width: 760px)` 一档，多栏网格换单列、控制台与工作台把侧栏收到主列下、代码块自己横滚；外壳标签条横滚、地址栏单独换行；创造者模式面板另按视口高度分档压缩行距，390×740 的独立页与壳里只剩 607px 高的案例视口都 18 行一屏全露
- 全部案例预设默认开着 `sound` 与 `tour`；窄屏施工不再把文档撑出横向滚动条（施工层 `overflow-x:clip` + 光标名字标签贴右边缘时翻到左侧）
- 真实规模密集案例 `demos/console.html`（415 个可重建项、页高 2018px）；长页面案例 `demos/tall.html`（实测页高 2767px，默认 `order: 'rows'` + `tour: true`，用来验证镜头真的跟着施工前沿往下走并在结束时交还页首）
- 完整 TypeScript 声明，正反例都有拦截用例

### 分发

- 三格式产物：ESM / CJS（`.cjs`）/ IIFE，样式由 JS 注入，单 script 可嵌入
- `exports` 双入口（`.` 与 `./tune`），`unpkg` / `jsdelivr` 指向 IIFE
- 许可协议定为 **MIT**
- `prepublishOnly` 门禁：typecheck → build → verify → verify:consumer；消费端冒烟真的 `npm pack` + 安装后按各入口跑一遍

### 验收

- Playwright 24 个场景：5 页（含产品说明页）× 2 宽度 + controls / fixed-scroll / ignore[] / sound（含密集页） / pace-perf / flocking / tour / theme / mockup-browser / tune-panel（含 hover 提示、拖拽、缩放） / order-seed / order-more / tall-tour / mobile（390 宽逐页量文档宽度，并采样施工中那一趟）
- 预设核对读的是面板上真正打勾的控件，不是 HTML 里那串 `data-swarm`——字符串写了但没接进配置也算不过；参数行覆盖率从 `DEFAULT_CONFIG` 反推，加参数忘了暴露会当场红