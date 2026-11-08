# Changelog

本项目的所有显著变更都记录在这里。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-08

首个版本：把「光标集群重建页面」从 Chrome 扩展的效果基准，重做成可嵌入任意网站的零依赖库。

### 新增

- 核心链路：Snapshot → Blueprint → 隔离层 → 调度器 → 多光标动作队列 → Go Live，全场单一 rAF 时钟
- 六类拆解：Rect / Text / Media（img、svg、canvas/video 截帧、污染降级）/ Duplicate（master + Option 拖拽盖章）/ Guide（对齐辅助线 + 吸附）/ 尺寸徽章与灰盒占位
- 配置面：`root` `agentCount` `speed` `targetDuration` `performanceMode` `ignore` `maxItems` `duplicate` `maxCopies` `guides` `maxGuides` `grow` `sound` `flocking` `tour` `theme` `autoStart` 与三个回调
- 控制方法：`start` `pause` `resume` `isPaused` `setSpeed` `skip` `destroy`，另有 `mount()` 一步开局
- 定速进场：`targetDuration` 由队列估算器反推速度倍率；`performanceMode` 在拥挤页面自动裁剪
- 坐标健壮性：`position: fixed` 源元素进独立视口钉定层，重建中滚动不漂移；容器边框与滚动偏移抵消
- 主题自适应：施工线墨色按页面底色判断明暗
- 调参面板子入口 `swarm-builder/tune`：shadow DOM 悬浮面板，15 项参数一屏全露；待生效标记、依赖灰化并写明原因、进度条与阶段驱动的暂停/跳过可用性、重置与「恢复原状」，并可一键导出可粘贴配置片段
- 预览统一为一个 mockup 浏览器窗口 `demos/index.html`：标签页切案例、假域名地址栏、前进/后退/重载、底部状态栏镜像面板进度；案例页不再有顶栏，参数只在创造者模式里改
- 真实规模密集案例 `demos/console.html`（415 个可重建项、页高 2018px）
- 完整 TypeScript 声明，正反例都有拦截用例

### 分发

- 三格式产物：ESM / CJS（`.cjs`）/ IIFE，样式由 JS 注入，单 script 可嵌入
- `exports` 双入口（`.` 与 `./tune`），`unpkg` / `jsdelivr` 指向 IIFE
- 许可协议定为 **MIT**
- `prepublishOnly` 门禁：typecheck → build → verify → verify:consumer；消费端冒烟真的 `npm pack` + 安装后按各入口跑一遍

### 验收

- Playwright 18 个场景：4 页 × 2 宽度 + controls / fixed-scroll / ignore[] / sound / pace-perf / flocking / tour / theme / mockup-browser / tune-panel