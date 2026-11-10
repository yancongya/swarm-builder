/**
 * 类型面：实现是同名的 .mjs（dev-only，只被 vite.config.ts 的 /__page 用，不进产物）。
 * 本仓不装 @types/node、tsconfig 也不 include tools/，所以这里只声明 middleware 用到的形状。
 */
export interface RenderSuccess {
  ok: true;
  attempted: true;
  html: string;
  finalUrl: string;
  status: number;
  imgs: number;
  droppedScripts: boolean;
  ms: number;
}

export interface RenderFailure {
  ok: false;
  /** false = 根本没试（关掉了 / 排队太长）；true = 试了但没成（没装浏览器、抛错、超时）。 */
  attempted: boolean;
  reason: string;
}

export type RenderResult = RenderSuccess | RenderFailure;

export function renderPage(url: string, opts?: { mode?: 'auto' | 'off' | 'fail' }): Promise<RenderResult>;
export function closeRenderer(): Promise<void>;