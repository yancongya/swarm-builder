# swarm-builder 优化推进计划

> 源于 2026-11-10 全库分析（结构 / 维护 / 交互 / 创意四轴）与当天 minitool 真机调试的三个根因。
> 基线：HEAD `63186e2`，0.1.0 未发版（npm 账户恢复中）；minitool/ 已清理至 847KB / 25 文件，只留 2255 交付包。

## 四轴对照

分析的四轴结论全部落项；交互与创意不是没有，是此前没标轴名：

| 分析轴 | 落项 |
|---|---|
| 项目结构 | 1.4 minitool 落地 + fork 收敛；2.2 门禁拆分；2.4 仓库卫生 |
| 维护 | 1.1 环境假设上游化；2.1 单测；2.3 CI |
| 交互设计 | 1.2 极简 HUD（触摸跳过 + needsScroll 画面化）；1.3 开场光标数自适应 |
| 创意 | 3.1 URL 分享这一局；3.2 配乐映射加深；3.3 光标性格；3.4 录制即内容；3.5–3.9 鼠标创意六条中的后五条 |

交互两条是真机暴露的真缺口，提进 P0 随阶段一执行；创意四条排 P2 阶段三，按分发节奏挑（3.1 最先）。

## 硬约束

- 所有批次只做本地 commit；`git push` 与 `npm publish` 每次单独等用户确认（发布冻结）。
- npm publish 另等账户恢复（2FA 工单重置，无有效登录态）。
- 阶段一会打破 minitool 打包批次「母本 src/demos 零 diff」的临时约束——上游化完成后 minitool 需重新构建并全量回归。

---

## 阶段一：上游化与真缺口（P0）

### 1.1 shadow DOM / 滚动环境假设上游化

三个真机 bug 的根因都在主库的环境假设，补丁却全打在 minitool fork 上：

| 根因 | 位置 | 真机症状 |
|---|---|---|
| `injectStyle()` 写死 `document.head` | `src/render/styles.ts:55-59` | shadow 宿主里样式全失效，构建不可见 |
| `detectEnv` 沿 `parentElement` 找滚动者 | `src/core/scan.ts:72` | 遇 ShadowRoot 断链，预扫描/镜头空转 |
| `viewBand` 按窗口顶算前沿 | `src/core/scan.ts:41-46` | 滚动层被 chrome 垫高时差 1.9px，光标永不收走 |

改动：
- [x] `SwarmBuilderOptions` 加 `styleRoot?: Document | ShadowRoot`（默认 `document`），`injectStyle` 注入目标可选。
- [x] `detectEnv` 祖先遍历改走 `parentNode` + `host`，跨 shadow 边界不断链。
- [x] `viewBand` 量 scroller 的实际可见矩形（`getBoundingClientRect`），不再假设滚动层顶 = 窗口顶。
- [x] 同步补 `viewBand` 几何单测（从 2.1 提前）：mock 矩形覆盖「滚动层被垫高」回归，抓住 1.9px 死锁。

验收：新增 shadow 宿主 E2E 案例全绿；minitool 三层补丁（`style[data-sb-lib]` 抄写、`.case-scroll` 注入、`--sb-chrome-pad`）可删减。
依赖：无。做完解锁 1.4。

### 1.2 可选极简 HUD（移动端逃生门）

问题：Esc/M 是键盘专属（`src/api.ts:746`），overlay `pointer-events:none`——手机读者想跳过只能干等；`needsScroll`（`src/api.ts:692`）有状态出口没画面，每个宿主都得重画「scroll to keep building」。

改动：
- [x] 新选项 `hud?: boolean`（默认 `false`，不破坏现有宿主）。
- [x] 开启时渲染：进度读数 + 可触摸的「跳过」chip + `needsScroll` 提示文案。
- [x] 样式走 `styleRoot`（依赖 1.1），shadow 宿主同样可用。

验收：移动端视口 E2E——无键盘可跳过；活被锁住时提示出现、滚动后消失。

### 1.3 开场光标数自适应

问题：`INTRO_AGENTS = 18` 写死（`src/api.ts:47`），~21 项的小页面开场 18 只绕圈，真机反馈原话「页面不需要这么多鼠标」。

改动：
- [x] 开场人数按蓝图条目数缩放：`min(18, max(3, ceil(items / 12)))`；`agents:'fixed'` 语义不变。

验收：simple 案例开场 ≤3 只；大页面（335 项）仍 18 只；种子回放不受影响。

### 1.4 minitool 子项目落地 + fork 收敛

问题：minitool/ 整个 untracked；`shell.ts`（33KB）是 `demos/browser.ts`（638 行）的手工 fork，今天已出现「母本修了外壳没修」的漂移。

改动：
- [x] 1.1 完成后删减 shell 里的环境补丁层，量化 fork diff 面缩小。
      删减量化：shell.ts 742→718 行、shell-extra.css 90→79 行；`.case-scroll` 注入层、
      `style[data-sb-lib]` 抄写、`--sb-chrome-pad` 垫高三块全删，改走库的 `styleRoot`
      （tune 透传）与「viewport 即滚动容器」（detectEnv 跨 shadow + viewBand 实测矩形）。
- [x] browser.ts 与 shell.ts 的共享逻辑抽公共模块（外壳骨架、案例挂载），容器差异留在适配层。
      收敛量化：新增 `demos/shell-core.ts`（341 行：案例元数据、标签条、历史栈、空白页、
      地址校验、创造者钮、`__browser` 吊钩，经 hooks 注入容器差异）；browser.ts 638→389 行、
      shell.ts 718→472 行。母本留 iframe 抓取/重建链路，容器留 shadow 挂载/离线提示/
      pre-build 进场态；两壳各自冒烟全绿（主 verify + minitool gate/smoke）。
- [x] minitool 正式 commit 进主仓（独立构建入口保留；`dist/`、zip 不入库，`.gitignore` 补 `minitool/dist/` 与 `*.zip` 规则）。

验收：git 跟踪 minitool 源码与构建链；两壳共享模块后各自案例冒烟全绿。
依赖：1.1。

---

## 阶段二：维护基建（P1）

### 2.1 纯逻辑单元测试

- [x] 引入 vitest（devDeps 现仅 3 个，成本低）。
- [ ] 覆盖：scheduler 切带/定价、estimate 反推、rng 种子回放、viewBand 几何（1.1 已提前补）。
- [ ] `npm test` 纳入 `prepublishOnly`。

理由：今天 1.9px 死锁全靠真机才暴露；纯函数带 mock 矩形的单测能在本地抓住。

### 2.2 verify.mjs 拆分

- [ ] 2850 行单体 → 断言库 + 各场景脚本（home/simple/landing/dark-ui/cdn）。
- [ ] 与 minitool `build/smoke.mjs` 共享断言 helpers，结束两套门禁零共享的现状。

### 2.3 CI

- [ ] `.github/workflows/ci.yml`：PR 触发 typecheck + build + verify + consumer。
- [ ] 不含任何 push/publish 步骤（冻结约束）。

### 2.4 仓库卫生

- [ ] `swarm-builder-plan.md`（821 行历史规划）挪入 `docs/`。
- [ ] 根目录 `.verify-run*.log` / `.dev-run.log` 定期清理（已 gitignore，只占磁盘）。
- [x] minitool 探针截图 16 张、历史 zip 3 个、根目录孤儿 `build/` 已清（2026-11-10，2.1MB → 847KB）。

---

## 阶段三：创意（P2）

### 3.1 URL hash 分享「这一局」

- [ ] config + seed 编码进 URL hash，demo 壳读 hash 开局（`loadPreset` 在 `demos/browser.ts:339` 已有基础）。
- [ ] 验收：把链接发给别人，打开 = 同一局确定性回放。直接服务小红书分发。

### 3.2 配乐映射加深

- [ ] theme → 调式（暗页小调 / 亮页大调）；order → 节奏型（snake 摇摆 / radial 琶音）。
- [ ] 只动 `src/core/score.ts` 的 ScoreBus，不碰引擎。现有「面积→八度、x→音级」保留。

### 3.3 光标性格（看得见的那种）

2026-11-11 用户拍板「都实现」的六条鼠标创意之一；性格不只改节奏，还要看得见。

- [x] 用已有的 per-run rng 给每只光标抽一个性格：急性子（赶路打字都快、身后速度线）、强迫症（按部就班、校准环）、摸鱼中（慢半拍、闲久了冒「…」）、稳当当（旧统一节奏）。
- [x] 只拧施工层 move/type 时钟 + 外观配件，不碰待时轨道场与避让（flocking 门禁那张考卷钉 `personality:false`）。
- [x] 新选项 `personality?: boolean`（默认 true）；关掉全员稳当当、一个随机数都不抽。面板「光标」页加行，双语齐全。
- [x] 验收：personality 场景——同种子同一支队伍、换种子变、配件与性格一一对应、关掉全稳当当；单测覆盖抽卡确定性与倍率方向。

### 3.4 录制即内容

- [ ] `tools/relay-render.mjs` 扩展：无头浏览器录一局成 webm。
- [ ] 库自己生产小红书宣传素材——工具给自己做营销的闭环。

### 3.5 交接仪式（创意 2）

- [ ] 两只光标一前一后收同一件附近的活（90px 内相遇）时，中点冒一记火花/击掌，纯 CSS 动画自删。
- [ ] 不改任何物理：避让门禁钉的是轨道场，交接只是施工完成事件上的装饰；成对冷却防刷屏。
- [ ] 验收：交接场景数到火花、无 data-item 污染、暂停时不推进。

### 3.6 观众是总监（创意 3）

- [ ] 新选项 `director?: boolean`（默认 true）：施工期间光标可点——点一下 = 催工（短暂提速 + 光环），拖走 = 改派（松手后优先领落点附近的活）。
- [ ] 不碰「重建盒子不可交互」铁律：指针只落在 .sb-cursor 上；暂停/聚群/收工后不接管。
- [ ] 验收：点催能测到提速窗口，拖派后该光标下一件落在落点附近；关掉选项则光标不可点。

### 3.7 竣工印章（创意 4）

- [ ] 新选项 `stamps?: boolean`（默认 true）：每件竣工角落盖一只光标的名章（首字母 + 专属色），复制盖章的消耗件也盖。
- [ ] 自己的类 .sb-stamp，不占 ⌥ 徽章计数；密集页自动性能模式关掉。
- [ ] 验收：印章数 = 建成件数（辅助线除外）、⌥ 徽章峰值不变、双语名牌。

### 3.8 班组名片（创意 5）

- [ ] 收工时把这一局画成一张可分享卡片：名字、性格、件数、MVP、用时、种子；零依赖 canvas。
- [ ] 面板工具条加「班组名片」钮，卡片以 dataURL 内联展示——库内不出现 a[download]/剪贴板读取（minitool 门禁）。
- [ ] 验收：名片出图含全部参建光标、MVP 是件数最多那只、种子与完成状态一致；gate 全绿。

### 3.9 开场点名（创意 6）

- [x] 聚群那几秒挂一条「领班 X · N 人到齐」，名牌按进场顺序逐个弹一下；开工那一帧拆掉。
- [x] 纯装饰：不加减光标、不改聚群时长与开场人数语义（1.3 的考卷不动）。
- [x] 验收：personality 场景顺带断言——聚群时领班牌在、全员名牌弹、开工后消失；关掉性格点名仍在。

---

## 推进顺序

```
1.1 上游化 ──→ 1.4 fork 收敛 ──→ minitool 重新构建回归
   │
   ├─ 1.2 HUD（依赖 1.1 的 styleRoot）
   ├─ 1.3 开场自适应（独立，可随时插队）
   └─ 2.1 单测（viewBand 部分随 1.1 提前）
2.2 / 2.3 / 2.4 独立并行
3.1 → 3.2 / 3.4 按分发节奏挑
鼠标创意六条（2026-11-11「都实现」）：A=3.3+3.9 → B=3.5+3.7 → 3.6 → C=3.8，逐批 commit
```

每批次交付 = 本地 commit + 本文档勾选更新；push/publish 单独确认。