import { getLang } from './lang';
import logoSvg from '../minitool/brand/animation/logo-loop.svg?raw';

type Phase = 'idle' | 'scanning' | 'gathering' | 'building' | 'paused' | 'done';
type OrbTarget = { orb: HTMLElement; rect: DOMRect } | null;

let logoSerial = 0;

// 资产里 13 条 animateTransform 全是 dur="3s" repeatCount="indefinite"：一圈就是 3 秒。
const LOOP_MS = 3000;

const reduceMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountLogo(host: HTMLElement | null): void {
  if (!host) return;
  if (reduceMotion()) {
    const img = host.ownerDocument.createElement('img');
    img.src = new URL('./logo-static.png', location.href).href;
    img.alt = '';
    host.replaceChildren(img);
  } else {
    // 同页可能挂多份（进场 + 悬浮球 + 首页）：渐变/滤镜/指针的 id 不加后缀会互相串引用。
    const suffix = `-m${++logoSerial}`;
    host.innerHTML = logoSvg
      .replace(/id="([^"]+)"/g, `id="$1${suffix}"`)
      .replace(/url\(#([^)]+)\)/g, `url(#$1${suffix})`)
      .replace(/href="#([^"]+)"/g, `href="#$1${suffix}"`);
    // 资产里的 aria-label 是中文源文案；挂载晚于字典扫页，EN 档要在这里自己换掉。
    host.querySelector('svg')?.setAttribute('aria-label', getLang() === 'en'
      ? 'Swarm Builder animated cursor-swarm logo'
      : 'Swarm Builder 彩色光标集群循环标识');
  }
}

export function decorateOrb(orb: HTMLElement): void {
  const root = orb.getRootNode();
  // 母本的球在 iframe 里：那是另一个 realm，`instanceof ShadowRoot` 恒为 false，
  // 样式会被整段跳过（球里的 logo 于是一直吃面板默认尺寸，四周全是空隙）。认形状。
  const shadow = 'host' in root ? (root as ShadowRoot) : null;
  if (shadow && !shadow.querySelector('[data-logo-motion-style]')) {
    const style = orb.ownerDocument.createElement('style');
    style.dataset.logoMotionStyle = '';
    // 品牌标识自己就是一枚圆形徽章（深色描边的轨道 + 中心方块），再垫一颗石墨球
    // 只会在四周留出一圈空隙：这里把球体让给标识本体铺满，浮起感交给投影。
    style.textContent = '.orb{border:0;background:none;box-shadow:none;overflow:visible;'
      + 'transition:transform .18s ease}'
      + '.orb:hover{transform:scale(1.06)}'
      + '.orb .logo-motion{display:block;width:100%;height:100%;'
      + 'filter:drop-shadow(0 8px 18px rgba(0,0,0,.42))}'
      + '.orb .logo-motion svg,.orb .logo-motion img{display:block;width:100%;height:100%}';
    shadow.append(style);
  }
  const wrap = orb.ownerDocument.createElement('span');
  wrap.className = 'logo-motion';
  mountLogo(wrap);
  orb.replaceChildren(wrap);
}

/** The shell draws only the logo; the cursors belong to SwarmBuilder's real gather phase. */
export function createBootIntro(center: () => DOMRect, target: () => OrbTarget, onLanding?: () => void) {
  const el = document.querySelector<HTMLElement>('[data-boot-intro]');
  const inner = el?.querySelector<HTMLElement>('.boot-intro-inner');
  const title = el?.querySelector<HTMLElement>('[data-intro-title]');
  const note = el?.querySelector<HTMLElement>('[data-intro-note]');
  let active = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let hiddenOrb: HTMLElement | null = null;
  // 开场标识至少播满一圈才放行施工。取资源的耗时本来就在这一圈里，所以页面取得慢时
  // 不会额外多等；只有资源秒回的那条路才真的停满 3 秒。
  let loopTimer: ReturnType<typeof setTimeout> | null = null;
  let loopDone: Promise<void> = Promise.resolve();
  let markLoopDone: () => void = () => {};

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
    // 中止/降级也要放行：等这一圈的人不该被永远挂住。
    if (loopTimer !== null) clearTimeout(loopTimer);
    loopTimer = null;
    markLoopDone();
    if (hiddenOrb) hiddenOrb.style.visibility = '';
    hiddenOrb = null;
  };
  const place = (): void => {
    if (!inner) return;
    const rect = center();
    inner.style.left = `${rect.left + rect.width / 2}px`;
    inner.style.top = `${rect.top + rect.height / 2}px`;
  };
  const finish = (fly: boolean): void => {
    if (!el || !inner || !active || el.dataset.state === 'handoff') return;
    const destination = fly ? target() : null;
    if (!destination) {
      clear();
      el.hidden = true;
      active = false;
      onLanding?.();
      return;
    }
    const mine = generation;
    hiddenOrb = destination.orb;
    hiddenOrb.style.visibility = 'hidden';
    el.dataset.state = 'handoff';
    inner.getBoundingClientRect();
    // 落点尺寸按悬浮球实测：写死的缩放比会在球径一改时露出一圈错位。
    const mark = inner.querySelector<HTMLElement>('.logo-motion');
    const scale = mark && mark.offsetWidth > 0 ? destination.rect.width / mark.offsetWidth : 0.2;
    inner.style.left = `${destination.rect.left + destination.rect.width / 2}px`;
    inner.style.top = `${destination.rect.top + destination.rect.height / 2}px`;
    inner.style.transform = `translate(-50%, -50%) scale(${scale})`;
    timer = setTimeout(() => {
      if (mine !== generation) return;
      // 飞到位不等于交接完成：这一刻两份 logo 同大同位，交叉淡一下，
      // 球（连名字牌）淡入、飞行层淡出，才是同一枚标识换了个身份。
      const entry = hiddenOrb?.parentElement;
      // 两份标识各自跑 SMIL，相位不同就会在交叠那 280ms 里露出重影。
      // 把球里那份拨到飞行层当前的时间，交叠期两帧完全重合。
      const flySvg = inner.querySelector('svg');
      const orbSvg = hiddenOrb?.querySelector('svg');
      if (flySvg && orbSvg && typeof orbSvg.setCurrentTime === 'function') {
        orbSvg.setCurrentTime(flySvg.getCurrentTime());
      }
      if (hiddenOrb) hiddenOrb.style.visibility = '';
      onLanding?.();
      if (entry && !reduceMotion() && typeof entry.animate === 'function') {
        entry.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
      }
      inner.style.transition = 'opacity .28s ease';
      inner.style.opacity = '0';
      timer = setTimeout(() => {
        if (mine !== generation) return;
        clear();
        el.hidden = true;
        active = false;
      }, 280);
    }, 620);
  };

  return {
    show(): void {
      if (!el || !inner || reduceMotion()) return;
      clear();
      generation++;
      active = true;
      inner.style.transition = 'none';
      inner.style.opacity = '1';
      inner.style.transform = 'translate(-50%, -50%)';
      place();
      if (title) title.textContent = getLang() === 'en' ? 'Creator mode is warming up' : '创造模式准备中';
      if (note) note.textContent = getLang() === 'en' ? 'Preparing page resources…' : '正在准备页面资源…';
      el.dataset.state = 'active';
      el.hidden = false;
      // 遮罩跨局复用同一枚 SVG：display:none 期间 Chromium 不再采样 SMIL，再显示时
      // getCurrentTime() 照走、动画值却冻在旧帧上（第二次开场 logo 就是不动的）。
      // 重新挂一份最省事：新元素自带新时间轴，每一局都从同一个姿势开场。
      mountLogo(inner.querySelector<HTMLElement>('.logo-motion'));
      loopDone = new Promise<void>((resolve) => { markLoopDone = resolve; });
      loopTimer = setTimeout(() => {
        loopTimer = null;
        markLoopDone();
      }, LOOP_MS);
      // 兜底：阶段消息永远不来（热更新竞态拿到死 tuner、iframe 启动失败）时，
      // 遮罩不能盖一辈子。正常流程几秒内就会进 building，30 秒只兜异常。
      watchdog = setTimeout(() => finish(false), 30000);
    },
    /** 标识播满一圈（或本次开场被取消/降级）后 resolve；外壳据此再开跑。 */
    played(): Promise<void> {
      return loopDone;
    },
    phase(phase: Phase): void {
      if (!active || !el) return;
      if (phase === 'scanning') {
        if (note) note.textContent = getLang() === 'en' ? 'Scanning page resources…' : '正在采集页面资源…';
      } else if (phase === 'gathering') {
        place();
        const destination = target();
        if (destination) {
          hiddenOrb = destination.orb;
          hiddenOrb.style.visibility = 'hidden';
        }
        el.dataset.state = 'gathering';
      } else if (phase === 'building' || phase === 'done') {
        if (inner) inner.style.transition = 'left .62s cubic-bezier(.2,.8,.2,1), top .62s cubic-bezier(.2,.8,.2,1), transform .62s cubic-bezier(.2,.8,.2,1)';
        finish(true);
      }
    },
    dismiss(): void { finish(false); },
  };
}
