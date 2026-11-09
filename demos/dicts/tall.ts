/** 中文原文（折叠空白后）→ English。由 ../lang.ts 的文本节点走查消费。 */
export const ROWS: [string, string][] = [
  // shell
  ['Swarm Builder · 长页面', 'Swarm Builder · Long page'],
  ['长页面 · 镜头跟随', 'Long page · camera follow'],
  ['这一页约 3300px 高，窗口只有半屏。构建顺序选「自上而下」，滚动跟着施工前沿走，看完一遍就知道镜头在跟谁。',
    'This page runs about 3300px tall and the window is only half a screen. The build order is "top to bottom", so the scroll follows the construction front — one pass and you can see exactly what the camera is chasing.'],

  // 01 blueprint
  ['01 · 采蓝图', '01 · Capturing the blueprint'],
  ['快照先遍历一次 DOM，把每个元素压成矩形、文本和样式三张图纸。它只读不写，所以页面此刻什么样，蓝图就什么样；后面的重建不会再回看原页面一眼。',
    'The snapshot walks the DOM once and compresses every element into three drawings: a rectangle, its text, its style. It only reads, never writes, so the blueprint is the page exactly as it stands — the rebuild never glances back at the original.'],
  ['蓝图示意图', 'Blueprint diagram'],
  ['每个元素压成一个带坐标的盒子', 'Every element becomes a box with coordinates'],
  ['分组示意图', 'Grouping diagram'],
  ['重复的兄弟节点归到同一组', 'Repeated siblings are filed into one group'],
  ['超过条目上限的部分计入「丢弃」，不会悄悄少做。', 'Anything past the item cap is counted as "dropped" — work is never quietly skipped.'],
  ['隐藏元素与零宽容器不进蓝图。', 'Hidden elements and zero-width containers stay out of the blueprint.'],
  ['固定定位的元素单独记一层，滚动时不会漂。', 'Fixed-position elements are recorded on their own layer, so they never drift while scrolling.'],

  // 02 scheduling
  ['02 · 排工', '02 · Assigning the work'],
  ['调度器决定谁做哪一块。子树并行最快，一个光标包一栋楼；自上而下则把页面切成横带，每个光标守一条带往下走。父盒子永远是子元素的依赖，所以顺序可以换，依赖不能破。',
    'The scheduler decides who takes which piece. Subtree parallelism is the fastest: one cursor owns a whole building. Top to bottom slices the page into horizontal bands and each cursor works its band downward. A parent box is always a dependency of its children, so the order may change but the dependency may not.'],
  ['「子树并行」：按根节点的子树分堆，大的先切小再摊平。', '"Subtree parallel": pile up by the root child subtrees; an oversized one is split first, then flattened.'],
  ['「自上而下」：按中心 y 排序后等分，光标 0 在最上面那条带。', '"Top to bottom": sort by center y, then divide evenly — cursor 0 holds the top band.'],
  ['「随机」：用种子洗牌，同一颗种子能重放同一场施工。', '"Random": shuffle with the seed, so the same seed replays the same build.'],
  ['谁卡住了就去别人的队里拿一件能做的，不留空等的光标。', 'A cursor that stalls picks a doable job from another queue, so no cursor is left waiting.'],

  // 03 boxes
  ['03 · 画盒子', '03 · Drawing the boxes'],
  ['光标飞过去，灰盒从左上角拉出尺寸，再补上边框、圆角和底色。这一段最容易露馅：如果盒子中途改位置，笔就画歪了，所以位置在起手那一刻就定死。',
    'A cursor flies over, the grey box is pulled to size from its top-left corner, then the border, radius and background land on top. This is where the trick shows most easily: if the box moved mid-stroke the pen would draw crooked, so the position is fixed the instant the stroke begins.'],
  ['盒子生长', 'Box growth'],
  ['灰盒一边拉一边定尺寸', 'The grey box is dragged out to size'],
  ['补样式', 'Styling pass'],
  ['再补上底色与圆角', 'Background color and rounded corners follow'],

  // 04 typing
  ['04 · 打字', '04 · Typing the text'],
  ['文本不是淡入的，是一个字符一个字符敲出来的，光标带着插入点往前走。标题可以一边打字一边长到真实字号，这样大标题不会先缩成一小坨再突然撑开。',
    'Text never fades in — it is typed one character at a time while the cursor carries the caret along. A heading can grow to its real size as it is typed, so a large title does not shrink into a blob and then snap open.'],
  ['行间距按真实字体度量算，不靠估。', 'Line spacing is computed from real font metrics, not estimated.'],
  ['标题步进可以在面板里关掉。', 'Heading stepping can be switched off in the panel.'],
  ['键盘声按秒限量，密集页面也不会变成噪音。', 'Keyboard sounds are rate limited per second, so even a dense page stays out of noise territory.'],

  // 05 stamping
  ['05 · 盖章', '05 · Stamping the copies'],
  ['同一组重复内容只真做一个，其余按住 Option 拖出去复印。副本是一次淡入，不重画也不重打字——一百行列表里逐个打字，看着像坏了，不像在建。',
    'A repeated group is really built once; the rest are dragged out as copies while holding Option. A copy is a single fade in — no redraw, no retyping. Typing a hundred-row list one line at a time looks broken, not under construction.'],
  ['母版与副本', 'Master and copies'],
  ['实心的是母版，半透明的是盖章出来的', 'Solid is the master, translucent is stamped'],

  // 06 guides
  ['06 · 辅助线', '06 · Guides'],
  ['三个以上元素对齐同一条线，就把那条线画出来，元素最后再吸附上去。它借的是排版本来就存在的网格，所以关掉以后页面还是那个页面，只是少了脚手架。',
    'When three or more elements share one line, that line is drawn and the elements snap onto it at the end. It borrows the grid the layout already has, so switching guides off leaves the same page — just without the scaffolding.'],
  ['密集页面自动少画，线条多了会糊成一张网。', 'Dense pages automatically draw fewer of them; too many lines blur into a net.'],
  ['线条颜色按页面底色挑，浅底用深墨、深底用浅墨。', 'Line color is chosen from the page background: dark ink on a light page, light ink on a dark one.'],

  // 07 handoff
  ['07 · 交还', '07 · Handing back'],
  ['最后一帧，重建层淡出，真实页面回到原位。镜头在此之前一直跟着施工前沿跑，结束时把滚动交回页首——这一局做了什么，从头看一遍就知道了。',
    'On the last frame the rebuild layer fades out and the real page returns to its place. Until then the camera has been running with the construction front, and at the end the scroll is handed back to the top — watch it from the beginning and you know what this run built.'],

  // colophon
  ['页面高度约 3300px · 视口约 700px · 镜头至少滚动 4 次才算跟上。',
    'Page height about 3300px · viewport about 700px · the camera has to scroll at least 4 times to count as following.'],
];
