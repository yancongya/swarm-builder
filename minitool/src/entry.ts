/**
 * minitool 入口：接上外壳样式与外壳逻辑。
 *
 * - demos/browser.css 是外壳母本样式（经 shell 的 fixCss('shell') 三段式改写）；
 * - shell-extra.css 覆盖「去 iframe 后的窗口滚动模型」差异；
 * - shell.start() 显式调用而不是裸 `import './shell'`——根 package.json 声明了
 *   sideEffects:false，纯副作用的裸 import 有被 tree-shaking 掉的风险。
 */
import '../../demos/browser.css';
import '../../demos/boot-intro.css';
import './shell-extra.css';
import { start } from './shell';

start();
