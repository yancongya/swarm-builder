/** 中文原文（折叠空白后）→ English。由 ../lang.ts 的文本节点走查消费。 */
export const ROWS: [string, string][] = [
  ['Swarm Builder · 简单页', 'Swarm Builder · Simple Page'],
  ['简单页基准', 'Simple page baseline'],
  [
    '最小场景：几个块、一段说明、三张卡片。用来确认重建链路是否跑通。',
    'The smallest case: a few blocks, one paragraph, three cards. Use it to confirm the rebuild pipeline runs end to end.',
  ],

  // cards
  ['遍历 DOM，产出矩形与文本蓝图。', 'Walks the DOM and produces a blueprint of rectangles and text.'],
  ['按文档顺序分给多个光标队列。', 'Hands the work out to several cursor queues in document order.'],
  ['独立层重建，结束后回到真实页面。', 'Rebuilds on its own layer, then hands the real page back.'],

  // list
  ['第一项：验证尺寸徽章与灰盒占位', 'Item one: size badges and gray-box placeholders'],
  // 尾部的空格是必须的：紧跟在后面的那枚标签会被当作下一个文本节点拼上来。
  ['第二项：验证打字与光标跟随', 'Item two: typing and camera follow '],
  ['含行内标签', 'inline tag included'],
  ['第三项：验证 onComplete 回调', 'Item three: the onComplete callback'],
];
