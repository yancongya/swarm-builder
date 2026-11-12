import { DEFAULT_CONFIG } from './snippet';
import type { AgentInfo, SwarmConfig, SwarmResult, SwarmStatus } from '../types';
import { localize, phrase, type Lang } from './locale';

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

type SectionKey = 'scale' | 'order' | 'cursors' | 'capture' | 'sound' | 'look';

interface Field {
  key: keyof SwarmConfig;
  label: string;
  kind: 'range' | 'number' | 'check' | 'select' | 'text';
  hint: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: [string, string][];
  placeholder?: string;
  /** 参数按用途分组；组名就是页签上的一个字，组内只在那一页摊开。 */
  section: SectionKey;
  /** Disabled while this predicate holds, with `why` shown as the row's tooltip. */
  offWhen?: (config: SwarmConfig) => boolean;
  why?: string;
}

/**
 * 六组按「读者要做决定的那件事」切，而不是按代码里的模块切：
 * 先定规模与节奏，再定活怎么分，然后才是光标、采集、声音和外观。
 * 六组排成一行页签，一次只摊开一组——最长的一组七行，面板不会再拉成一列长表。
 * 每页签的悬停提示带着这一组的实时值，翻到别的页也知道另一头设成了什么。
 */
interface SectionDef {
  key: SectionKey;
  title: string;
  short: string;
  tip: string;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'scale', title: '施工规模', short: '规模',
    tip: '几个光标、建多少、多快。这几项决定一局的总时长。',
  },
  {
    key: 'order', title: '认领与顺序', short: '顺序',
    tip: '活怎么分、按什么方向扫、什么时候解锁。默认「自上而下 + 运行时挑 + 随滚动解锁 + 开场聚群」就是参考扩展那条从上往下推的前沿。',
  },
  {
    key: 'cursors', title: '光标行为', short: '光标',
    tip: '光标没活时怎么飞、读者的鼠标算不算数、镜头跟不跟、键盘接不接管。',
  },
  {
    key: 'capture', title: '采集与内容', short: '采集',
    tip: '采蓝图走一遍还是先滚一遍，以及重复、辅助线、标题与跳过规则。',
  },
  {
    key: 'sound', title: '声音', short: '声音',
    tip: '合成音效与生成式配乐。浏览器要页面先有一次用户手势才放行音频。',
  },
  {
    key: 'look', title: '外观与可访问性', short: '外观',
    tip: '施工线配色、读者要求减少动效时演不演，以及给无键盘宿主挂的极简 HUD。',
  },
];

const FIELDS: Field[] = [
  {
    key: 'agentCount', label: '光标数量', kind: 'range', min: 1, max: 24, step: 1, section: 'scale',
    hint: '常驻班组的人数。扩展是 8；动态班组开着时这个数是最低下限，不是固定人数。',
  },
  {
    key: 'agents', label: '动态班组', kind: 'select', section: 'scale',
    hint: '人数归谁定。自动 = 「光标数量」变成下限、48 是上限，滚动越快（每 40px/s 多一个）以及能领的活越多（每 2 件多一个）人就越多，最多每 35ms 从画面外进来一个，干过活又闲了 2.5 秒的临时工自己退场。固定 = 就「光标数量」那几个，各自的带干完就收起。',
    choices: [['auto', '自动增减'], ['fixed', '固定人数']],
  },
  {
    key: 'maxItems', label: '条目上限', kind: 'number', min: 1, max: 5000, step: 50, section: 'scale',
    hint: '蓝图条目上限，扩展是 4000；超出的计入「丢弃」。长页面先看这个数。',
  },
  {
    key: 'speed', label: '速度', kind: 'range', min: 0.25, max: 8, step: 0.25, section: 'scale',
    hint: '全局时间倍率。未设目标时长时，运行中拖动立即生效；工具条的 1×/2×/3× 改的也是它。',
    offWhen: (c) => (c.targetDuration ?? 0) > 0,
    why: '已设目标时长，倍率由估算器接管。把目标时长改回 0 才能手调速度。',
  },
  {
    key: 'targetDuration', label: '目标时长', kind: 'number', min: 0, max: 120, step: 1, section: 'scale',
    hint: '秒。0 = 自然节奏；填了就会覆盖速度，由估算器反推倍率。',
  },
  {
    key: 'performanceMode', label: '性能模式', kind: 'select', section: 'scale',
    hint: 'auto 在容器内元素超过 250 时关掉辅助线、标题步进与竣工印章并压低复制数；音效不受影响，它只按秒限量发声，不产生 DOM 节点。',
    choices: [['auto', '自动'], ['high', '完整'], ['low', '精简']],
  },

  {
    key: 'order', label: '构建顺序', kind: 'select', section: 'order',
    hint: '光标怎么认领这一页。默认「自上而下」配上「运行时挑 + 随滚动解锁」就是参考扩展那条前沿：一条线从上往下推，镜头跟着走。子树并行一栋楼一个人最快；竖列与自上而下转置；蛇形是横带来回扫；逐层先骨架后填肉；由内向外从页面中心扩散；随机打散认领顺序，配合种子可复现。改回「按队列认领」之后，自上而下才是 N 个光标各守一条带同时开工，整页看着四处一起亮。',
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
    key: 'balance', label: '工时均衡', kind: 'check', section: 'order',
    hint: '默认按「件数」把页面切成等大的带，密集的那条带就会比稀疏的厚一倍。打开后改成按预估工时切等分，几个光标差不多同时收工，不会出现五个停下来等一个收尾。它只改带多长，不改朝哪个方向扫。',
  },
  {
    key: 'seed', label: '随机种子', kind: 'number', min: 0, max: 2147483647, step: 1, section: 'order',
    hint: '只在「随机」下参与排程。0 = 每开一局现抽一个新顺序；填同一个数就能重放同一场施工，完成状态里会回显实际用的种子。',
    offWhen: (c) => c.order !== 'random', why: '「构建顺序」不是随机，这个数不参与排程。',
  },
  {
    key: 'pick', label: '认领方式', kind: 'select', section: 'order',
    hint: '活怎么到手。按队列 = 开局就按「构建顺序」每人切一条带，只在自己的带里领，抢也只在这堆里找。运行时挑 = 整页一个池子，每次空手都按参考实现的代价现挑：不在这一屏的先付一百万，带外的纵向距离乘 0.6，离自己纵向多远乘 0.4，参考线反方向优惠 50 万——于是永远是「眼前这屏从上往下」，人追着活跑而不是守着一条带。',
    choices: [['live', '运行时挑'], ['queued', '按队列认领']],
  },
  {
    key: 'trigger', label: '逐段解锁', kind: 'select', section: 'order',
    hint: '什么时候允许领某一件。第一帧全放 = 整页从开局就是敞开的。随滚动 = 只有顶边进了这一屏（视口底边那条线）的元素才算到了，前沿只降不升，所以构建跟着读者往下走。要么开「镜头跟随」，要么宿主页面自己会滚，否则滚不到的那半页永远不解锁。',
    choices: [['scroll', '随滚动解锁'], ['immediate', '第一帧全放']],
  },
  {
    key: 'gather', label: '开场聚群', kind: 'check', section: 'order',
    hint: '开局先演参考扩展那个开场：原始班底从左右两边画面外飞进来（横向探出 40～240px，纵向散在视口 5%～95%），围着视口中心绕圈，半径收到平时的七成。读者一滚滚轮、或鼠标擦到某个光标（48px 以内）就立刻散开领活；没人碰它则最多绕 2.4 秒自己开工。这段时间镜头不动、一件活也不发，配乐也等到开工才起。关着就是光标直接出现在各自任务旁、第一帧就开工。自动增减招来的临时工不参加集合，它们照旧从左右两边进场。',
  },
  {
    key: 'adaptiveSpeed', label: '积压提速', kind: 'check', section: 'order',
    hint: '活堆得越多时钟走得越快：每帧按「已解锁还没人领」的件数重算倍速，等于当前基准乘 min(1 + 积压 × 0.45, 4)，最多到 4 倍。开了以后「速度」和「目标时长」就不是定论而是地面值，dense 页面收尾会明显快于估算。',
  },

  {
    key: 'flight', label: '待时飞行', kind: 'select', section: 'cursors',
    hint: '光标没活的时候干什么。停在落点 = 就停在最后一笔的位置，和以前一样。待时飞行 = 复刻扩展那套速度积分：绕着一圈会呼吸的轨道环（135px，±18%）转，切向推力有个 tanh 慢周期会正反两向扫，径向弹簧夹在 -2600 到 1400，每个光标自带轨道偏心、自转系数与旋度，90px 内的邻居速度按 0.7 比 0.3 合进来；箭头朝行进方向偏，按下时压扁。施工中的那一只归任务管，轨道场不插手。',
    choices: [['live', '待时飞行'], ['idle', '停在落点']],
  },
  {
    key: 'pointer', label: '真实鼠标', kind: 'select', section: 'cursors',
    hint: '读者的鼠标算什么。忽略 = swarm 不管他。当圆心 = 轨道绕着鼠标转。排斥 = 鼠标周围 48px 把光标顶出去，正撞进去时再补一记 260 的冲量。两种都只在「待时飞行」开着时有效，因为鼠标位置只有轨道场会读。',
    choices: [['follow', '当圆心'], ['repel', '排斥'], ['ignore', '忽略']],
    offWhen: (c) => c.flight !== 'live', why: '「待时飞行」没开，轨道场不在时钟里，鼠标位置没人读。',
  },
  {
    key: 'flocking', label: '光标避让', kind: 'check', section: 'cursors',
    hint: '光标在途中互相绕行。',
  },
  {
    key: 'personality', label: '光标性格', kind: 'check', section: 'cursors',
    hint: '每只光标从这一局的种子里抽一个性格：急性子赶路打字都快、身后带速度线；强迫症按部就班、戴一圈校准环；摸鱼中慢半拍、闲久了冒「…」；稳当当就是以前的统一节奏。只改施工快慢和外观，不碰待时飞行与避让；同一种子回放同一支队伍。关掉则全员稳当当。',
  },
  {
    key: 'trailLife', label: '光标拖尾', kind: 'range', min: 0, max: 2.5, step: 0.1, section: 'cursors',
    hint: '每个光标身后拖一道同色的渐隐曲线，单位秒：数值越大残留越久，0 = 关闭。按真实时间淡出，8× 倍速下也不会一闪就没；尾巴在屏幕上的长度有上限（约 300px），倍速再高也不会拉成横穿整页的长线。采样的是光标已经画出的位置，不额外读布局。性能模式自动裁剪的密集页会关掉。',
  },
  {
    key: 'stamps', label: '竣工印章', kind: 'check', section: 'cursors',
    hint: '每件活竣工时，施工它的光标在右下角盖一枚名章：首字母 + 专属色，悬停能看见名字与性格。复制盖章带出来的件也盖，辅助线不盖；印章自己一格，不占 ⌥ 尺寸徽章。性能模式自动裁剪的密集页不盖。',
  },
  {
    key: 'director', label: '观众指挥', kind: 'check', section: 'cursors',
    hint: '施工期间观众能直接指挥光标：点一下催工——这只光标施工提速 1.8 倍、亮一圈光环，持续约两秒；按住拖到别处松手 = 改派，它领的下一件活优先落在落点附近。指针只落在光标上，重建出来的盒子仍然不可交互；开场聚群、暂停和收工之后都不接管。',
  },
  {
    key: 'tour', label: '镜头跟随', kind: 'check', section: 'cursors',
    hint: '滚动跟着施工前沿走（扩展 HUD 上的 Tour），运行中也能开关，结束交还页首。页面比视口高时打开。它跟的是光标在哪儿：多光标各守一条带时，镜头会被最靠后那只一把拽到页底，看着像开局就滚完了；配「随滚动解锁」才会一段一段往下走。',
  },
  {
    key: 'keys', label: '键盘快捷键', kind: 'check', section: 'cursors',
    hint: 'Esc 收工、M 静音，任何键或按下都用来解锁浏览器扣住的音频。扩展还接管 Alt+Shift+S 启停；库跑在页面里不抢这组键。输入框与可编辑区域里的按键原样留给宿主。',
  },

  {
    key: 'scan', label: '采集方式', kind: 'select', section: 'capture',
    hint: '采蓝图之前先看多少页。单次 = 同步走一遍 DOM，现在排得出什么就建什么。预滚动 = 参考扩展的那一遍：先等字体和图片（各有上限），再找出这页真正靠谁滚（后台壳那种 main 自己 overflow:auto 的，滚窗口一格都不动），往下走最多 28 屏把懒加载和 content-visibility 的内容逼出来，回顶、落定，然后才采。改成「单次采集」时，第三方页面建出来缺图、看不出有多长，就是因为少了这一遍。',
    choices: [['pre-scroll', '预滚动采集'], ['single', '单次采集']],
  },
  {
    key: 'duplicate', label: '复制盖章', kind: 'check', section: 'capture',
    hint: '重复的兄弟节点只真做一个，其余用 Option 拖拽盖章。',
  },
  {
    key: 'maxCopies', label: '每组复制', kind: 'number', min: 1, max: 48, step: 1, section: 'capture',
    hint: '每组重复最多盖几个。',
    offWhen: (c) => !c.duplicate, why: '「复制盖章」已关，这个数不参与施工。',
  },
  {
    key: 'guides', label: '辅助线', kind: 'check', section: 'capture',
    hint: '画出布局本来就存在的对齐辅助线。',
  },
  {
    key: 'maxGuides', label: '辅助线数', kind: 'number', min: 0, max: 64, step: 1, section: 'capture',
    hint: '每次运行的辅助线数量。',
    offWhen: (c) => !c.guides, why: '「辅助线」已关，这个数不参与施工。',
  },
  {
    key: 'grow', label: '标题步进', kind: 'check', section: 'capture',
    hint: '大标题一边打字一边长到真实字号。',
  },
  {
    key: 'ignore', label: '跳过', kind: 'text', placeholder: '.ad, #chat-widget', section: 'capture',
    hint: '逗号分隔的 CSS 选择器，命中的元素连同子树整块跳过。',
  },

  {
    key: 'sound', label: '音效', kind: 'check', section: 'sound',
    hint: '合成音效，无音频文件。浏览器要求页面已有用户手势；被扣住时工具条会显示「解锁」，按一下任意键或点一下页面就放行。',
  },
  {
    key: 'score', label: '配乐', kind: 'select', section: 'sound',
    hint: '音效开着的时候放什么。不出旋律 = 只有合成的按键、拉框、盖章三声。生成式 = 复刻那套配器：104 BPM 的十六分格，E 小调五声从 MIDI 40 起，玻璃钢琴音色叠了一根 2.756 的不谐和泛音，盒子面积定音区、横向位置定音级，一个八分槽只许一个音、同时最多 28 个声部，混响是现算的 3.2 秒脉冲，声像跟着光标走，收尾一记 E 大调 add9 扫弦。',
    choices: [['generative', '生成式配乐'], ['off', '不出旋律']],
    offWhen: (c) => !c.sound, why: '「音效」没开，配乐没有出口。',
  },

  {
    key: 'reducedMotion', label: '减少动效', kind: 'select', section: 'look',
    hint: '读者勾了 prefers-reduced-motion: reduce 时怎么办。直接交还 = 参考库自己的规则，什么都不演，立刻报完成把真页面还回去。照跑 = 这是装饰不是视差陷阱，宿主既然调了库就演给他看。',
    choices: [['skip', '直接交还'], ['run', '照跑']],
  },
  {
    key: 'theme', label: '施工线色', kind: 'select', section: 'look',
    hint: 'auto 按页面底色判断明暗。',
    choices: [['auto', '跟随页面'], ['light', '浅色'], ['dark', '深色']],
  },
  {
    key: 'hud', label: '极简 HUD', kind: 'check', section: 'look',
    hint: '画面底部加一条小 HUD：进度读数、可触摸的跳过、活被锁住时的滚动提示。手机等没有键盘的宿主打开它，读者才能提前收工。默认关。',
  },
];

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
.orb svg{width:40px;height:40px;display:block}
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
/* HUD 复刻扩展顶部那条：一句状态、最近 5 个忙碌光标的点、底下一条进度。
   点排在状态行右侧而不是另起一行，是为了让 HUD 的高度和旧版的状态行一样。 */
.hline{display:flex;align-items:center;gap:8px;padding:7px 10px 6px}
.status{flex:1;min-width:0;margin:0;color:var(--dim);font-size:11px;
  font-variant-numeric:tabular-nums;line-height:1.5}
.crew{flex:0 0 auto;display:flex;gap:3px}
.crew:empty{display:none}
.dot{display:grid;place-items:center;width:13px;height:13px;border-radius:50%;
  color:var(--on-accent);font-size:8px;font-weight:700;line-height:1;font-style:normal;opacity:.9}
.meter{height:2px;background:var(--well);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--accent);transition:width .18s linear}
:host([data-phase="idle"]) .meter i{background:var(--line)}
/* 工具条就是扩展 HUD 上那排钮：Tour、倍速、声音、暂停、跳过、重播。
   它们改的是正在跑的这一局，和下面的参数（下一局才生效）分开摆。 */
.tools{display:flex;gap:4px;padding:6px 10px;border-top:1px solid var(--line)}
.tools button{flex:1 1 0;min-width:0;padding:3px 2px;border:1px solid var(--line);border-radius:7px;
  background:var(--well);color:var(--ink);font-size:11px;white-space:nowrap}
.tools button:hover:not(:disabled){border-color:var(--accent)}
.tools button:disabled{opacity:.4;cursor:not-allowed}
.tools button[data-on="true"]{border-color:var(--accent);color:var(--accent)}
.tools button[data-tap="true"]{border-color:var(--accent);background:var(--accent);color:var(--on-accent)}
/* 参数分六页：页签是同一行的小胶囊，一次只摊开一页。页签的悬停提示里带着
   这一页的实时值，所以不摊开也能知道别处设成了什么。 */
.tabs{display:flex;flex-wrap:wrap;gap:3px;padding:6px 10px 4px;border-top:1px solid var(--line)}
.tab{flex:0 0 auto;padding:3px 7px;border:1px solid transparent;border-radius:999px;
  background:transparent;color:var(--dim);font-size:11px;white-space:nowrap}
.tab:hover{color:var(--ink);border-color:var(--line)}
.tab[aria-selected="true"]{background:var(--accent);border-color:var(--accent);
  color:var(--on-accent);font-weight:600}
.tab[data-dirty="true"]::after{content:"";display:inline-block;width:5px;height:5px;
  margin-left:4px;border-radius:50%;background:var(--accent);vertical-align:1px}
.tab[aria-selected="true"][data-dirty="true"]::after{background:var(--on-accent)}
.fields{flex:1 1 auto;min-height:0;padding:2px 10px 4px;overflow-y:auto;scrollbar-width:thin}
.fields::-webkit-scrollbar{width:8px}
.fields::-webkit-scrollbar-thumb{background:#3d3a33;border-radius:8px}
.sec{display:none}
.sec[data-active="true"]{display:block}
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
footer{display:flex;gap:6px;padding:9px 10px 6px;border-top:1px solid var(--line)}
footer button{padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--well);color:var(--ink)}
footer button:hover:not(:disabled){border-color:var(--accent)}
footer button:disabled{opacity:.4;cursor:not-allowed}
footer .primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600;flex:1}
footer .primary:hover{filter:brightness(1.08)}
.util{display:flex;gap:6px;padding:0 10px 9px}
.util button{flex:1;padding:4px 6px;border:1px solid var(--line);border-radius:7px;background:transparent;
  color:var(--dim);font-size:11px}
.util button:hover{color:var(--ink);border-color:var(--accent)}
.util button:disabled{opacity:.4;cursor:not-allowed}
.util button:disabled:hover{color:var(--dim);border-color:var(--line)}
/* 名片是一张图，不下载也不读剪贴板：盖在面板上以便用系统的长按/右键保存。 */
.sheet{position:fixed;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;padding:24px;
  background:rgba(12,11,9,.78);z-index:3}
.sheet[hidden]{display:none}
.sheet img{display:block;max-width:92vw;max-height:78vh;border:1px solid var(--line);
  border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.55);background:var(--card)}
.sheet .icon{position:absolute;top:16px;right:16px;width:28px;height:28px;background:var(--card)}
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
/* 矮宿主（手机竖屏、半屏窗口）：当前这一页也要一屏全露，所以按视口高度分档压缩
   表头/HUD/工具条/脚注/按钮的行距，而不是把参数藏进滚动条里。

   一次只摊开一页以后，1280×900 下卡片自然高度约 423px（六节全开时是 768px），
   900px 宿主本来就装得下；这几档只在更矮的宿主里继续收紧行距，实测到 640px 宿主
   （案例视口 530px）参数区仍然不滚动，再矮才交给可见滚动条。 */
@media (max-height: 872px) {
  header{padding:7px 10px}
  .hline{padding:5px 10px 4px}
  .tools{padding:5px 10px}
  .row{padding:1px 0}
  .note{padding:5px 10px;min-height:24px}
  footer{padding:7px 10px 5px}
  .util{padding:0 10px 7px}
}
/* 再矮一档：mockup 浏览器在手机上给案例留的视口只有 ~607px，88vh 装不下上面那套
   行距，所以这里连字号、控件内边距和每行的上下留白一起收。 */
@media (max-height: 821px) {
  header{padding:5px 10px}
  .hline{padding:3px 10px 2px}
  .tools{padding:4px 10px}
  .fields{padding:2px 10px}
  .row{padding:0;font-size:11px}
  input[type=range]{height:14px}
  input[type=number],input[type=text],select{padding:1px 5px}
  .note{padding:4px 10px;min-height:20px}
  footer{padding:5px 10px 4px}
  .util{padding:0 10px 5px}
}
/* 窗口只剩半屏：连控件高度和分组按钮的留白一起收。 */
@media (max-height: 729px) {
  header{padding:3px 10px}
  .hline{padding:2px 10px 1px}
  .tools{padding:3px 10px}
  .fields{padding:0 10px}
  .row .k,.row .v{font-size:10.5px}
  input[type=range]{height:12px}
  input[type=number],input[type=text],select{padding:0 4px}
  .tab{padding:2px 6px}
  .note{padding:3px 10px;min-height:16px}
  footer{padding:3px 10px 2px}
  footer button{padding:3px 7px}
  .util{padding:0 10px 3px}
  .util button{padding:2px 6px}
}
/* 最后一档：参数行已经压到 10.5px、控件贴边，再省只能从卡外框（表头/HUD/工具条/脚注/按钮）
   里抠。压到这里仍然装不下才真的交给滚动条——那时滚动条是可见的，把手也能把面板拉大。 */
@media (max-height: 621px) {
  header{padding:2px 10px}
  .icon{width:18px;height:18px}
  .hline{padding:1px 10px 0}
  .status{font-size:10px;line-height:1.3}
  .tools{padding:2px 10px}
  .tools button{padding:1px 2px;font-size:10px;line-height:1.35}
  .tab{padding:1px 6px;font-size:10px;line-height:1.3}
  .note{padding:2px 10px;min-height:0;font-size:10px;line-height:1.3}
  footer{padding:2px 10px 1px}
  footer button{padding:2px 7px;font-size:11px;line-height:1.35}
  .util{padding:0 10px 2px}
  .util button{padding:1px 6px;line-height:1.3}
}
`;

export type Phase = 'idle' | 'running' | 'paused' | 'done';

export interface PanelHandlers {
  onChange(config: SwarmConfig): void;
  onApply(): void;
  onPause(): void;
  onSkip(): void;
  onCopy(): void;
  onReset(): void;
  onRestore(): void;
  /** The extension's Tour button: camera follow, live. */
  onTour(): void;
  /** 1x → 2x → 3x, live. */
  onSpeed(): void;
  /** Speaker: mute, or unlock a context the browser is still holding. */
  onSound(): void;
  /** Same capture, same values, from frame one. */
  onReplay(): void;
  /** Draw the finished run's crew card and show it inside the panel. */
  onCard(): void;
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
  private readonly tabs = new Map<SectionKey, HTMLButtonElement>();
  private active: SectionKey = 'scale';
  private readonly status: HTMLElement;
  private readonly crew: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly tourBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly cardBtn: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly sheetImg: HTMLImageElement;
  private readonly note: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly code: HTMLTextAreaElement;
  private readonly card: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly lang: Lang;
  private hovered: HTMLElement | null = null;
  private config: SwarmConfig;
  private applied: SwarmConfig | null = null;
  private phase: Phase = 'idle';
  private hud: SwarmStatus | null = null;
  private result: SwarmResult | null = null;
  private message = '';
  private statusUntil = 0;
  private statusTimer = 0;
  private crewKey = '';
  private shown: string;
  private draggedAt = -Infinity;

  constructor(config: SwarmConfig, handlers: PanelHandlers, position: Corner, expanded: boolean, lang: Lang = 'zh') {
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
      '<button class="icon" type="button" data-info data-tip="蓝图在开始那一刻冻结：工具条改的是这一局，参数改的是下一局。待生效的项会用铜色标出。导出的片段只含与默认值不同的选项，可直接粘进代码或交给 agent。">i</button>',
      '<button class="icon" type="button" data-fold data-tip="收起成一颗悬浮球">×</button></header>',
      '<div class="hud"><div class="hline"><p class="status" data-status>待触发</p><div class="crew" data-crew></div></div>',
      '<div class="meter"><i data-meter></i></div></div>',
      '<div class="tools">',
      '<button type="button" data-tour data-tip="镜头跟随施工前沿（扩展的 Tour），运行中随时开关。">镜头</button>',
      '<button type="button" data-speed data-tip="基础倍速：1× → 2× → 3×。积压提速开着时会在此之上再乘。">1×</button>',
      '<button type="button" data-sound data-tip="声音开关。显示「解锁」表示浏览器还扣着音频，点一下放行。">声音</button>',
      '<button type="button" data-pause disabled data-tip="冻结时钟，笔画停在半途；再点一次继续。">暂停</button>',
      '<button type="button" data-skip disabled data-tip="立刻结束并交还真实页面">跳过</button>',
      '<button type="button" data-replay data-tip="按同一份配置重开一局：重新采蓝图，从第一帧再演一遍。">重播</button>',
      '</div>',
      '<div class="fields" data-fields></div>',
      '<p class="note" data-note></p>',
      '<footer><button class="primary" type="button" data-apply data-tip="用当前这套值重开一局：先拆掉上一局的图层，再重新采蓝图。">应用并重跑</button></footer>',
      '<div class="util"><button type="button" data-copy data-tip="复制成可粘贴的代码片段">复制配置</button>',
      '<button type="button" data-card disabled data-tip="把这一局的班组画成一张可分享的图片：每位光标的姓名、性格与竣工数，标出 MVP，附总项数、用时与种子。跑完一局才能出图；图片只在面板里看，用系统长按或右键保存。">名片</button>',
      '<button type="button" data-reset data-tip="全部退回库默认值">重置</button>',
      '<button type="button" data-restore data-tip="停掉施工，把页面原样交还">恢复原状</button></div>',
      '<textarea class="code" data-code readonly hidden spellcheck="false"></textarea>',
      '<div class="sheet" data-sheet hidden><img data-sheet-img alt=""><button class="icon" type="button" data-sheet-close data-tip="关闭名片" aria-label="关闭名片">×</button></div>',
      '<i class="grip" data-grip data-tip="拖动改变面板大小：拉高能让展开的参数一次看全。"></i>',
    ].join('');
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.id = 'sb-tip';
    tip.dataset.show = 'false';
    tip.setAttribute('role', 'tooltip');
    this.shadow.append(style, entry, card, tip);

    const fields = card.querySelector<HTMLElement>('[data-fields]') as HTMLElement;
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.setAttribute('role', 'tablist');
    fields.before(tabs);
    for (const section of SECTIONS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.dataset.tab = section.key;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(section.key === this.active));
      tab.textContent = section.short;
      tab.dataset.tip = section.tip;
      tab.addEventListener('click', () => this.activate(section.key));
      tabs.append(tab);
      this.tabs.set(section.key, tab);

      const wrap = document.createElement('div');
      wrap.className = 'sec';
      wrap.dataset.sec = section.key;
      wrap.dataset.active = String(section.key === this.active);
      for (const field of FIELDS) {
        if (field.section === section.key) wrap.append(this.row(field, config, handlers));
      }
      fields.append(wrap);
    }
    // 建好一次就整棵换掉：静态标签、选项、按钮、data-tip 全在这一遍里处理。
    localize(this.shadow, lang);

    this.status = card.querySelector<HTMLElement>('[data-status]') as HTMLElement;
    this.crew = card.querySelector<HTMLElement>('[data-crew]') as HTMLElement;
    this.pauseBtn = card.querySelector<HTMLButtonElement>('[data-pause]') as HTMLButtonElement;
    this.skipBtn = card.querySelector<HTMLButtonElement>('[data-skip]') as HTMLButtonElement;
    this.applyBtn = card.querySelector<HTMLButtonElement>('[data-apply]') as HTMLButtonElement;
    this.tourBtn = card.querySelector<HTMLButtonElement>('[data-tour]') as HTMLButtonElement;
    this.speedBtn = card.querySelector<HTMLButtonElement>('[data-speed]') as HTMLButtonElement;
    this.soundBtn = card.querySelector<HTMLButtonElement>('[data-sound]') as HTMLButtonElement;
    this.replayBtn = card.querySelector<HTMLButtonElement>('[data-replay]') as HTMLButtonElement;
    this.cardBtn = card.querySelector<HTMLButtonElement>('[data-card]') as HTMLButtonElement;
    this.sheet = card.querySelector<HTMLElement>('[data-sheet]') as HTMLElement;
    this.sheetImg = card.querySelector<HTMLImageElement>('[data-sheet-img]') as HTMLImageElement;
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
    this.tourBtn.addEventListener('click', handlers.onTour);
    this.speedBtn.addEventListener('click', handlers.onSpeed);
    this.soundBtn.addEventListener('click', handlers.onSound);
    this.replayBtn.addEventListener('click', handlers.onReplay);
    this.cardBtn.addEventListener('click', handlers.onCard);
    card.querySelector<HTMLButtonElement>('[data-sheet-close]')
      ?.addEventListener('click', () => this.closeSheet());
    // 点图以外的地方收起；图上单击不关，方便右键另存。
    this.sheet.addEventListener('click', (event) => {
      if (event.target === this.sheet) this.closeSheet();
    });
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
    this.setPhase('idle');
    this.sync();
  }

  private row(field: Field, config: SwarmConfig, handlers: PanelHandlers): HTMLElement {
    const row = document.createElement('label');
    row.className = 'row';
    // 行和参数键一一对上：验收要检查「配置面里的每个键都有一行」，没有这个标记
    // 就只能靠一个手写的行数，加参数时必然忘记改。控件那侧用的是 data-key，
    // 这里换个名字，免得 [data-key=…] 先选中行而不是输入框。
    row.dataset.rowKey = field.key;
    row.dataset.sec = field.section;
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

  readConfig(): SwarmConfig {
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
    return out as SwarmConfig;
  }

  setExpanded(open: boolean): void {
    this.host.dataset.open = String(open);
    if (open) this.fitInView();
  }

  /** 翻页签：只留下一组的参数行，面板高度始终按最长那组算，不会随翻页乱跳。 */
  private activate(key: SectionKey): void {
    this.active = key;
    for (const [section, tab] of this.tabs) tab.setAttribute('aria-selected', String(section === key));
    for (const sec of Array.from(this.shadow.querySelectorAll<HTMLElement>('.sec'))) {
      sec.dataset.active = String(sec.dataset.sec === key);
    }
    const fields = this.shadow.querySelector<HTMLElement>('.fields');
    if (fields) fields.scrollTop = 0;
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

  private valueLabel(field: Field): string {
    const raw = String(this.config[field.key] ?? DEFAULT_CONFIG[field.key]);
    const hit = field.choices?.find(([value]) => value === raw);
    return phrase(this.lang, hit ? hit[1] : raw);
  }

  /** Re-points the dependency greys, the page-tab dots and the 「待生效」 marks. */
  private sync(): void {
    let dirty = 0;
    const dirtySecs = new Set<SectionKey>();
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
      if (changed) {
        dirty++;
        dirtySecs.add(field.section);
      }
    }
    // 改的是没翻到的那一页时，页签上留一个铜点——否则「待生效」只在脚注里出现，
    // 读者得先翻遍六个页签才知道改的是哪一组。
    for (const [section, tab] of this.tabs) tab.dataset.dirty = String(dirtySecs.has(section));
    this.note.dataset.pending = String(dirty > 0);
    this.note.textContent = dirty > 0
      ? phrase(this.lang, '{0} 项待生效 · 点「应用并重跑」', dirty)
      : (this.applied
        ? phrase(this.lang, '已与正在跑的这一局一致')
        : phrase(this.lang, '改完点「应用并重跑」'));
    this.summarize();
  }

  /** 每个页签的悬停提示都带这一组的实时值；不摊开也能看见另一头设成了什么。 */
  private summarize(): void {
    const pick = (key: keyof SwarmConfig): Field => FIELDS.find((field) => field.key === key) as Field;
    const on = (key: keyof SwarmConfig): boolean => Boolean(this.config[key] ?? DEFAULT_CONFIG[key]);
    const put = (key: SectionKey, text: string): void => {
      const tab = this.tabs.get(key);
      const section = SECTIONS.find((item) => item.key === key);
      if (!tab || !section) return;
      const tip = phrase(this.lang, section.tip);
      tab.dataset.tip = this.lang === 'zh' ? `${text}。${tip}` : `${text}. ${tip}`;
    };
    const agents = this.config.agentCount ?? DEFAULT_CONFIG.agentCount;
    const items = this.config.maxItems ?? DEFAULT_CONFIG.maxItems;
    put('scale', phrase(this.lang, '{0} 光标 · 上限 {1}', agents, items));
    put('order', `${this.valueLabel(pick('order'))} · ${this.valueLabel(pick('trigger'))}`);
    put('cursors', `${this.valueLabel(pick('flight'))} · ${this.valueLabel(pick('pointer'))}`);
    put('capture', this.valueLabel(pick('scan')));
    put('sound', `${phrase(this.lang, on('sound') ? '开' : '关')} · ${this.valueLabel(pick('score'))}`);
    put('look', `${this.valueLabel(pick('theme'))} · ${this.valueLabel(pick('reducedMotion'))}`);
  }

  /** A run is starting with these values, so 「待生效」 now measures against them. */
  markApplied(config: SwarmConfig): void {
    this.applied = { ...config };
    this.sync();
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
    this.host.dataset.phase = phase;
    const live = phase === 'running' || phase === 'paused';
    // 工具条改的是这一局：没有这一局就灰掉，免得按下去什么都不发生。
    this.tourBtn.disabled = !live;
    this.speedBtn.disabled = !live;
    this.soundBtn.disabled = !live;
    this.pauseBtn.disabled = !live;
    this.skipBtn.disabled = !live;
    this.replayBtn.disabled = phase === 'idle';
    // 名片只属于刚跑完的那一局：新一局一开始就把上一张收掉。
    if (phase !== 'done') {
      this.cardBtn.disabled = true;
      this.closeSheet();
    }
    this.pauseBtn.textContent = phrase(this.lang, phase === 'paused' ? '继续' : '暂停');
    if (phase === 'done') this.meter.style.width = '100%';
    if (phase === 'idle') this.meter.style.width = '0';
  }

  /**
   * One HUD tick, straight from `SwarmStatus` — the same payload a host can read
   * itself. The toolbar and the status line mirror the run, not the panel's own
   * config: Tour, speed and sound can all change mid-run.
   */
  setHud(status: SwarmStatus): void {
    this.hud = status;
    if (status.phase !== 'done') this.result = null;
    const phase: Phase = status.phase === 'scanning' || status.phase === 'gathering' || status.phase === 'building'
      ? 'running'
      : status.phase === 'paused'
        ? 'paused'
        : status.phase === 'done' ? 'done' : 'idle';
    this.setPhase(phase);
    this.meter.style.width = status.total > 0
      ? `${Math.min(100, (status.built / status.total) * 100).toFixed(1)}%`
      : (phase === 'done' ? '100%' : '0');

    this.tourBtn.dataset.on = String(status.tour);
    this.tourBtn.textContent = phrase(this.lang, status.tour ? '跟随中' : '镜头');
    this.speedBtn.textContent = `${Number(status.pace.toFixed(2))}×`;
    this.soundBtn.dataset.on = String(status.sound && !status.soundBlocked);
    this.soundBtn.dataset.tap = String(status.sound && status.soundBlocked);
    this.soundBtn.textContent = phrase(this.lang, !status.sound ? '静音' : status.soundBlocked ? '解锁' : '声音');
    this.renderCrew(status.busyCrew);
    this.writeStatus();
  }

  /** The finished numbers after `onComplete`: agents who worked and the wall time. */
  setResult(result: SwarmResult): void {
    this.result = result;
    this.cardBtn.disabled = !(result.crew && result.crew.length > 0);
    this.statusUntil = 0;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = 0;
    }
    this.writeStatus();
  }

  private renderCrew(crew: readonly AgentInfo[]): void {
    const key = crew.map((agent) => agent.id).join(',');
    if (key === this.crewKey) return;
    this.crewKey = key;
    this.crew.replaceChildren(...crew.map((agent) => {
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = agent.color;
      dot.textContent = agent.name.slice(0, 1);
      dot.title = agent.name;
      return dot;
    }));
  }

  private hudLine(status: SwarmStatus): string {
    switch (status.phase) {
      case 'scanning':
        return phrase(this.lang, '采蓝图中…');
      case 'gathering':
        return phrase(this.lang, '开场聚群 · {0} 个光标', status.agents);
      case 'building':
        return status.needsScroll
          ? phrase(this.lang, '{0} 个光标 · {1}/{2} 项 · 滚动以继续施工', status.agents, status.built, status.total)
          : phrase(this.lang, '{0} 个光标 · {1}/{2} 项', status.agents, status.built, status.total);
      case 'paused':
        return phrase(this.lang, '已暂停 · 完成 {0}/{1}', status.built, status.total);
      case 'done': {
        if (!this.result) return phrase(this.lang, '完成 {0} 项', status.built);
        const { built, dropped } = this.result;
        const seconds = (this.result.durationMs / 1000).toFixed(1);
        const crew = this.result.agents;
        return dropped > 0
          ? phrase(this.lang, '完成 {0} 项 · {1} 个光标 · 用时 {2}s · 丢弃 {3}', built, crew, seconds, dropped)
          : phrase(this.lang, '完成 {0} 项 · {1} 个光标 · 用时 {2}s', built, crew, seconds);
      }
      default:
        return phrase(this.lang, '待触发');
    }
  }

  private writeStatus(): void {
    const line = performance.now() < this.statusUntil
      ? this.message
      : this.hud ? this.hudLine(this.hud) : phrase(this.lang, '待触发');
    this.shown = line;
    this.status.textContent = line;
  }

  setProgress(built: number, total: number): void {
    this.meter.style.width = total > 0 ? `${Math.min(100, (built / total) * 100).toFixed(1)}%` : '0';
  }

  /** Writes a whole config back into the controls, for 「重置」. */
  setConfig(config: SwarmConfig): void {
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
   * 这类消息（复制成功、已重置）只盖住 HUD 两秒半，之后自动回到实时状态。
   */
  setStatus(text: string, ...args: (string | number)[]): void {
    this.message = phrase(this.lang, text, ...args);
    this.statusUntil = performance.now() + 2500;
    this.shown = this.message;
    this.status.textContent = this.message;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = 0;
      this.statusUntil = 0;
      this.writeStatus();
    }, 2500);
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

  /** 每个 `[data-tip]` 都有提示：参数行、分节标题、表头信息钮、工具条与底部每个按钮。 */
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

  /** The card the tuner just drew: an inline PNG in the panel's own shadow. */
  showCard(url: string): void {
    this.sheetImg.src = url;
    this.sheetImg.alt = phrase(this.lang, '班组名片');
    this.sheet.hidden = false;
  }

  private closeSheet(): void {
    this.sheet.hidden = true;
  }

  selectSnippet(): void {
    this.code.focus();
    this.code.select();
  }

  destroy(): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.host.remove();
  }
}
