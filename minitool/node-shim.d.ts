/**
 * 本仓不装 @types/node（主站 typecheck 也不依赖它），
 * minitool 构建脚本只用到下面这几个符号——按实际用量声明，不多不少。
 */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

/** 构建脚本（gate-cli）在 Node 里跑，没有 DOM 的 window，但有 process。 */
declare const process: {
  argv: string[];
  exit(code: number): never;
};
