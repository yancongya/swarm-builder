import type { PersonalityKind } from '../types';
import type { Lang } from '../tune/locale';

/**
 * 性格只改施工层的速度和外观，不碰轨道场与避让：待时物理是参考版复刻，
 * flocking 门禁拿它当考卷，性格不能往那张卷子上写答案。
 */
export interface Persona {
  kind: PersonalityKind;
  /** 赶路（move）的时间倍率：大于 1 更快。 */
  moveMul: number;
  /** 打字（type）的时间倍率。 */
  typeMul: number;
}

const RUSH: Persona = { kind: 'rush', moveMul: 1.35, typeMul: 1.2 };
const TIDY: Persona = { kind: 'tidy', moveMul: 1, typeMul: 1 };
const DRIFT: Persona = { kind: 'drift', moveMul: 0.85, typeMul: 0.85 };
export const STEADY: Persona = { kind: 'steady', moveMul: 1, typeMul: 1 };

/** 急性子三成、强迫症与摸鱼各四分之一弱，剩下的稳当当——一班组里总有几个克隆。 */
export function drawPersona(rng: () => number): Persona {
  const roll = rng();
  if (roll < 0.3) return RUSH;
  if (roll < 0.55) return TIDY;
  if (roll < 0.75) return DRIFT;
  return STEADY;
}

const LABELS: Record<PersonalityKind, Record<Lang, string>> = {
  rush: { zh: '急性子', en: 'Rush' },
  tidy: { zh: '强迫症', en: 'Tidy' },
  drift: { zh: '摸鱼中', en: 'Drift' },
  steady: { zh: '稳当当', en: 'Steady' },
};

export function personaLabel(kind: PersonalityKind, lang: Lang): string {
  return LABELS[kind][lang];
}