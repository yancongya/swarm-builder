import { DEFAULT_CONFIG, type PlainConfig } from './snippet';
import { localize, phrase, type Lang } from './locale';

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

interface Field {
  key: keyof PlainConfig;
  label: string;
  kind: 'range' | 'number' | 'check' | 'select' | 'text';
  hint: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: [string, string][];
  placeholder?: string;
  /** 'replica' 的行折在分组里，默认收起——它们把面板从 18 行撑到 27 行，
     而手机那一档要求参数列表不出滚动条。 */
  group?: 'core' | 'replica';
  /** Disabled while this predicate holds, with `why` shown as the row's tooltip. */
  offWhen?: (config: PlainConfig) => boolean;
  why?: string;
}

const FIELDS: Field[] = [
  { key: 'agentCount', label: '光标数量', kind: 'range', min: 1, max: 24, step: 1, hint: '同时施工的光标数。越多越快，画面也越吵。' },
  {
    key: 'order', label: '构建顺序', kind: 'select',
    hint: '光标怎么认领这一页。子树并行一栋楼一个人最快；自上而下每条横带一个光标；竖列与它转置；蛇形是横带来回扫；逐层先骨架后填肉；由内向外从页面中心扩散；随机打散认领顺序，配合种子可复现。',
    choices: [
      ['group', '子树并行'],
      ['rows', '自上而下'],
      ['cols', '竖列'],
      ['snake', '蛇形层扫'],
      ['depth', '逐层（骨架先行）'],
      ['radial', '由内向外'],
      ['random', '随机'],
    ],
  },
  {
    key: 'balance', label: '工时均衡', kind: 'check',
    hint: '默认按「件数」把页面切成等大的带，密集的那条带就会比稀疏的厚一倍。打开后改成按预估工时切等分，几个光标差不多同时收工，不会出现五个停下来等一个收尾。它只改带多长，不改朝哪个方向扫。',
  },
  {
    key: 'seed', label: '随机种子', kind: 'number', min: 0, max: 2147483647, step: 1,
    hint: '只在「随机」下参与排程。0 = 每开一局现抽一个新顺序；填同一个数就能重放同一场施工，完成状态里会回显实际用的种子。',
    offWhen: (c) => c.order !== 'random', why: '「构建顺序」不是随机，这个数不参与排程。',
  },
  {
    key: 'speed', label: '速度', kind: 'range', min: 0.25, max: 8, step: 0.25,
    hint: '全局时间倍率。未设目标时长时，运行中拖动立即生效。',
    offWhen: (c) => (c.targetDuration ?? 0) > 0,
    why: '已设目标时长，倍率由估算器接管。把目标时长改回 0 才能手调速度。',
  },
  { key: 'targetDuration', label: '目标时长', kind: 'number', min: 0, max: 120, step: 1, hint: '秒。0 = 自然节奏；填了就会覆盖速度，由估算器反推倍率。' },
  { key: 'maxItems', label: '条目上限', kind: 'number', min: 1, max: 5000, step: 50, hint: '蓝图条目上限，超出的计入「丢弃」。长页面先看这个数。' },
  { key: 'duplicate', label: '复制盖章', kind: 'check', hint: '重复的兄弟节点只真做一个，其余用 Option 拖拽盖章。' },
  {
    key: 'maxCopies', label: '每组复制', kind: 'number', min: 1, max: 48, step: 1, hint: '每组重复最多盖几个。',
    offWhen: (c) => !c.duplicate, why: '「复制盖章」已关，这个数不参与施工。',
  },
  { key: 'guides', label: '辅助线', kind: 'check', hint: '画出布局本来就存在的对齐辅助线。' },
  {
    key: 'maxGuides', label: '辅助线数', kind: 'number', min: 0, max: 64, step: 1, hint: '每次运行的辅助线数量。',
    offWhen: (c) => !c.guides, why: '「辅助线」已关，这个数不参与施工。',
  },
  { key: 'grow', label: '标题步进', kind: 'check', hint: '大标题一边打字一边长到真实字号。' },
  { key: 'flocking', label: '光标避让', kind: 'check', hint: '光标在途中互相绕行。' },
  { key: 'tour', label: '镜头跟随', kind: 'check', hint: '滚动跟着施工前沿走，结束交还页首。页面比视口高时打开，配「自上而下」最自然。' },
  { key: 'sound', label: '音效', kind: 'check', hint: '合成音效，无音频文件。浏览器要求页面已有用户手势。' },
  {
    key: 'theme', label: '施工线色', kind: 'select', hint: 'auto 按页面底色判断明暗。',
    choices: [['auto', '跟随页面'], ['light', '浅色'], ['dark', '深色']],
  },
  {
    key: 'performanceMode', label: '性能模式', kind: 'select', hint: 'auto 在容器内元素超过 250 时关掉辅助线与标题步进并压低复制数；音效不受影响，它只按秒限量发声，不产生 DOM 节点。',
    choices: [['auto', '自动'], ['high', '完整'], ['low', '精简']],
  },
  { key: 'ignore', label: '跳过', kind: 'text', placeholder: '.ad, #chat-widget', hint: '逗号分隔的 CSS 选择器，命中的元素连同子树整块跳过。' },

  // 下面九项是把两套参考实现的方法逐项还原进来的开关，全部默认关：关着的时候
  // 运行算法与上面那十八项一模一样，不多一个光标、不多一声配乐，也不碰读者的滚动位置。
  {
    key: 'flight', label: '待时飞行', kind: 'select', group: 'replica',
    hint: '光标没活的时候干什么。停在落点 = 就停在最后一笔的位置，和以前一样。待时飞行 = 复刻扩展那套速度积分：绕着一圈会呼吸的轨道环（135px，±18%）转，切向推力有个 tanh 慢周期会正反两向扫，径向弹簧夹在 -2600 到 1400，每个光标自带轨道偏心、自转系数与旋度，90px 内的邻居速度按 0.7 比 0.3 合进来；箭头朝行进方向偏，按下时压扁。施工中的那一只归任务管，轨道场不插手。',
    choices: [['idle', '停在落点'], ['live', '待时飞行']],
  },
  {
    key: 'pointer', label: '真实鼠标', kind: 'select', group: 'replica',
    hint: '读者的鼠标算什么。忽略 = swarm 不管他。当圆心 = 轨道绕着鼠标转。排斥 = 鼠标周围 48px 把光标顶出去，正撞进去时再补一记 260 的冲量。两种都只在「待时飞行」开着时有效，因为鼠标位置只有轨道场会读。',
    choices: [['ignore', '忽略'], ['follow', '当圆心'], ['repel', '排斥']],
    offWhen: (c) => c.flight !== 'live', why: '「待时飞行」没开，轨道场不在时钟里，鼠标位置没人读。',
  },
  {
    key: 'agents', label: '动态班组', kind: 'select', group: 'replica',
    hint: '人数归谁定。固定 = 就「光标数量」那几个，各自的带干完就收起。自动 = 那个数变成下限、48 是上限，滚动越快（每 40px/s 多一个）以及能领的活越多（每 2 件多一个）人就越多，最多每 35ms 从画面外进来一个，干过活又闲了 2.5 秒的临时工自己退场。',
    choices: [['fixed', '固定人数'], ['auto', '自动增减']],
  },
  {
    key: 'pick', label: '认领方式', kind: 'select', group: 'replica',
    hint: '活怎么到手。按队列 = 开局就按「构建顺序」每人切一条带，只在自己的带里领，抢也只在这堆里找。运行时挑 = 整页一个池子，每次空手都按参考实现的代价现挑：不在这一屏的先付一百万，带外的纵向距离乘 0.6，离自己纵向多远乘 0.4，参考线反方向优惠 50 万——于是永远是「眼前这屏从上往下」，人追着活跑而不是守着一条带。',
    choices: [['queued', '按队列认领'], ['live', '运行时挑']],
  },
  {
    key: 'trigger', label: '逐段解锁', kind: 'select', group: 'replica',
    hint: '什么时候允许领某一件。第一帧全放 = 整页从开局就是敞开的。随滚动 = 只有顶边越过「这一屏往下 88% 那条线」的元素才算到了，前沿只降不升，所以构建跟着读者往下走。要么开「镜头跟随」，要么宿主页面自己会滚，否则滚不到的那半页永远不解锁。',
    choices: [['immediate', '第一帧全放'], ['scroll', '随滚动解锁']],
  },
  {
    key: 'adaptiveSpeed', label: '积压提速', kind: 'check', group: 'replica',
    hint: '活堆得越多时钟走得越快：每帧按「已解锁还没人领」的件数重算倍速，等于当前基准乘 min(1 + 积压 × 0.45, 4)，最多到 4 倍。开了以后「速度」和「目标时长」就不是定论而是地面值，dense 页面收尾会明显快于估算。',
  },
  {
    key: 'scan', label: '采集方式', kind: 'select', group: 'replica',
    hint: '采蓝图之前先看多少页。单次 = 同步走一遍 DOM，现在排得出什么就建什么。预滚动 = 参考扩展的那一遍：先等字体和图片（各有上限），再找出这页真正靠谁滚（后台壳那种 main 自己 overflow:auto 的，滚窗口一格都不动），往下走最多 28 屏把懒加载和 content-visibility 的内容逼出来，回顶、落定，然后才采。第三方页面建出来缺图、看不出有多长，就是这个开关还关着。',
    choices: [['single', '单次采集'], ['pre-scroll', '预滚动采集']],
  },
  {
    key: 'score', label: '配乐', kind: 'select', group: 'replica',
    hint: '音效开着的时候放什么。不出旋律 = 只有合成的按键、拉框、盖章三声。生成式 = 复刻那套配器：104 BPM 的十六分格，E 小调五声从 MIDI 40 起，玻璃钢琴音色叠了一根 2.756 的不谐和泛音，盒子面积定音区、横向位置定音级，一个八分槽只许一个音、同时最多 28 个声部，混响是现算的 3.2 秒脉冲，声像跟着光标走，收尾一记 E 大调 add9 扫弦。',
    choices: [['off', '不出旋律'], ['generative', '生成式配乐']],
    offWhen: (c) => !c.sound, why: '「音效」没开，配乐没有出口。',
  },
  {
    key: 'reducedMotion', label: '减少动效', kind: 'select', group: 'replica',
    hint: '读者勾了 prefers-reduced-motion: reduce 时怎么办。照跑 = 这是装饰不是视差陷阱，宿主既然调了库就演给他看。直接交还 = 参考库自己的规则，什么都不演，立刻报完成把真页面还回去。',
    choices: [['run', '照跑'], ['skip', '直接交还']],
  },
];

/** 分组折叠的那几行：全默认关，所以平时收着，展开与否不改变正在跑的那一局。 */
const REPLICA = FIELDS.filter((field) => field.group === 'replica');

/** 悬浮球的标记：一枚光标停在轨道上，轨道上还有三颗正在赶路的光标——一群光标围着同一个点施工。
    颜色走 CSS 规则而不是 fill="var(--x)"：presentation attribute 里的 var() 在 WebKit 上不生效。 */
const LOGO = `<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
<circle class="ring" cx="14" cy="14" r="9.6" fill="none" stroke-width="1.1" stroke-dasharray="2.4 3.6" stroke-linecap="round"/>
<path class="arrow" d="M11 7.4 11 19.2 14.4 15.9 16.5 20.4 18.8 19.3 16.7 15 20.6 14.6Z"/>
<circle class="lead" cx="14" cy="4.4" r="1.7"/>
<circle class="mate" cx="23.2" cy="16.8" r="1.3"/>
<circle class="mate far" cx="5.4" cy="18.4" r="1.1"/>
</svg>`;

const CSS = `
:host{position:fixed;z-index:2147483646;
  /* 与 demos/browser.css 的 :root 同一套「石墨 + 铜」：外壳换了面板不换就会露馅。 */
  --card:#232220;--line:#302e29;--ink:#eceadf;--dim:#9c9689;
  --accent:#c9793c;--on-accent:#1a1206;--well:#1a1917}
/* Outer-page rules beat :host, and inherited props flow in from the host element,
   so the type reset lives on inner nodes the page's selectors cannot reach. */
.card,.entry,.orb,.tag{font:12px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;letter-spacing:normal;
  text-transform:none;text-align:left;color:var(--ink)}
:host([data-pos="bottom-right"]){right:16px;bottom:16px}
:host([data-pos="bottom-left"]){left:16px;bottom:16px}
:host([data-pos="top-right"]){right:16px;top:16px}
:host([data-pos="top-left"]){left:16px;top:16px}
*{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer}
/* 收起状态只剩一颗悬浮球：球体是石墨，轨道与光标是铜，转起来的只有外面那圈轨道。 */
.entry{display:grid;justify-items:center;gap:5px;user-select:none;touch-action:none}
.orb{display:grid;place-items:center;width:46px;height:46px;padding:0;border:1px solid var(--line);
  border-radius:50%;color:var(--ink);cursor:grab;touch-action:none;
  background:radial-gradient(circle at 34% 26%,#3d3a32,var(--card) 60%);
  box-shadow:0 10px 26px rgba(0,0,0,.34),inset 0 1px 0 rgba(236,234,223,.08)}
.orb:hover{border-color:var(--accent)}
.orb svg{width:29px;height:29px;display:block}
.orb .ring{stroke:var(--accent);stroke-opacity:.6;transform-box:view-box;transform-origin:14px 14px}
.orb .arrow{fill:var(--ink)}
.orb .lead{fill:var(--accent)}
.orb .mate{fill:var(--ink);fill-opacity:.6}
.orb .far{fill-opacity:.4}
:host([data-phase="running"]) .orb .ring{animation:sb-orbit 3.6s linear infinite}
:host([data-phase="paused"]) .orb{opacity:.72}
@keyframes sb-orbit{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){:host([data-phase="running"]) .orb .ring{animation:none}}
.tag{padding:2px 8px;border:1px solid var(--line);border-radius:999px;background:var(--card);
  color:var(--dim);font-size:10px;white-space:nowrap}
.entry:hover .tag{color:var(--ink);border-color:var(--accent)}
.card{position:relative;width:298px;max-width:calc(100vw - 32px);max-height:88vh;display:flex;flex-direction:column;
  border:1px solid var(--line);border-radius:12px;
  background:var(--card);color:var(--ink);box-shadow:0 14px 40px rgba(0,0,0,.4);overflow:hidden}
.card>*{flex:0 0 auto}
:host([data-open="false"]) .card{display:none}
:host([data-open="true"]) .entry{display:none}
:host([data-dragging="true"]) .orb,:host([data-dragging="true"]) header{cursor:grabbing}
header{display:flex;align-items:center;gap:6px;padding:9px 10px;border-bottom:1px solid var(--line)}
header b{font-size:12px;letter-spacing:.01em}
header .sub{color:var(--dim);font-size:11px}
header .sp{flex:1}
.icon{width:20px;height:20px;border:1px solid var(--line);border-radius:6px;background:transparent;
  color:var(--dim);line-height:1;padding:0}
.icon:hover{color:var(--ink);border-color:var(--accent)}
.status{margin:0;padding:7px 10px 6px;color:var(--dim);font-size:11px;
  font-variant-numeric:tabular-nums;min-height:28px}
.meter{height:2px;background:var(--well);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--accent);transition:width .18s linear}
:host([data-phase="idle"]) .meter i{background:var(--line)}
/* 18 行 × 24px 加表头表脚约 580px。矮宿主先按下面的高度分档压缩行距，把 18 行留在
   一屏里；压到极限还装不下才交给这根滚动条——滚动条必须看得见，不然参数等于没暴露。
   拖动右下角的把手可以把面板拉高，滚动条随之消失。 */
.fields{flex:1 1 auto;min-height:0;padding:4px 10px;overflow-y:auto;border-top:1px solid var(--line);scrollbar-width:thin}
.fields::-webkit-scrollbar{width:8px}
.fields::-webkit-scrollbar-thumb{background:#3d3a33;border-radius:8px}
/* 复刻开关默认收起：面板在手机上不许出滚动条，而这九项全默认关，平时没人动。
   展开以后交给 .fields 自己的滚动条——那是读者自己要点开的深度，不是默认状态。 */
.fields[data-replica="closed"] .row[data-group="replica"]{display:none}
.group{display:flex;align-items:center;gap:6px;width:100%;margin:3px 0;padding:4px 7px;
  border:1px dashed var(--line);border-radius:7px;background:transparent;color:var(--dim);
  font-size:11px;text-align:left;cursor:pointer}
.group:hover{color:var(--ink);border-color:var(--accent)}
.group::before{content:"▸";flex:0 0 auto;color:var(--accent)}
.fields[data-replica="open"] .group::before{content:"▾"}
.row{display:flex;align-items:center;gap:8px;padding:2px 0}
.row .k{flex:0 0 74px;color:var(--dim)}
.row .v{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
.row:hover .k{color:var(--ink)}
.row[data-dirty="true"] .k{color:var(--accent)}
.row[data-dirty="true"] .k::after{content:"·";margin-left:3px;font-weight:700}
.row[data-off="true"]{opacity:.4}
.row[data-off="true"] .k{color:var(--dim)}
input:disabled,select:disabled{cursor:not-allowed}
input[type=range]{flex:1;min-width:0;accent-color:var(--accent);height:16px}
output{flex:0 0 34px;text-align:right;color:var(--ink);font-variant-numeric:tabular-nums}
input[type=number]{width:64px}
input[type=text]{width:100%}
input[type=number],input[type=text],select{padding:2px 5px;border:1px solid var(--line);border-radius:6px;
  background:var(--well);color:var(--ink);font:inherit;min-width:0}
select{flex:1}
input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;margin:0}
.note{margin:0;padding:7px 10px;color:var(--dim);font-size:11px;border-top:1px solid var(--line);min-height:29px}
.note[data-pending="true"]{color:var(--accent)}
footer{display:flex;gap:6px;padding:9px 10px;border-top:1px solid var(--line);flex-wrap:wrap}
footer button{padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--well);color:var(--ink)}
footer button:hover:not(:disabled){border-color:var(--accent)}
footer button:disabled{opacity:.4;cursor:not-allowed}
footer .primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600;flex:1}
footer .primary:hover{filter:brightness(1.08)}
.util{display:flex;gap:6px;padding:0 10px 9px}
.util button{flex:1;padding:4px 6px;border:1px solid var(--line);border-radius:7px;background:transparent;
  color:var(--dim);font-size:11px}
.util button:hover{color:var(--ink);border-color:var(--accent)}
.code{display:block;width:calc(100% - 20px);margin:0 10px 10px;height:132px;resize:vertical;
  padding:7px;border:1px solid var(--line);border-radius:7px;background:var(--well);color:#d8d2c4;
  font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}
.code[hidden]{display:none}
/* 悬停提示自己画：原生 title 要等一秒、字号配色都不受控，而这一版要「每个参数都有提示」。 */
.tip{position:fixed;z-index:3;left:0;top:0;max-width:236px;padding:6px 8px;border:1px solid var(--line);
  border-radius:8px;background:var(--well);color:var(--ink);font-size:11px;line-height:1.45;
  box-shadow:0 10px 26px rgba(0,0,0,.45);pointer-events:none;opacity:0;transform:translateY(3px);
  transition:opacity .09s ease,transform .09s ease}
.tip[data-show="true"]{opacity:1;transform:none}
/* 表头即把手：按住可以整块挪走，躲开宿主自己的控件；右下角同理，用来拉大小。 */
header{cursor:move;user-select:none;touch-action:none}
.grip{position:absolute;right:3px;bottom:3px;width:14px;height:14px;cursor:nwse-resize;touch-action:none;
  border-right:2px solid var(--line);border-bottom:2px solid var(--line);border-bottom-right-radius:11px}
.grip:hover{border-color:var(--accent)}
/* 矮宿主（手机竖屏、半屏窗口）：18 行仍然要一屏全露，所以按视口高度分档压缩
   表头/状态/脚注/按钮的行距，而不是把参数藏进滚动条里。

   档与档的分界线不是随手取的：卡片高度被 max-height:88vh 夹住，所以每一档都有自己的
   「装得下的最低视口高度」= (内容 scrollHeight + 卡内非滚动区) / 0.88。实测三档分别是
   774 / 713 / 599，于是上界必须等于前一档的下界——否则就出现「这一档还没压到极限，但
   88vh 已经不够」的死区，滚 3px 也是滚。下面的 780、712、598 就是这么定出来的。 */
@media (max-height: 780px) {
  header{padding:7px 10px}
  .status{padding:5px 10px 4px;min-height:22px}
  .row{padding:1px 0}
  .note{padding:5px 10px;min-height:24px}
  footer{padding:7px 10px}
  .util{padding:0 10px 7px}
}
/* 再矮一档：mockup 浏览器在手机上给案例留的视口只有 ~607px，88vh 装不下上面那套
   行距，所以这里连字号、控件内边距和每行的上下留白一起收，让 18 行仍然不用滚动。 */
@media (max-height: 712px) {
  header{padding:5px 10px}
  .status{padding:3px 10px 2px;min-height:20px}
  .fields{padding:2px 10px}
  .row{padding:0;font-size:11px}
  input[type=range]{height:14px}
  input[type=number],input[type=text],select{padding:1px 5px}
  .note{padding:4px 10px;min-height:20px}
  footer{padding:5px 10px}
  .util{padding:0 10px 5px}
}
/* 最后一档：窗口只剩半屏时连控件高度和分组按钮的留白一起收。压到这里仍然装不下
   （案例视口 < ~540px）才真的交给滚动条——那时滚动条是可见的，把手也能把面板拉大。 */
@media (max-height: 598px) {
  header{padding:3px 10px}
  .status{padding:2px 10px 1px;min-height:16px}
  .fields{padding:0 10px}
  .row .k,.row .v{font-size:10.5px}
  input[type=range]{height:12px}
  input[type=number],input[type=text],select{padding:0 4px}
  .group{margin:1px 0;padding:2px 6px}
  .note{padding:3px 10px;min-height:16px}
  footer{padding:3px 10px}
  footer button{padding:3px 7px}
  .util{padding:0 10px 3px}
  .util button{padding:2px 6px}
}
`;

export type Phase = 'idle' | 'running' | 'paused' | 'done';

export interface PanelHandlers {
  onChange(config: PlainConfig): void;
  onApply(): void;
  onPause(): void;
  onSkip(): void;
  onCopy(): void;
  onReset(): void;
  onRestore(): void;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.join(',') === b.join(',');
  return a === b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Panel {
  readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private readonly rows = new Map<string, HTMLElement>();
  private readonly status: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly code: HTMLTextAreaElement;
  private readonly card: HTMLElement;
  private readonly tip: HTMLElement;
  private groupBtn: HTMLButtonElement | null = null;
  private readonly lang: Lang;
  private hovered: HTMLElement | null = null;
  private config: PlainConfig;
  private applied: PlainConfig | null = null;
  private phase: Phase = 'idle';
  private shown: string;
  private draggedAt = 0;

  constructor(config: PlainConfig, handlers: PanelHandlers, position: Corner, expanded: boolean, lang: Lang = 'zh') {
    this.lang = lang;
    this.host = document.createElement('div');
    // Chrome marker: the overlay must not hide it, and the snapshot must not rebuild it.
    this.host.setAttribute('data-sb-chrome', '');
    this.host.dataset.pos = position;
    this.host.dataset.open = String(expanded);
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    const entry = document.createElement('div');
    entry.className = 'entry';
    const orb = document.createElement('button');
    orb.className = 'orb';
    orb.type = 'button';
    orb.setAttribute('aria-label', '创造者模式');
    orb.dataset.tip = '创造者模式 · 点开设参数，按住可以挪位置';
    orb.innerHTML = LOGO;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '创造者模式';
    entry.append(orb, tag);
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = [
      '<header><b>创造者模式</b><span class="sub">swarm-builder</span><span class="sp"></span>',
      '<button class="icon" type="button" data-info data-tip="蓝图在开始那一刻冻结，所以除「速度」外都要下一局才生效；待生效的项会用铜色标出。导出的片段只含与默认值不同的选项，可直接粘进代码或交给 agent。">i</button>',
      '<button class="icon" type="button" data-fold data-tip="收起成一颗悬浮球">×</button></header>',
      '<p class="status" data-status>待触发</p>',
      '<div class="meter"><i data-meter></i></div>',
      '<div class="fields" data-fields></div>',
      '<p class="note" data-note></p>',
      '<footer><button class="primary" type="button" data-apply data-tip="用当前这套值重开一局：先拆掉上一局的图层，再重新采蓝图。">应用并重跑</button>',
      '<button type="button" data-pause disabled data-tip="冻结时钟，笔画停在半途；再点一次继续。">暂停</button>',
      '<button type="button" data-skip disabled data-tip="立刻结束并交还真实页面">跳过</button></footer>',
      '<div class="util"><button type="button" data-copy data-tip="复制成可粘贴的代码片段">复制配置</button>',
      '<button type="button" data-reset data-tip="全部退回库默认值">重置</button>',
      '<button type="button" data-restore data-tip="停掉施工，把页面原样交还">恢复原状</button></div>',
      '<textarea class="code" data-code readonly hidden spellcheck="false"></textarea>',
      '<i class="grip" data-grip data-tip="拖动改变面板大小：拉高可以让 18 行参数全部露出，不用滚。"></i>',
    ].join('');
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.id = 'sb-tip';
    tip.dataset.show = 'false';
    tip.setAttribute('role', 'tooltip');
    this.shadow.append(style, entry, card, tip);

    const fields = card.querySelector<HTMLElement>('[data-fields]') as HTMLElement;
    // 复刻开关那九行折在一个分组里，默认收起：面板在手机上不许出滚动条，
    // 常驻的十八行已经把这屏占满了，而九行开关全默认关、平时没人动。
    const group = document.createElement('button');
    group.type = 'button';
    group.className = 'group';
    group.dataset.groupfold = '';
    group.setAttribute('aria-expanded', 'false');
    group.dataset.tip = '这几项把两套参考实现的方法逐项还原了：轨道场、运行时挑选、逐段解锁、预滚动采集和生成式配乐。全部默认关——关着的时候运行算法与上面那十八项一模一样，不多一个光标、不多一声配乐，也不会自己去动读者的滚动位置。';
    fields.dataset.replica = 'closed';
    let opened = false;
    for (const field of FIELDS) {
      if (field.group === 'replica' && !opened) {
        opened = true;
        fields.append(group);
      }
      fields.append(this.row(field, config, handlers));
    }
    group.addEventListener('click', () => {
      const open = fields.dataset.replica !== 'open';
      fields.dataset.replica = open ? 'open' : 'closed';
      group.setAttribute('aria-expanded', String(open));
    });
    this.groupBtn = group;
    // 建好一次就整棵换掉：静态标签、选项、按钮、data-tip 全在这一遍里处理。
    localize(this.shadow, lang);

    this.status = card.querySelector<HTMLElement>('[data-status]') as HTMLElement;
    this.pauseBtn = card.querySelector<HTMLButtonElement>('[data-pause]') as HTMLButtonElement;
    this.skipBtn = card.querySelector<HTMLButtonElement>('[data-skip]') as HTMLButtonElement;
    this.applyBtn = card.querySelector<HTMLButtonElement>('[data-apply]') as HTMLButtonElement;
    this.note = card.querySelector<HTMLElement>('[data-note]') as HTMLElement;
    this.meter = card.querySelector<HTMLElement>('[data-meter]') as HTMLElement;
    this.code = card.querySelector<HTMLTextAreaElement>('[data-code]') as HTMLTextAreaElement;
    this.card = card;
    this.tip = tip;
    // 还没开局时状态行写的是「待触发」，本地化过的这一份要和 DOM 一致。
    this.shown = phrase(lang, '待触发');

    // 悬浮球兼任两件事：按开放参数、按住挪位置。挪过之后松手不能再顺手展开一次。
    orb.addEventListener('click', () => {
      if (performance.now() - this.draggedAt < 250) return;
      this.setExpanded(true);
    });
    card.querySelector<HTMLButtonElement>('[data-fold]')?.addEventListener('click', () => this.setExpanded(false));
    this.applyBtn.addEventListener('click', handlers.onApply);
    this.pauseBtn.addEventListener('click', handlers.onPause);
    this.skipBtn.addEventListener('click', handlers.onSkip);
    card.querySelector<HTMLButtonElement>('[data-copy]')?.addEventListener('click', handlers.onCopy);
    card.querySelector<HTMLButtonElement>('[data-reset]')?.addEventListener('click', handlers.onReset);
    card.querySelector<HTMLButtonElement>('[data-restore]')?.addEventListener('click', handlers.onRestore);
    // 位置与大小属于外壳，不属于某一页：宿主页面自己的控件挡住参数时，
    // 把面板挪开或拉高就行，不用改代码。
    this.bindDrag(entry, true);
    this.bindDrag(card.querySelector<HTMLElement>('header') as HTMLElement);
    this.bindResize(card.querySelector<HTMLElement>('[data-grip]') as HTMLElement);
    this.bindTips();
    this.config = config;
    this.host.dataset.phase = 'idle';
    this.sync();
  }

  private row(field: Field, config: PlainConfig, handlers: PanelHandlers): HTMLElement {
    const row = document.createElement('label');
    row.className = 'row';
    // 行和参数键一一对上：验收要检查「配置面里的每个键都有一行」，没有这个标记
    // 就只能靠一个手写的行数，加参数时必然忘记改。控件那侧用的是 data-key，
    // 这里换个名字，免得 [data-key=…] 先选中行而不是输入框。
    row.dataset.rowKey = field.key;
    row.dataset.group = field.group ?? 'core';
    row.dataset.tip = field.hint;
    const key = document.createElement('span');
    key.className = 'k';
    key.textContent = field.label;
    const box = document.createElement('span');
    box.className = 'v';
    const value = config[field.key] ?? DEFAULT_CONFIG[field.key];

    let control: HTMLInputElement | HTMLSelectElement;
    if (field.kind === 'select') {
      const select = document.createElement('select');
      for (const [val, text] of field.choices ?? []) {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = text;
        select.append(option);
      }
      select.value = String(value);
      control = select;
    } else {
      const input = document.createElement('input');
      if (field.kind === 'check') {
        input.type = 'checkbox';
        input.checked = Boolean(value);
      } else if (field.kind === 'text') {
        input.type = 'text';
        input.value = Array.isArray(value) ? value.join(', ') : '';
        input.placeholder = field.placeholder ?? '';
      } else {
        input.type = field.kind;
        input.min = String(field.min ?? 0);
        input.max = String(field.max ?? 100);
        input.step = String(field.step ?? 1);
        input.value = String(value);
      }
      control = input;
    }
    control.setAttribute('data-key', field.key);
    box.append(control);

    let out: HTMLOutputElement | null = null;
    if (field.kind === 'range') {
      out = document.createElement('output');
      out.textContent = String(value);
      box.append(out);
    }
    control.addEventListener('input', () => {
      if (out) out.textContent = (control as HTMLInputElement).value;
      this.config = this.readConfig();
      handlers.onChange(this.config);
      this.sync();
    });
    this.controls.set(field.key, control);
    this.rows.set(field.key, row);
    row.append(key, box);
    return row;
  }

  readConfig(): PlainConfig {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const control = this.controls.get(field.key);
      if (!control) continue;
      if (field.kind === 'check') {
        out[field.key] = (control as HTMLInputElement).checked;
      } else if (field.kind === 'select') {
        out[field.key] = control.value;
      } else if (field.kind === 'text') {
        out[field.key] = control.value.split(',').map((part) => part.trim()).filter(Boolean);
      } else {
        const raw = Number(control.value);
        const min = field.min ?? 0;
        const max = field.max ?? Number.MAX_SAFE_INTEGER;
        out[field.key] = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : DEFAULT_CONFIG[field.key];
      }
    }
    return out as PlainConfig;
  }

  setExpanded(open: boolean): void {
    this.host.dataset.open = String(open);
    if (open) this.fitInView();
  }

  /**
   * 悬浮球拖到贴着下沿时，展开出来的卡片会从那个位置往下顶出视口，底部的
   * 应用/复制按钮就点不到了。展开这一瞬间按卡片真实尺寸把位置夹回来——
   * 样式在读尺寸之后同步写入，同一帧完成，不会先跳一下再收回来。
   */
  private fitInView(): void {
    if (this.host.dataset.pos !== 'free') return;
    const box = this.host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const left = Math.round(clamp(box.left, 8, Math.max(8, window.innerWidth - box.width - 8)));
    const top = Math.round(clamp(box.top, 8, Math.max(8, window.innerHeight - box.height - 8)));
    if (left !== box.left) this.host.style.left = `${left}px`;
    if (top !== box.top) this.host.style.top = `${top}px`;
  }

  get expanded(): boolean {
    return this.host.dataset.open === 'true';
  }

  /** 灰掉的行要把「为什么灰」接到提示后面：中文用全角括号，英文用半角。 */
  private tipFor(field: Field): string {
    const hint = phrase(this.lang, field.hint);
    const why = phrase(this.lang, field.why ?? '');
    return this.lang === 'zh' ? `${hint}（${why}）` : `${hint} (${why})`;
  }

  /** Re-points the dependency greys and the 「待生效」 marks; runs after every edit and every apply. */
  private sync(): void {
    let dirty = 0;
    for (const field of FIELDS) {
      const control = this.controls.get(field.key);
      const row = this.rows.get(field.key);
      if (!control || !row) continue;
      const off = field.offWhen?.(this.config) ?? false;
      control.disabled = off;
      row.dataset.off = String(off);
      row.dataset.tip = off && field.why ? this.tipFor(field) : phrase(this.lang, field.hint);
      if (this.hovered === row) this.showTip(row);
      const changed = this.applied !== null && !same(this.config[field.key], this.applied[field.key]);
      row.dataset.dirty = String(changed);
      if (changed) dirty++;
    }
    this.note.dataset.pending = String(dirty > 0);
    this.note.textContent = dirty > 0
      ? phrase(this.lang, '{0} 项待生效 · 点「应用并重跑」', dirty)
      : (this.applied
        ? phrase(this.lang, '已与正在跑的这一局一致')
        : phrase(this.lang, '改完点「应用并重跑」；未设目标时长时「速度」可运行中改'));
    if (this.groupBtn) {
      // 与行内取值同一套口径：config 里缺键就是没设过，等于默认值。
      const on = REPLICA.filter((field) => !same(this.config[field.key] ?? DEFAULT_CONFIG[field.key], DEFAULT_CONFIG[field.key])).length;
      this.groupBtn.textContent = phrase(this.lang, '参考实现复刻 · {0} 项 · 已开 {1}', REPLICA.length, on);
    }
  }

  /** A run is starting with these values, so 「待生效」 now measures against them. */
  markApplied(config: PlainConfig): void {
    this.applied = { ...config };
    this.sync();
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
    this.host.dataset.phase = phase;
    const live = phase === 'running' || phase === 'paused';
    this.pauseBtn.disabled = !live;
    this.skipBtn.disabled = !live;
    this.pauseBtn.textContent = phrase(this.lang, phase === 'paused' ? '继续' : '暂停');
    if (phase === 'done') this.meter.style.width = '100%';
    if (phase === 'idle') this.meter.style.width = '0';
  }

  setProgress(built: number, total: number): void {
    this.meter.style.width = total > 0 ? `${Math.min(100, (built / total) * 100).toFixed(1)}%` : '0';
  }

  /** Writes a whole config back into the controls, for 「重置」. */
  setConfig(config: PlainConfig): void {
    this.config = config;
    for (const field of FIELDS) {
      const control = this.controls.get(field.key);
      if (!control) continue;
      const value = config[field.key] ?? DEFAULT_CONFIG[field.key];
      if (field.kind === 'check') {
        (control as HTMLInputElement).checked = Boolean(value);
      } else if (field.kind === 'text') {
        control.value = Array.isArray(value) ? value.join(', ') : '';
      } else {
        control.value = String(value);
        const out = this.rows.get(field.key)?.querySelector('output');
        if (out) out.textContent = String(value);
      }
    }
    this.sync();
  }

  /**
   * 状态行的文案由调用方给中文模板，面板知道自己是什么语言：
   * 数字先留在模板里，查完字典再填，免得把「完成 12 项」这种句子反过来猜。
   */
  setStatus(text: string, ...args: (string | number)[]): void {
    const shown = phrase(this.lang, text, ...args);
    this.shown = shown;
    this.status.textContent = shown;
  }

  get statusText(): string {
    return this.shown;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /**
   * 按住表头（或收起状态下的那颗悬浮球）就能把面板挪到视口任意位置。
   * 位置写进 inline style：外部页面能覆盖 :host 的规则，覆盖不了内联声明。
   * `allowButtons` 只有悬浮球用得上——球本身是 button，不放开就永远拖不动；
   * 移动满 4px 才判定为拖，所以轻点照常走 click 展开。
   */
  private bindDrag(handle: HTMLElement, allowButtons = false): void {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (!allowButtons && (event.target as HTMLElement).closest('button')) return;
      const box = this.host.getBoundingClientRect();
      const offsetX = event.clientX - box.left;
      const offsetY = event.clientY - box.top;
      let moved = false;
      const move = (next: PointerEvent) => {
        if (!moved && Math.abs(next.clientX - event.clientX) + Math.abs(next.clientY - event.clientY) < 4) return;
        moved = true;
        // 到这一步才吃掉默认事件：早早在 pointerdown 上 preventDefault 会把 click 一起带走，
        // 悬浮球就再也点不开了。
        next.preventDefault();
        if (this.hovered) this.hideTip(this.hovered);
        this.host.dataset.dragging = 'true';
        this.host.dataset.pos = 'free';
        this.host.style.left = `${Math.round(clamp(next.clientX - offsetX, 8, window.innerWidth - box.width - 8))}px`;
        this.host.style.top = `${Math.round(clamp(next.clientY - offsetY, 8, window.innerHeight - box.height - 8))}px`;
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        delete this.host.dataset.dragging;
        if (moved) this.draggedAt = performance.now();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      event.preventDefault();
    });
  }

  /** 右下角把手改面板的宽高；`.fields` 是 flex:1，所以拉高多出来的高度全给了参数行。 */
  private bindResize(grip: HTMLElement): void {
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const start = { width: this.card.offsetWidth, height: this.card.offsetHeight, x: event.clientX, y: event.clientY };
      const move = (next: PointerEvent) => {
        this.card.style.width = `${Math.round(clamp(start.width + next.clientX - start.x, 252, window.innerWidth - 16))}px`;
        this.card.style.height = `${Math.round(clamp(start.height + next.clientY - start.y, 210, window.innerHeight - 16))}px`;
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      event.preventDefault();
    });
  }

  /** 每一个 `[data-tip]` 都有提示：18 行参数、表头信息钮、底部与工具条的每个按钮。 */
  private bindTips(): void {
    for (const el of Array.from(this.shadow.querySelectorAll<HTMLElement>('[data-tip]'))) {
      el.addEventListener('pointerenter', () => this.showTip(el));
      el.addEventListener('pointerleave', () => this.hideTip(el));
      el.addEventListener('focus', () => this.showTip(el));
      el.addEventListener('blur', () => this.hideTip(el));
    }
  }

  private showTip(el: HTMLElement): void {
    const text = el.dataset.tip;
    if (!text) return;
    this.hovered = el;
    this.tip.textContent = text;
    this.tip.dataset.show = 'true';
    el.setAttribute('aria-describedby', 'sb-tip');
    const box = el.getBoundingClientRect();
    const gap = 8;
    const width = this.tip.offsetWidth;
    const height = this.tip.offsetHeight;
    // 面板可以拖到任意位置，所以提示先试着放右边，放不下翻左边，再放不下压回视口。
    let left = box.right + gap;
    if (left + width > window.innerWidth - gap) left = box.left - width - gap;
    if (left < gap) left = clamp(box.left, gap, window.innerWidth - width - gap);
    const top = clamp(box.top + box.height / 2 - height / 2, gap, window.innerHeight - height - gap);
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(top)}px`;
  }

  private hideTip(el: HTMLElement): void {
    el.removeAttribute('aria-describedby');
    if (this.hovered !== el) return;
    this.hovered = null;
    this.tip.dataset.show = 'false';
  }

  showSnippet(code: string): void {
    this.code.hidden = false;
    this.code.value = code;
  }

  selectSnippet(): void {
    this.code.focus();
    this.code.select();
  }

  destroy(): void {
    this.host.remove();
  }
}