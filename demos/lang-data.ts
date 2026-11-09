/**
 * 每套字典一张 [中文, English] 表，键是去掉缩进与多余空白后的中文原文。
 * 按文件名分文件放：console.ts 那种两百多条的表混在一个文件里没法读。
 */
import { ROWS as cdn } from './dicts/cdn';
import { ROWS as console_ } from './dicts/console';
import { ROWS as darkUi } from './dicts/dark-ui';
import { ROWS as home } from './dicts/home';
import { ROWS as index } from './dicts/index';
import { ROWS as landing } from './dicts/landing';
import { ROWS as simple } from './dicts/simple';
import { ROWS as tall } from './dicts/tall';
import { ROWS as tune } from './dicts/tune';

export const DICTS: Record<string, [string, string][]> = {
  cdn,
  console: console_,
  'dark-ui': darkUi,
  home,
  index,
  landing,
  simple,
  tall,
  tune,
};
