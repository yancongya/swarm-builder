export const LIB_STYLE_ID = 'swarm-builder-style';

export const CSS = `
.sb-overlay{position:absolute;left:0;top:0;z-index:2147483000;pointer-events:none;
  /* 施工层不该改变页面自身的滚动尺寸：光标箭头和标签在右边缘会伸出画框，手机上就是
     一条闪出来的横向滚动条。clip 只裁不滚（hidden 会顺带把另一轴也变成滚动容器），
     4px 余量留给带边框的 root——画框比 border box 短一个左边框宽。 */
  overflow-x:clip;overflow-clip-margin:4px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased;
  --sb-ghost:rgba(148,155,168,.22);--sb-edge:rgba(255,255,255,.5);--sb-copy-edge:rgba(147,165,79,.9)}
.sb-overlay[data-sb-theme="light"]{--sb-ghost:rgba(100,116,139,.2);--sb-edge:rgba(15,23,42,.55);
  --sb-copy-edge:rgba(107,122,53,.85)}
.sb-hidden{visibility:hidden!important}
.sb-item{position:absolute;box-sizing:border-box;opacity:0}
.sb-item--building{background:var(--sb-ghost);outline:1px dashed var(--sb-edge);
  outline-offset:-1px;opacity:1}
.sb-item--live{opacity:1}
.sb-copy{background:var(--sb-ghost);outline:1px dashed var(--sb-copy-edge);
  outline-offset:-1px;opacity:1;pointer-events:none}
.sb-guide{position:absolute;background:rgba(214,86,52,.9);opacity:0;pointer-events:none}
.sb-fixed{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none}
.sb-text{position:absolute;box-sizing:border-box;white-space:pre-wrap;opacity:1;margin:0;padding:0}
.sb-caret{position:absolute;width:2px;background:currentColor;border-radius:1px}
.sb-cursor{position:absolute;left:0;top:0;will-change:transform;color:#fff}
.sb-cursor[hidden]{display:none}
.sb-cursor__arrow,.sb-cursor__ibeam{position:absolute;left:0;top:0;display:none}
.sb-cursor.is-arrow .sb-cursor__arrow{display:block}
.sb-cursor.is-ibeam .sb-cursor__ibeam{display:block}
/* 待时物理（flight:'live'）才会写这两个变量：箭头朝行进方向歪过去，按下时沿竖直压扁。
   默认关着时两个变量都没有值，等价于不变化。 */
.sb-cursor__arrow,.sb-cursor__ibeam{transform-origin:1px 1px;
  transform:rotate(var(--tilt,0deg)) scale(1,calc(1 - .35*var(--press,0)))}
.sb-cursor__crosshair{position:absolute;display:none;inset:0}
.sb-cursor__crosshair::before,.sb-cursor__crosshair::after{content:"";position:absolute;
  background:currentColor;opacity:.75}
.sb-cursor__crosshair::before{left:-11px;top:0;width:22px;height:1px}
.sb-cursor__crosshair::after{left:0;top:-11px;width:1px;height:22px}
.sb-cursor.is-crosshair .sb-cursor__crosshair{display:block}
.sb-cursor.is-crosshair .sb-cursor__arrow{display:none}
.sb-name{position:absolute;left:14px;top:16px;padding:1px 5px;border-radius:4px;
  font-size:10px;line-height:14px;letter-spacing:.02em;white-space:nowrap;color:#0b0d10}
.sb-badge{position:absolute;left:16px;top:-6px;padding:2px 6px;border-radius:4px;
  font-size:10px;line-height:14px;white-space:nowrap;background:rgba(11,13,16,.82);color:#fff;
  display:none}
.sb-cursor.is-dragging .sb-badge{display:block}
/* 贴页面右边缘时把标签与徽章翻到光标左侧，半截伸出画框既读不了也会撑出横向滚动。 */
.sb-cursor[data-flip="left"] .sb-name{left:auto;right:14px}
.sb-cursor[data-flip="left"] .sb-badge{left:auto;right:16px}
.sb-ghost{position:absolute;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;
  border:1px solid currentColor;border-radius:2px;display:none}
.sb-cursor.is-dragging .sb-ghost{display:block}
/* 性格配件。速度线的浓淡由 setPosition 按帧间位移写 --sb-speed：站着不动就隐掉，
   赶路与待时飞行都走同一个 setter，两种移动带出同一条线。 */
.sb-trail{position:absolute;left:-3px;top:7px;opacity:var(--sb-speed,0);pointer-events:none}
.sb-trail i{position:absolute;height:1.5px;background:currentColor;border-radius:1px}
.sb-trail i:first-child{left:-13px;top:0;width:11px}
.sb-trail i:last-child{left:-17px;top:5px;width:7px}
.sb-ring{position:absolute;left:-8px;top:-8px;width:28px;height:28px;pointer-events:none;
  border:1px dashed currentColor;border-radius:50%;opacity:.5}
.sb-idle{position:absolute;left:16px;top:-14px;padding:0 5px;border-radius:6px;display:none;
  background:rgba(11,13,16,.72);color:#fff;font-size:10px;line-height:14px;pointer-events:none}
.sb-cursor.is-idling .sb-idle{display:block}
.sb-cursor[data-flip="left"] .sb-idle{left:auto;right:16px}
/* 开场点名：名牌逐个弹一下，延迟由 CursorLayer.rollCall 按进场顺序排。 */
@keyframes sb-roll{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}
.sb-name.sb-rolling{animation:sb-roll .45s ease both}
.sb-rollcall{position:absolute;transform:translateX(-50%);padding:3px 12px;border-radius:999px;
  background:rgba(11,13,16,.82);color:#fff;font-size:11px;line-height:16px;white-space:nowrap;
  pointer-events:none}
.sb-hud{position:fixed;left:0;right:0;bottom:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));
  z-index:2147483001;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;
  font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sb-hud__hint{padding:4px 12px;border-radius:999px;background:rgba(11,13,16,.82);color:#fff}
.sb-hud__hint[hidden]{display:none}
.sb-hud__bar{display:flex;align-items:center;gap:10px;padding:5px 6px 5px 14px;border-radius:999px;
  background:rgba(11,13,16,.82);color:#fff;pointer-events:auto}
.sb-hud__progress{font-variant-numeric:tabular-nums}
.sb-hud__skip{min-height:34px;padding:6px 16px;border:1px solid rgba(255,255,255,.4);border-radius:999px;
  background:transparent;color:#fff;font:inherit;cursor:pointer}
.sb-hud__skip:active{background:rgba(255,255,255,.2)}
`;

export function injectStyle(target: Document | ShadowRoot = document): void {
  if (target.querySelector(`#${LIB_STYLE_ID}`)) return;
  const style = document.createElement('style');
  style.id = LIB_STYLE_ID;
  style.textContent = CSS;
  (target instanceof Document ? target.head : target).appendChild(style);
}
