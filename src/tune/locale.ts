export type Lang = 'zh' | 'en';

/**
 * 面板的双语：源码里写的是中文，字典负责在 EN 下换掉。
 *
 * 为什么不做成「英文为源、中文为译」：整个仓库的注释、验收断言、README 都以中文为准，
 * 面板的字符串反过来会让默认语言变成二次翻译的结果。所以 zh 是默认值，也是唯一
 * 不需要查表的语言。
 */
export function resolveLang(explicit?: Lang, doc?: { lang?: string }): Lang {
  if (explicit === 'en' || explicit === 'zh') return explicit;
  const html = (doc ?? document.documentElement).lang ?? '';
  if (/^en\b/i.test(html.trim())) return 'en';
  return 'zh';
}

/** 静态串：面板建好以后整棵 shadow root 走一遍，运行时改写的句子走 ui()。 */
const UI: Record<string, string> = {
  '创造者模式': 'Creator mode',
  '光标数量': 'Cursor count',
  '构建顺序': 'Build order',
  '工时均衡': 'Work balancing',
  '随机种子': 'Random seed',
  '速度': 'Speed',
  '目标时长': 'Target duration',
  '条目上限': 'Item cap',
  '复制盖章': 'Duplicate stamping',
  '每组复制': 'Copies per group',
  '辅助线': 'Guides',
  '辅助线数': 'Guide count',
  '标题步进': 'Heading growth',
  '光标避让': 'Cursor flocking',
  '光标性格': 'Cursor personality',
  '竣工印章': 'Completion seals',
  '观众指挥': 'Director mode',
  '镜头跟随': 'Camera follow',
  '音效': 'Sound',
  '施工线色': 'Guide ink',
  '性能模式': 'Performance mode',
  '跳过': 'Skip',
  '子树并行': 'Subtrees in parallel',
  '自上而下': 'Top to bottom',
  '竖列': 'Columns',
  '蛇形层扫': 'Snake sweep',
  '逐层（骨架先行）': 'By depth (frame first)',
  '由内向外': 'Outside in from centre',
  '随机': 'Random',
  '跟随页面': 'Follow the page',
  '浅色': 'Light',
  '深色': 'Dark',
  '自动': 'Auto',
  '完整': 'Full',
  '精简': 'Trimmed',
  '暂停': 'Pause',
  '继续': 'Resume',
  '跳过这一局': 'Skip this run',
  '应用并重跑': 'Apply & rerun',
  '复制配置': 'Copy config',
  '重置': 'Reset',
  '恢复原状': 'Restore page',
  '待触发': 'Waiting',
  '收起': 'Collapse',
  '展开': 'Expand',

  // 六页按用途切：页签上的短名、节名、节说明。
  '规模': 'Scale',
  '顺序': 'Order',
  '光标': 'Cursors',
  '采集': 'Capture',
  '外观': 'Look',
  '施工规模': 'Build scale',
  '认领与顺序': 'Claim & order',
  '光标行为': 'Cursor behaviour',
  '采集与内容': 'Capture & content',
  '声音': 'Sound',
  '外观与可访问性': 'Look & accessibility',
  '几个光标、建多少、多快。这几项决定一局的总时长。':
    'How many cursors, how much gets built and how fast: these decide the length of a run.',
  '活怎么分、按什么方向扫、什么时候解锁。默认「自上而下 + 运行时挑 + 随滚动解锁 + 开场聚群」就是参考扩展那条从上往下推的前沿。':
    'How work is split, which way it sweeps and when it unlocks. The defaults - Top to bottom + Priced each frame + Unlock as you scroll + Opening cluster - are exactly the reference extension’s frontier pushing down the page.',
  '光标没活时怎么飞、读者的鼠标算不算数、镜头跟不跟、键盘接不接管。':
    'How a cursor flies between jobs, whether the reader’s mouse counts, whether the camera follows, and whether the keyboard is wired up.',
  '采蓝图走一遍还是先滚一遍，以及重复、辅助线、标题与跳过规则。':
    'Whether the capture walks the DOM once or pre-scrolls first, plus the rules for repeats, guides, headings and skips.',
  '合成音效与生成式配乐。浏览器要页面先有一次用户手势才放行音频。':
    'Synthesised cues and the generative score. The browser wants one user gesture on the page before audio is allowed.',
  '施工线配色、读者要求减少动效时演不演，以及给无键盘宿主挂的极简 HUD。':
    'The ink used for construction lines, whether to play when the reader asks for reduced motion, and the minimal HUD for keyboard-less hosts.',
  '开': 'On',
  '关': 'Off',

  // 工具条：改的是这一局，和下面「下一局才生效」的参数分开。
  '镜头': 'Tour',
  '跟随中': 'Following',
  '重播': 'Replay',
  '静音': 'Muted',
  '解锁': 'Tap to unmute',
  '镜头跟随施工前沿（扩展的 Tour），运行中随时开关。':
    'Camera follows the construction frontier (the extension’s Tour). Toggle it any time during a run.',
  '基础倍速：1× → 2× → 3×。积压提速开着时会在此之上再乘。':
    'Base speed: 1× → 2× → 3×. With backlog pacing on, the clock is multiplied on top of this.',
  '声音开关。显示「解锁」表示浏览器还扣着音频，点一下放行。':
    'Sound on and off. “Tap to unmute” means the browser is still holding the audio context - one click releases it.',
  '按同一份配置重开一局：重新采蓝图，从第一帧再演一遍。':
    'Starts another run with the same values: fresh capture, from frame one.',

  // 悬浮球、表头信息钮、把手与底部/工具条每个按钮的 data-tip。
  '创造者模式 · 点开设参数，按住可以挪位置': 'Creator mode · click to open the parameters, hold to move it',
  '收起成一颗悬浮球': 'Collapse into a floating orb',
  '拖动改变面板大小：拉高能让展开的参数一次看全。':
    'Drag to resize the panel. Pull it taller to see every expanded row at once.',
  '蓝图在开始那一刻冻结：工具条改的是这一局，参数改的是下一局。待生效的项会用铜色标出。导出的片段只含与默认值不同的选项，可直接粘进代码或交给 agent。':
    'The blueprint freezes the moment a run starts: the toolbar changes this run, the rows change the next one. Pending items are marked in copper. The exported snippet lists only options that differ from the defaults - paste it into your code or hand it to an agent.',
  '用当前这套值重开一局：先拆掉上一局的图层，再重新采蓝图。':
    'Starts a run with these values: it tears down the last layer, then reads a fresh blueprint.',
  '冻结时钟，笔画停在半途；再点一次继续。': 'Freezes the clock mid-stroke. Click again to carry on.',
  '立刻结束并交还真实页面': 'Ends the run at once and hands back the real page',
  '复制成可粘贴的代码片段': 'Copy a snippet you can paste',
  '全部退回库默认值': 'Return everything to the library defaults',
  '停掉施工，把页面原样交还': 'Stop the build and give the page back untouched',

  // 参数行的 hover 提示，以及被关掉的行为什么会灰。
  '常驻班组的人数。扩展是 8；动态班组开着时这个数是最低下限，不是固定人数。':
    'Headcount of the home crew. The extension uses 8; with dynamic crew on, this number is the floor rather than a fixed headcount.',
  '光标怎么认领这一页。默认「自上而下」配上「运行时挑 + 随滚动解锁」就是参考扩展那条前沿：一条线从上往下推，镜头跟着走。子树并行一栋楼一个人最快；竖列与自上而下转置；蛇形是横带来回扫；逐层先骨架后填肉；由内向外从页面中心扩散；随机打散认领顺序，配合种子可复现。改回「按队列认领」之后，自上而下才是 N 个光标各守一条带同时开工，整页看着四处一起亮。':
    'How cursors claim the page. The default "Top to bottom" together with "Priced each frame + Unlock as you scroll" is the reference extension’s frontier: one line pushing down from the top with the camera following. "Subtrees in parallel" gives each block its own cursor and is the fastest; "Columns" is top-to-bottom turned on its side; "Snake sweep" zig-zags through the bands; "By depth" raises the frame before filling it in; "Outside in from centre" spreads out from the middle; "Random" shuffles the claim order and replays the same way when a seed is set. Switch back to "Claimed from the queue" and top-to-bottom becomes N cursors each holding one band and starting together, so the page lights up in several places at once.',
  '默认按「件数」把页面切成等大的带，密集的那条带就会比稀疏的厚一倍。打开后改成按预估工时切等分，几个光标差不多同时收工，不会出现五个停下来等一个收尾。它只改带多长，不改朝哪个方向扫。':
    'By default the page is cut into bands with an equal number of items, so a dense band takes about twice as long as a sparse one. Turn this on to cut by estimated work instead: the cursors finish at nearly the same moment instead of five of them idling while one catches up. It changes how long each band is, not which direction they sweep.',
  '只在「随机」下参与排程。0 = 每开一局现抽一个新顺序；填同一个数就能重放同一场施工，完成状态里会回显实际用的种子。':
    'Only schedules anything under "Random". 0 draws a fresh order each run; the same number replays the same build, and the finished status reports the seed that was actually used.',
  '「构建顺序」不是随机，这个数不参与排程。': '"Build order" is not Random, so this number is not part of the schedule.',
  '全局时间倍率。未设目标时长时，运行中拖动立即生效；工具条的 1×/2×/3× 改的也是它。':
    'Global time multiplier. With no target duration set, dragging this while a run is live applies immediately; the toolbar’s 1×/2×/3× changes the same value.',
  '已设目标时长，倍率由估算器接管。把目标时长改回 0 才能手调速度。':
    'A target duration is set, so the estimator owns the multiplier. Put the target back to 0 to drive speed by hand.',
  '秒。0 = 自然节奏；填了就会覆盖速度，由估算器反推倍率。':
    'Seconds. 0 keeps the natural pace; any other value overrides "Speed" and the estimator works the multiplier out backwards.',
  '蓝图条目上限，扩展是 4000；超出的计入「丢弃」。长页面先看这个数。':
    'How many items the blueprint may hold - the extension uses 4000; anything over the cap is counted under "dropped". On a long page, check this number first.',
  '重复的兄弟节点只真做一个，其余用 Option 拖拽盖章。':
    'Repeated siblings are built once for real; the rest are stamped with an Option-drag.',
  '每组重复最多盖几个。': 'How many stamps one group may get.',
  '「复制盖章」已关，这个数不参与施工。': '"Duplicate stamping" is off, so this number is not part of the build.',
  '画出布局本来就存在的对齐辅助线。': 'Draws the alignment lines the layout already had.',
  '每次运行的辅助线数量。': 'How many guides one run may draw.',
  '「辅助线」已关，这个数不参与施工。': '"Guides" is off, so this number is not part of the build.',
  '大标题一边打字一边长到真实字号。': 'Large headings type out while growing into their real font size.',
  '光标在途中互相绕行。': 'Cursors steer around each other in flight.',
  '每只光标从这一局的种子里抽一个性格：急性子赶路打字都快、身后带速度线；强迫症按部就班、戴一圈校准环；摸鱼中慢半拍、闲久了冒「…」；稳当当就是以前的统一节奏。只改施工快慢和外观，不碰待时飞行与避让；同一种子回放同一支队伍。关掉则全员稳当当。':
    'Each cursor draws a personality from this run’s seed: Rush travels and types fast with speed lines behind it; Tidy works by the book and wears a calibration ring; Drift is half a beat slow and idles into a “…” bubble; Steady is the old uniform pace. Only the build tempo and the look change - idle flight and flocking are untouched, and the same seed replays the same crew. Off makes everyone Steady.',
  '每件活竣工时，施工它的光标在右下角盖一枚名章：首字母 + 专属色，悬停能看见名字与性格。复制盖章带出来的件也盖，辅助线不盖；印章自己一格，不占 ⌥ 尺寸徽章。性能模式自动裁剪的密集页不盖。':
    'When an item is finished, the cursor that built it seals the bottom-right corner: its initial in its own colour, with the name and personality on hover. Stamped copies are sealed too and guides are not; the seal has its own slot and never shows up in the ⌥ size badge. Crowded pages trimmed by Performance mode skip them.',
  '施工期间观众能直接指挥光标：点一下催工——这只光标施工提速 1.8 倍、亮一圈光环，持续约两秒；按住拖到别处松手 = 改派，它领的下一件活优先落在落点附近。指针只落在光标上，重建出来的盒子仍然不可交互；开场聚群、暂停和收工之后都不接管。':
    'While work is under way the audience can direct the cursors: click one to urge it - a 1.8x build clock with a halo for about two seconds; drag it somewhere else and release to reassign it, so its next claim comes from near where you dropped it. The pointer only ever lands on a cursor, rebuilt boxes stay inert, and the controls do nothing while the opening cluster runs, while paused, or after the run.',
  '滚动跟着施工前沿走（扩展 HUD 上的 Tour），运行中也能开关，结束交还页首。页面比视口高时打开。它跟的是光标在哪儿：多光标各守一条带时，镜头会被最靠后那只一把拽到页底，看着像开局就滚完了；配「随滚动解锁」才会一段一段往下走。':
    'Scroll follows the construction frontier (the Tour button on the extension’s HUD), can be toggled mid-run, and returns to the top when the run ends. Turn it on when the page is taller than the viewport. It follows where the cursors are: with several cursors each holding a band, the rearmost one yanks the camera to the bottom and it looks like the page scrolled away in the opening second. Pair it with "Unlock as you scroll" and it advances screen by screen instead.',
  '键盘快捷键': 'Keyboard shortcuts',
  '极简 HUD': 'Minimal HUD',
  '画面底部加一条小 HUD：进度读数、可触摸的跳过、活被锁住时的滚动提示。手机等没有键盘的宿主打开它，读者才能提前收工。默认关。':
    'A small HUD at the bottom of the screen: progress readout, a touchable skip chip and a scroll hint while work is locked. Turn it on for keyboard-less hosts (phones) so readers can end a run early; off by default.',
  'Esc 收工、M 静音，任何键或按下都用来解锁浏览器扣住的音频。扩展还接管 Alt+Shift+S 启停；库跑在页面里不抢这组键。输入框与可编辑区域里的按键原样留给宿主。':
    'Esc stops the run and M mutes it; any key or press also unlocks audio the browser is holding. The extension also binds Alt+Shift+S; the library runs inside the page and leaves that combination alone. Keys typed into inputs and editable areas stay with the host.',
  '合成音效，无音频文件。浏览器要求页面已有用户手势；被扣住时工具条会显示「解锁」，按一下任意键或点一下页面就放行。':
    'Synthesised sound, no audio files. The browser wants a user gesture on the page first; while it is holding the context the toolbar shows “Tap to unmute”, and any key or click releases it.',
  'auto 按页面底色判断明暗。': 'auto reads the page background to decide light or dark.',
  'auto 在容器内元素超过 250 时关掉辅助线、标题步进与竣工印章并压低复制数；音效不受影响，它只按秒限量发声，不产生 DOM 节点。':
    'auto switches off guides, heading growth and completion seals, and trims the copy count, once the container holds more than 250 elements. Sound is not affected - it is rate-limited per second and creates no DOM nodes.',
  '逗号分隔的 CSS 选择器，命中的元素连同子树整块跳过。':
    'Comma-separated CSS selectors. A match skips that element and its whole subtree.',

  // 复刻开关那一组：行名、选项、提示与分组按钮的说明。十行默认折起来，但节点仍在
  // DOM 里，英文模式照样要逐条命中，否则验收判「露中文」。
  '待时飞行': 'Idle flight',
  '真实鼠标': 'Real pointer',
  '动态班组': 'Crew size',
  '开场聚群': 'Opening cluster',
  '认领方式': 'Claim method',
  '逐段解锁': 'Scroll unlock',
  '积压提速': 'Backlog pacing',
  '采集方式': 'Capture pass',
  '配乐': 'Score',
  '减少动效': 'Reduced motion',
  '停在落点': 'Park on the last drop',
  '忽略': 'Ignore',
  '当圆心': 'Orbit centre',
  '排斥': 'Push them away',
  '固定人数': 'Fixed crew',
  '自动增减': 'Grow and shrink',
  '按队列认领': 'From its own queue',
  '运行时挑': 'Priced each frame',
  '第一帧全放': 'Open from frame one',
  '随滚动解锁': 'Unlock as you scroll',
  '单次采集': 'One pass',
  '预滚动采集': 'Pre-scroll pass',
  '不出旋律': 'Clicks only',
  '生成式配乐': 'Generative score',
  '照跑': 'Run anyway',
  '直接交还': 'Hand back at once',
  '光标没活的时候干什么。停在落点 = 就停在最后一笔的位置，和以前一样。待时飞行 = 复刻扩展那套速度积分：绕着一圈会呼吸的轨道环（135px，±18%）转，切向推力有个 tanh 慢周期会正反两向扫，径向弹簧夹在 -2600 到 1400，每个光标自带轨道偏心、自转系数与旋度，90px 内的邻居速度按 0.7 比 0.3 合进来；箭头朝行进方向偏，按下时压扁。施工中的那一只归任务管，轨道场不插手。':
    'What a cursor does with nothing to build. “Park on the last drop” leaves it where its final stroke landed, exactly as before. “Orbit while idle” is the extension’s own velocity integration: it circles a breathing orbit ring (135px, ±18%), the tangential push sweeps forward and back on a slow tanh cycle, the radial spring is clamped between -2600 and 1400, every cursor brings its own orbit offset, spin and curl, and neighbours inside 90px blend in at 0.7 against 0.3 — the arrow leans into its heading and flattens while it presses. A cursor that is mid-task belongs to the task, not to the field.',
  '读者的鼠标算什么。忽略 = swarm 不管他。当圆心 = 轨道绕着鼠标转。排斥 = 鼠标周围 48px 把光标顶出去，正撞进去时再补一记 260 的冲量。两种都只在「待时飞行」开着时有效，因为鼠标位置只有轨道场会读。':
    'What the reader’s mouse counts as. “Ignore” means the swarm never notices it. “Orbit centre” puts the ring around the pointer. “Push them away” keeps a 48px bubble around it and adds a 260 impulse when a cursor runs into that bubble. Both only bite while “Idle flight” is on, because the pointer position is something only the orbit field reads.',
  '「待时飞行」没开，轨道场不在时钟里，鼠标位置没人读。':
    '“Idle flight” is off, so the orbit field is not in the clock and nothing reads the pointer.',
  '人数归谁定。自动 = 「光标数量」变成下限、48 是上限，滚动越快（每 40px/s 多一个）以及能领的活越多（每 2 件多一个）人就越多，最多每 35ms 从画面外进来一个，干过活又闲了 2.5 秒的临时工自己退场。固定 = 就「光标数量」那几个，各自的带干完就收起。':
    'Who decides how many cursors there are. “Grow and shrink” turns the number above into the floor and 48 into the ceiling: one more cursor per 40px/s of scroll and per two jobs still up for grabs, arriving one at a time from off-screen with at least 35ms between them, and a temp that has worked and then sat idle for 2.5s walks off on its own. “Fixed crew” keeps exactly that many and hides each one when its band is done.',
  '开局先演参考扩展那个开场：原始班底从左右两边画面外飞进来（横向探出 40～240px，纵向散在视口 5%～95%），围着视口中心绕圈，半径收到平时的七成。读者一滚滚轮、或鼠标擦到某个光标（48px 以内）就立刻散开领活；没人碰它则最多绕 2.4 秒自己开工。这段时间镜头不动、一件活也不发，配乐也等到开工才起。关着就是光标直接出现在各自任务旁、第一帧就开工。自动增减招来的临时工不参加集合，它们照旧从左右两边进场。':
    'Plays the reference extension’s opening first: the home crew flies in from beyond the left and right edges (40–240px out, spread over 5–95% of the viewport height) and orbits the viewport centre at 0.7 of the usual radius. It scatters to claim work the moment the reader wheels, or a cursor comes within 48px of the pointer; left alone it starts after at most 2.4s. Until then the camera stays put, no job is handed out and the score waits. Off means cursors simply appear next to their own tasks and work starts on frame one. Temps hired by “Grow and shrink” do not join the cluster; they keep arriving from the left and right edges as before.',
  '活怎么到手。按队列 = 开局就按「构建顺序」每人切一条带，只在自己的带里领，抢也只在这堆里找。运行时挑 = 整页一个池子，每次空手都按参考实现的代价现挑：不在这一屏的先付一百万，带外的纵向距离乘 0.6，离自己纵向多远乘 0.4，参考线反方向优惠 50 万——于是永远是「眼前这屏从上往下」，人追着活跑而不是守着一条带。':
    'How a job is won. “From its own queue” cuts one band per cursor up front by “Build order”, and each cursor works its own band, reaching elsewhere only when it is blocked. “Priced each frame” puts the whole page in one pool and prices every free job the way the reference does: off this screen costs a million first, distance outside the band is worth ×0.6, distance from this cursor ×0.4, and a guide gets a 500k rebate — so it is always “this screen, top to bottom”, with cursors chasing the work instead of guarding a band.',
  '什么时候允许领某一件。第一帧全放 = 整页从开局就是敞开的。随滚动 = 只有顶边进了这一屏（视口底边那条线）的元素才算到了，前沿只降不升，所以构建跟着读者往下走。要么开「镜头跟随」，要么宿主页面自己会滚，否则滚不到的那半页永远不解锁。':
    'When an item may be claimed. “Open from frame one” releases the whole page immediately. “Unlock as you scroll” readies only items whose top edge has entered this screen, and the frontier never moves back up, so the build follows the reader downward. Turn on “Camera follow” or let the host page scroll, otherwise the half nobody reaches stays locked forever.',
  '活堆得越多时钟走得越快：每帧按「已解锁还没人领」的件数重算倍速，等于当前基准乘 min(1 + 积压 × 0.45, 4)，最多到 4 倍。开了以后「速度」和「目标时长」就不是定论而是地面值，dense 页面收尾会明显快于估算。':
    'The clock quickens as work piles up: every frame the multiplier is recomputed from the jobs that are unlocked but unclaimed, as the current pace × min(1 + backlog × 0.45, 4), four times at most. With it on, “Speed” and “Target duration” become the floor rather than the verdict, and a dense page lands noticeably sooner than the estimate says.',
  '采蓝图之前先看多少页。单次 = 同步走一遍 DOM，现在排得出什么就建什么。预滚动 = 参考扩展的那一遍：先等字体和图片（各有上限），再找出这页真正靠谁滚（后台壳那种 main 自己 overflow:auto 的，滚窗口一格都不动），往下走最多 28 屏把懒加载和 content-visibility 的内容逼出来，回顶、落定，然后才采。改成「单次采集」时，第三方页面建出来缺图、看不出有多长，就是因为少了这一遍。':
    'How much of the page the capture pass sees. “One pass” walks the DOM synchronously and builds whatever is already laid out. “Pre-scroll pass” is the extension’s pass: it waits for fonts and images (each with a limit), works out what actually scrolls this page — in an app shell whose main carries overflow:auto, scrolling the window moves nothing — walks down up to 28 screens to force lazy-loaded and content-visibility content to materialise, returns to the top, settles, and only then captures. Switch to “One pass” and a third-party page comes out with missing images, or shorter than it really is, because that pass never ran.',
  '音效开着的时候放什么。不出旋律 = 只有合成的按键、拉框、盖章三声。生成式 = 复刻那套配器：104 BPM 的十六分格，E 小调五声从 MIDI 40 起，玻璃钢琴音色叠了一根 2.756 的不谐和泛音，盒子面积定音区、横向位置定音级，一个八分槽只许一个音、同时最多 28 个声部，混响是现算的 3.2 秒脉冲，声像跟着光标走，收尾一记 E 大调 add9 扫弦。':
    'What plays once sound is on. “Clicks only” is the synthesised set of three: key, drag, stamp. “Generative score” is the reference’s arrangement: a 104 BPM sixteenth grid, E-minor pentatonic from MIDI 40, glass-piano voices carrying an inharmonic 2.756 partial, box area choosing the octave and horizontal position the degree, one note per eighth-note slot and 28 voices at once, a room impulse computed on the spot at 3.2 seconds, panning that follows the cursor, and an E-major add9 strum to close.',
  '「音效」没开，配乐没有出口。': '“Sound” is off, so the score has nowhere to go.',
  '读者勾了 prefers-reduced-motion: reduce 时怎么办。直接交还 = 参考库自己的规则，什么都不演，立刻报完成把真页面还回去。照跑 = 这是装饰不是视差陷阱，宿主既然调了库就演给他看。':
    'What to do when the reader asks for reduced motion. “Hand back at once” is the reference library’s own rule: nothing is animated, the run reports complete, and the real page comes back immediately. “Run anyway” treats this as decoration rather than a parallax trap — the host called the library, so show them the build.',
};

/**
 * 动态串：带 {0} 占位的模板。中文侧只做替换，英文侧先查同样的键。
 * 状态行、脏项提示这些每秒会变的话都从这里出，避免把数字拼进中文再反过来猜。
 */
const UI_TEMPLATES: Record<string, string> = {
  '开场聚群 · {0} 个光标': 'Gathering · {0} cursors',
  '{0} 个光标 · {1}/{2} 项': '{0} cursors · {1}/{2} items',
  '{0} 个光标 · {1}/{2} 项 · 滚动以继续施工': '{0} cursors · {1}/{2} items · scroll to keep building',
  '已暂停 · 完成 {0}/{1}': 'Paused · {0}/{1} done',
  '完成 {0} 项 · {1} 个光标 · 用时 {2}s': 'Done: {0} items · {1} cursors · {2}s',
  '完成 {0} 项 · {1} 个光标 · 用时 {2}s · 丢弃 {3}': 'Done: {0} items · {1} cursors · {2}s · {3} dropped',
  '完成 {0} 项': 'Done: {0} items',
  '{0} 光标 · 上限 {1}': '{0} cursors · cap {1}',
  '采蓝图中…': 'Reading the page…',
  '已继续': 'Resumed',
  '已暂停': 'Paused',
  '已重置为库默认值': 'Reset to library defaults',
  '已恢复原状': 'Page restored',
  '配置已复制到剪贴板': 'Config copied to clipboard',
  '已选中片段，按 Ctrl+C 复制': 'Snippet selected — press Ctrl+C',
  '{0} 项待生效 · 点「应用并重跑」': '{0} pending · hit “Apply & rerun”',
  '已与正在跑的这一局一致': 'In sync with the run in progress',
  '改完点「应用并重跑」': 'Hit “Apply & rerun” when done',

  // 班组名片：按钮、画在图上的字、以及生成前后那两句状态。
  '名片': 'Crew card',
  '班组名片': 'Crew card',
  '关闭名片': 'Close card',
  '把这一局的班组画成一张可分享的图片：每位光标的姓名、性格与竣工数，标出 MVP，附总项数、用时与种子。跑完一局才能出图；图片只在面板里看，用系统长按或右键保存。':
    'Draw this run’s crew as a shareable image: each cursor’s name, personality and finished count, an MVP badge, plus the total, duration and seed. Available once a run finishes; the image is shown inside the panel — long-press or right-click to save it.',
  '重建班组': 'Rebuild crew',
  '同一种子，回放同一支队伍': 'Same seed, same crew',
  '这一局还没跑完，完成后才能出名片': 'Finish a run to draw its crew card',
  '这个环境画不出名片': 'This browser cannot draw the card',
  '班组名片已生成，长按或右键保存': 'Crew card ready — long-press or right-click to save',
};

function fill(text: string, args: (string | number)[]): string {
  return text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

export function phrase(lang: Lang, text: string, ...args: (string | number)[]): string {
  if (lang === 'zh') return fill(text, args);
  const mapped = UI_TEMPLATES[text] ?? UI[text];
  return fill(mapped ?? text, args);
}

// 中文标点、汉字与全角形式；区间起点避开 U+3000（全角空格），否则整个 ASCII 都会命中。
const CJK = /[、-〿㐀-鿿！-￯]/;
const ATTRS = ['data-tip', 'title', 'aria-label', 'placeholder'];

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 把一棵已经建好的子树换成当前语言；查不到的保持中文，不猜。 */
export function localize(root: ParentNode, lang: Lang): void {
  if (lang === 'zh') return;
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? '';
      if (!CJK.test(raw)) return;
      const mapped = UI_TEMPLATES[norm(raw)] ?? UI[norm(raw)];
      if (mapped !== undefined) node.textContent = mapped;
      return;
    }
    if (node.nodeType === 1) {
      const el = node as Element;
      // 样式里的中文注释不是文案，查表只会白查。
      if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return;
      for (const name of ATTRS) {
        const value = el.getAttribute(name);
        if (!value || !CJK.test(value)) continue;
        const mapped = UI_TEMPLATES[norm(value)] ?? UI[norm(value)];
        if (mapped !== undefined) el.setAttribute(name, mapped);
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(root);
}
