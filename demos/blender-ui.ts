/** Local Blender UI study interactions. Works in a document or the mini-tool shadow root. */
export function mountBlenderUi(root: ParentNode): () => void {
  const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: EventTarget | null,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    if (!target) return;
    const callback = handler as EventListener;
    target.addEventListener(type, callback);
    cleanups.push(() => target.removeEventListener(type, callback));
  };

  const splash = find<HTMLElement>('#splash');
  const picks = find<SVGSVGElement>('.scene-picks');
  const syncViewportFit = (): void => picks?.setAttribute('preserveAspectRatio',
    matchMedia('(max-width: 580px)').matches ? 'xMidYMid meet' : 'xMidYMid slice');
  syncViewportFit();
  window.addEventListener('resize', syncViewportFit);
  cleanups.push(() => window.removeEventListener('resize', syncViewportFit));
  const closeSplash = (): void => splash?.classList.add('hidden');
  root.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => listen(el, 'click', closeSplash));
  listen(find('#logo-btn'), 'click', () => splash?.classList.remove('hidden'));
  listen(splash, 'click', (event) => { if (event.target === splash) closeSplash(); });

  // The outer shell's logo intro and swarm run first. Show Blender's startup
  // dialog when that first build is complete, so it cannot disappear unseen.
  const pageDoc = (root as Node).ownerDocument ?? document;
  const shellDoc = pageDoc.defaultView?.frameElement?.ownerDocument ?? pageDoc;
  const embedded = root !== pageDoc || shellDoc !== pageDoc;
  if (embedded && shellDoc.documentElement.classList.contains('pre-build')) {
    closeSplash();
    const observer = new MutationObserver(() => {
      if (shellDoc.documentElement.classList.contains('pre-build')) return;
      observer.disconnect();
      splash?.classList.remove('hidden');
    });
    observer.observe(shellDoc.documentElement, { attributes: true, attributeFilter: ['class'] });
    cleanups.push(() => observer.disconnect());
  }

  const selectOne = (selector: string): void => {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      listen(el, 'click', () => {
        root.querySelectorAll<HTMLElement>(selector).forEach((item) => item.classList.remove('on', 'sel'));
        el.classList.add(selector === '.ol' || selector === '.cr' ? 'sel' : 'on');
        if (selector === '.tool') {
          const name = find<HTMLElement>('#tn');
          if (name) name.textContent = el.dataset.n ?? '';
        }
      });
    });
  };
  for (const selector of ['.tool', '.ws', '.pt', '.vm']) selectOne(selector);

  type SceneObject = 'Camera' | 'Cube' | 'Light';
  const objectNames: SceneObject[] = ['Camera', 'Cube', 'Light'];
  const fields = Array.from(root.querySelectorAll<HTMLInputElement>('.pbody .fld'));
  const defaults = fields.map((field) => field.value);
  const values: Record<SceneObject, string[]> = {
    Camera: [...defaults], Cube: [...defaults], Light: [...defaults],
  };
  let selected: SceneObject = 'Cube';
  const chooseObjects = (names: SceneObject[]): void => {
    if (!names.length) return;
    values[selected] = fields.map((field) => field.value);
    selected = names[names.length - 1] as SceneObject;
    root.querySelectorAll<HTMLElement>('.ol[data-object], .cr[data-object]').forEach((el) =>
      el.classList.toggle('sel', names.includes(el.dataset.object as SceneObject)));
    root.querySelectorAll<SVGElement>('.pick[data-object]').forEach((el) => {
      const active = names.includes(el.dataset.object as SceneObject);
      el.classList.toggle('selected', active);
      el.setAttribute('aria-pressed', String(active));
    });
    fields.forEach((field, index) => { field.value = values[selected][index] ?? defaults[index] ?? ''; });
  };
  const chooseObject = (name: SceneObject): void => chooseObjects([name]);
  root.querySelectorAll<HTMLElement | SVGElement>('[data-object]').forEach((el) => {
    const name = el.getAttribute('data-object');
    if (!objectNames.includes(name as SceneObject)) return;
    listen(el, 'click', () => chooseObject(name as SceneObject));
    if (el.classList.contains('pick')) listen(el, 'keydown', (event) => {
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault();
        chooseObject(name as SceneObject);
      }
    });
  });
  chooseObject('Cube');

  const view = find<HTMLElement>('.vp-view');
  const scene = find<HTMLElement>('.scene-canvas');
  let zoom = 1.22;
  let panX = 0;
  let panY = 0;
  const renderView = (): void => {
    if (scene) scene.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };
  const wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const bounds = view?.getBoundingClientRect();
    if (!bounds) return;
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const next = Math.max(1.22, Math.min(3.5, zoom * Math.exp(-event.deltaY * 0.001)));
    const ratio = next / zoom;
    panX = x - (x - panX) * ratio;
    panY = y - (y - panY) * ratio;
    zoom = next;
    renderView();
  };
  view?.addEventListener('wheel', wheel, { passive: false });
  cleanups.push(() => view?.removeEventListener('wheel', wheel));
  let panStart: { x: number; y: number; baseX: number; baseY: number; pointerId: number } | null = null;
  let dragStart: { x: number; y: number; pointerId: number } | null = null;
  let marquee: HTMLElement | null = null;
  const drawMarquee = (x: number, y: number): void => {
    if (!dragStart || !marquee) return;
    const bounds = view?.getBoundingClientRect();
    if (!bounds) return;
    const left = Math.max(0, Math.min(dragStart.x, x) - bounds.left);
    const top = Math.max(0, Math.min(dragStart.y, y) - bounds.top);
    marquee.style.left = `${left}px`;
    marquee.style.top = `${top}px`;
    marquee.style.width = `${Math.abs(x - dragStart.x)}px`;
    marquee.style.height = `${Math.abs(y - dragStart.y)}px`;
  };
  listen(view, 'pointerdown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      panStart = { x: event.clientX, y: event.clientY, baseX: panX, baseY: panY, pointerId: event.pointerId };
      view?.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || (event.target as Element).closest('.pick')) return;
    dragStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    marquee = document.createElement('div');
    marquee.className = 'selection-marquee';
    view?.append(marquee);
    view?.setPointerCapture(event.pointerId);
    drawMarquee(event.clientX, event.clientY);
  });
  listen(view, 'pointermove', (event) => {
    if (panStart?.pointerId === event.pointerId) {
      panX = panStart.baseX + event.clientX - panStart.x;
      panY = panStart.baseY + event.clientY - panStart.y;
      renderView();
      return;
    }
    if (dragStart?.pointerId === event.pointerId) drawMarquee(event.clientX, event.clientY);
  });
  const finishMarquee = (event: PointerEvent): void => {
    if (panStart?.pointerId === event.pointerId) {
      panStart = null;
      return;
    }
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const start = dragStart;
    dragStart = null;
    marquee?.remove();
    marquee = null;
    if (Math.abs(event.clientX - start.x) < 5 && Math.abs(event.clientY - start.y) < 5) return;
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    const right = Math.max(start.x, event.clientX);
    const bottom = Math.max(start.y, event.clientY);
    const hits = Array.from(root.querySelectorAll<SVGElement>('.pick[data-object]'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.left < right && box.right > left && box.top < bottom && box.bottom > top;
      })
      .map((el) => el.dataset.object as SceneObject);
    chooseObjects(hits);
  };
  listen(view, 'pointerup', finishMarquee);
  listen(view, 'pointercancel', finishMarquee);
  listen(view, 'auxclick', (event) => event.preventDefault());
  cleanups.push(() => marquee?.remove());

  const ruler = find<HTMLElement>('#ruler');
  if (ruler && !ruler.querySelector('.tick')) {
    for (let i = 0; i <= 27; i++) {
      const x = i * 25;
      const tick = document.createElement('div');
      tick.className = `tick ${i % 5 === 0 ? 'maj' : 'min'}`;
      tick.style.left = `${x}px`;
      ruler.append(tick);
      if (i % 5 === 0) {
        const label = document.createElement('div');
        label.className = 'tlab';
        label.style.left = `${x}px`;
        label.textContent = String(i === 0 ? 1 : i * 10);
        ruler.append(label);
      }
    }
  }

  let frame = 1;
  const maxFrame = 250;
  let timer: number | null = null;
  const frameLabel = find<HTMLElement>('#fr');
  const playhead = find<HTMLElement>('#ph');
  const playButton = find<HTMLElement>('#pl');
  const update = (): void => {
    if (frameLabel) frameLabel.textContent = String(frame);
    if (playhead) playhead.style.left = `${(frame / maxFrame) * 680}px`;
  };
  const pause = (): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    if (playButton) {
      playButton.textContent = '▶';
      playButton.classList.remove('play');
    }
  };
  const play = (): void => {
    if (timer !== null) return;
    if (playButton) {
      playButton.textContent = '⏸';
      playButton.classList.add('play');
    }
    timer = window.setInterval(() => { frame = frame >= maxFrame ? 1 : frame + 1; update(); }, 1000 / 24);
  };
  listen(playButton, 'click', () => timer === null ? play() : pause());
  const step = (selector: string, next: () => number): void => listen(find(selector), 'click', () => {
    pause();
    frame = next();
    update();
  });
  step('#s0', () => 1);
  step('#sp', () => Math.max(1, frame - 1));
  step('#sn', () => Math.min(maxFrame, frame + 1));
  step('#se', () => maxFrame);
  listen(find('#ta'), 'click', (event) => {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    frame = Math.max(1, Math.min(maxFrame, Math.round(((event.clientX - rect.left) / 680) * maxFrame)));
    pause();
    update();
  });
  const keydown = (event: KeyboardEvent): void => {
    if (splash && !splash.classList.contains('hidden') && (event.code === 'Escape' || event.code === 'Enter')) {
      closeSplash();
    } else if (event.code === 'Space' && splash?.classList.contains('hidden')) {
      event.preventDefault();
      timer === null ? play() : pause();
    }
  };
  document.addEventListener('keydown', keydown);
  cleanups.push(() => document.removeEventListener('keydown', keydown));
  update();

  return () => {
    pause();
    cleanups.forEach((cleanup) => cleanup());
  };
}
