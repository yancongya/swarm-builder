/// <reference types="vite/client" />

/** 共享案例样式（demo.css + console.css，已过 fixCss 的三段式成品）。 */
declare module 'minitool:case-css' {
  const css: string;
  export default css;
}

/** 单个案例的处理后 HTML（已剥 script/link/target，内联 <style> 已过基线）。 */
declare module 'minitool:case-html:*' {
  const html: string;
  export default html;
}

/** 创造者面板 CSS（panel.ts 模板串抽出，已过 fixCss('shadow') 三段式成品）。 */
declare module 'minitool:panel-css' {
  const css: string;
  export default css;
}
