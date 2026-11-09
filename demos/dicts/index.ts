/** 中文原文（折叠空白后）→ English。由 ../lang.ts 的文本节点走查消费。 */
export const ROWS: [string, string][] = [
  // 外壳静态 DOM（index.html）
  ['Swarm Builder · 为你的网页开始创造模式，集群构建前端！', 'Swarm Builder · Start creator mode on your web page — build the front end with a swarm.'],
  ['案例', 'Cases'],
  ['新标签页：输入一个地址，让光标把它盖出来', 'New tab: type an address and let the cursors build it'],
  ['新标签页', 'New tab'],
  ['后退', 'Back'],
  ['前进', 'Forward'],
  ['重新载入这一页', 'Reload this page'],
  ['创造者模式：所有参数都在这一个面板里改，改完点「应用并重跑」', 'Creator mode: every parameter is edited in this one panel — change it, then press "Apply & rerun"'],
  ['创造者模式', 'Creator mode'],
  ['界面语言：中文 / English', 'Interface language: Chinese / English'],
  ['切换界面语言', 'Switch interface language'],
  ['中/EN', 'ZH/EN'],
  ['GitHub 仓库：源码、Issue 与发行说明', 'GitHub repo: source, issues and release notes'],
  ['案例页面', 'Case page'],
  ['输入一个地址，看这群光标把它盖出来', 'Type an address and watch this swarm of cursors build it'],
  ['https:// 或 ./tune.html', 'https:// or ./tune.html'],
  ['网址', 'Address'],
  ['重建', 'Rebuild'],
  [
    '能取到 HTML 的站点（同源，或对方允许跨域）会被剥掉脚本后原样重建，参数照样在创造者模式里改； 取不到的只能嵌进来显示——读不到 DOM 就不假装能盖。双语只覆盖仓库里这几页，抓进来的第三方页面保持它自己的原文。',
    'A site whose HTML we can fetch (same origin, or one that allows cross-origin reads) gets its scripts stripped and is rebuilt as itself, with the parameters still editable in Creator mode; a site we cannot fetch is only embedded — if the DOM cannot be read, we do not pretend to build. Bilingual covers the pages in this repo; a grabbed third-party page keeps its own text.',
  ],
  ['准备中', 'Getting ready'],

  // browser.ts 的 CASES 标题（makeTab 里走 tr(item.title)）
  ['产品说明页', 'Product page'],
  ['简单页基准', 'Simple page baseline'],
  ['密集控制台', 'Dense console'],
  ['深色落地页', 'Dark landing page'],
  ['复杂工作台', 'Complex workbench'],
  ['长页面跟随', 'Long page with camera follow'],
  ['别人的站点', "Someone else's site"],

  // blank 页上的三条现成地址（CHIPS 标签）
  ['这一页自己', 'This page itself'],

  // browser.ts 运行时写进 chrome 的句子
  ['关闭标签', 'Close tab'],
  ['载入中…', 'Loading…'],
  ['取这一页的 HTML…', "Fetching this page's HTML…"],
  ['这一页没有装上创造者模式', 'This page did not pick up Creator mode'],
  ['这一页取到了，但创造者模式没装上', "This page came through, but Creator mode did not pick up"],
  ['新标签页：输入一个地址，回车就开工', 'New tab: type an address and press Enter to start'],
  ['这个地址读不懂（只认 http/https，或站内相对路径）', 'That address cannot be read (only http/https, or a path relative to this site)'],
  ["读不到这一页的 DOM（{0}）：只能原样显示，重建不了", "Cannot read this page's DOM ({0}): it can only be shown as-is, not rebuilt"],
  ['直连：', 'Direct fetch: '],
  ['同源转发：', 'Same-origin forwarder: '],
  ['不是 HTML（{0}）', 'Not HTML ({0})'],
  ['未知类型', 'unknown type'],
  ['超时（6 秒内没返回）', 'Timed out (no reply within 6 seconds)'],
  ['{0} 个盒子在画', '{0} boxes on the board'],
];
