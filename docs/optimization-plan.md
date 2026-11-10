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
| 创意 | 3.1 URL 分享这一局；3.2 配乐映射加深；3.3 光标性格；3.4 录制即内容 |

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
- [ ] 新选项 `hud?: boolean`（默认 `false`，不破坏现有宿主）。
- [ ] 开启时渲染：进度读数 + 可触摸的「跳过」chip + `needsScroll` 提示文案。
- [ ] 样式走 `styleRoot`（依赖 1.1），shadow 宿主同样可用。

验收：移动端视口 E2E——无键盘可跳过；活被锁住时提示出现、滚动后消失。

### 1.3 开场光标数自适应

问题：`INTRO_AGENTS = 18` 写死（`src/api.ts:47`），~21 项的小页面开场 18 只绕圈，真机反馈原话「页面不需要这么多鼠标」。

改动：
- [ ] 开场人数按蓝图条目数缩放：`min(18, max(3, ceil(items / 12)))`；`agents:'fixed'` 语义不变。

验收：simple 案例开场 ≤3 只；大页面（335 项）仍 18 只；种子回放不受影响。

### 1.4 minitool 子项目落地 + fork 收敛

问题：minitool/ 整个 untracked；`shell.ts`（33KB）是 `demos/browser.ts`（638 行）的手工 fork，今天已出现「母本修了外壳没修」的漂移。

改动：
- [ ] 1.1 完成后删减 shell 里的环境补丁层，量化 fork diff 面缩小。
- [ ] browser.ts 与 shell.ts 的共享逻辑抽公共模块（外壳骨架、案例挂载），容器差异留在适配层。
- [ ] minitool 正式 commit 进主仓（独立构建入口保留；`dist/`、zip 不入库，`.gitignore` 补 `minitool/dist/` 与 `*.zip` 规则）。

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

### 3.3 光标性格

- [ ] 用已有的 per-run rng 给每只光标抽：速度抖动、偏好任务类型、音色微调。
- [ ] 名字已有（`src/api.ts:31` NAMES），行为从「一群克隆」变「一个团队」；种子回放仍确定。

### 3.4 录制即内容

- [ ] `tools/relay-render.mjs` 扩展：无头浏览器录一局成 webm。
- [ ] 库自己生产小红书宣传素材——工具给自己做营销的闭环。

---

## 推进顺序

```
1.1 上游化 ──→ 1.4 fork 收敛 ──→ minitool 重新构建回归
   │
   ├─ 1.2 HUD（依赖 1.1 的 styleRoot）
   ├─ 1.3 开场自适应（独立，可随时插队）
   └─ 2.1 单测（viewBand 部分随 1.1 提前）
2.2 / 2.3 / 2.4 独立并行
3.1 → 3.2 / 3.3 / 3.4 按分发节奏挑
```

每批次交付 = 本地 commit + 本文档勾选更新；push/publish 单独确认。