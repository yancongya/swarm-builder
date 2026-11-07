export const LIB_STYLE_ID = 'swarm-builder-style';

export const CSS = `
.sb-overlay{position:absolute;left:0;top:0;z-index:2147483000;pointer-events:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased;
  --sb-ghost:rgba(148,155,168,.22);--sb-edge:rgba(255,255,255,.5);--sb-copy-edge:rgba(120,200,255,.9)}
.sb-overlay[data-sb-theme="light"]{--sb-ghost:rgba(100,116,139,.2);--sb-edge:rgba(15,23,42,.55);
  --sb-copy-edge:rgba(37,99,235,.85)}
.sb-hidden{visibility:hidden!important}
.sb-item{position:absolute;box-sizing:border-box;opacity:0}
.sb-item--building{background:var(--sb-ghost);outline:1px dashed var(--sb-edge);
  outline-offset:-1px;opacity:1}
.sb-item--live{opacity:1}
.sb-copy{background:var(--sb-ghost);outline:1px dashed var(--sb-copy-edge);
  outline-offset:-1px;opacity:1;pointer-events:none}
.sb-guide{position:absolute;background:rgba(255,120,190,.9);opacity:0;pointer-events:none}
.sb-fixed{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none}
.sb-text{position:absolute;box-sizing:border-box;white-space:pre-wrap;opacity:1;margin:0;padding:0}
.sb-caret{position:absolute;width:2px;background:currentColor;border-radius:1px}
.sb-cursor{position:absolute;left:0;top:0;will-change:transform;color:#fff}
.sb-cursor[hidden]{display:none}
.sb-cursor__arrow,.sb-cursor__ibeam{position:absolute;left:0;top:0;display:none}
.sb-cursor.is-arrow .sb-cursor__arrow{display:block}
.sb-cursor.is-ibeam .sb-cursor__ibeam{display:block}
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
.sb-ghost{position:absolute;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;
  border:1px solid currentColor;border-radius:2px;display:none}
.sb-cursor.is-dragging .sb-ghost{display:block}
`;

export function injectStyle(): void {
  if (document.getElementById(LIB_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LIB_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
