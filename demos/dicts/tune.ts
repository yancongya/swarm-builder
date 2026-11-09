/** 中文原文（折叠空白后）→ English。由 ../lang.ts 的文本节点走查消费。 */
export const ROWS: [string, string][] = [
  ['Swarm Builder · 创造者模式嵌入宿主页', 'Swarm Builder · Creator Mode Embedded in a Host Page'],
  [
    '这一页假装是「别人的网站」：全局裸选择器、和面板撞名的类名、衬线字体。 创造者模式挂在 body 上、活在 shadow root 里，所以它既不会被这些规则改样，也不会被当成待重建的内容抓进蓝图。',
    'This page pretends to be somebody else\u2019s website: bare global selectors, class names that collide with the panel, and a serif face. Creator mode hangs off body and lives inside a shadow root, so none of these rules restyle it and it is never swept into the blueprint as content to rebuild.',
  ],

  // grid
  ['现场调参', 'Tune live'],
  [
    '光标数、速度、目标时长、上限、复制、辅助线、跟随、音效，全部可在真实页面上改。',
    'Cursor count, speed, target duration, limits, copying, guides, camera follow and sound \u2014 all of it changes on the real page.',
  ],
  ['应用并重跑', 'Apply & rerun'],
  [
    '蓝图在开始那一刻冻结，所以除速度外都要下一局生效。面板把这句话写在脚注里。',
    'The blueprint freezes the moment a run starts, so everything but speed takes effect on the next one. The panel spells this out in its footnote.',
  ],
  ['一键复制', 'One-click copy'],
  [
    '导出的是可直接粘贴的代码片段，只列与默认值不同的项，给人和给 agent 是同一份。',
    'What you export is a snippet you can paste straight in, listing only what differs from the defaults \u2014 one and the same for a person and for an agent.',
  ],

  // subscribe row and form
  ['订阅下一期：留下邮箱，我们只在出刊时发一封信。', 'Subscribe to the next issue: leave an email address and we write once, when it ships.'],
  ['邮箱', 'Email'],
];
