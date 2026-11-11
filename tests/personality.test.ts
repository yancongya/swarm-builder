import { describe, expect, it } from 'vitest';
import { drawPersona, personaLabel, STEADY } from '../src/core/personality';
import { makeRng } from '../src/core/rng';
import type { PersonalityKind } from '../src/types';

const KINDS: PersonalityKind[] = ['rush', 'tidy', 'drift', 'steady'];

describe('drawPersona', () => {
  it('same seed replays the same crew', () => {
    const draw = (seed: number): PersonalityKind[] => {
      const rng = makeRng(seed);
      return Array.from({ length: 24 }, () => drawPersona(rng).kind);
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(7)).toEqual(draw(7));
  });

  it('different seeds give different crews', () => {
    const draw = (seed: number): string => {
      const rng = makeRng(seed);
      return Array.from({ length: 24 }, () => drawPersona(rng).kind).join(',');
    };
    expect(draw(1)).not.toBe(draw(2));
  });

  it('a big crew covers all four kinds', () => {
    const rng = makeRng(2026);
    const seen = new Set(Array.from({ length: 400 }, () => drawPersona(rng).kind));
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  it('every persona keeps move and type multipliers positive', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 200; i++) {
      const p = drawPersona(rng);
      expect(p.moveMul).toBeGreaterThan(0);
      expect(p.typeMul).toBeGreaterThan(0);
    }
  });

  it('rush is faster, drift is slower, steady is neutral', () => {
    const pick = (kind: PersonalityKind) => {
      const rng = makeRng(5);
      for (let i = 0; i < 1000; i++) {
        const p = drawPersona(rng);
        if (p.kind === kind) return p;
      }
      throw new Error(`never drew ${kind}`);
    };
    expect(pick('rush').moveMul).toBeGreaterThan(1);
    expect(pick('rush').typeMul).toBeGreaterThan(1);
    expect(pick('drift').moveMul).toBeLessThan(1);
    expect(pick('drift').typeMul).toBeLessThan(1);
    expect(STEADY.moveMul).toBe(1);
    expect(STEADY.typeMul).toBe(1);
  });
});

describe('personaLabel', () => {
  it('has a non-empty label for every kind in both languages', () => {
    for (const kind of KINDS) {
      expect(personaLabel(kind, 'zh').length).toBeGreaterThan(0);
      expect(personaLabel(kind, 'en').length).toBeGreaterThan(0);
      expect(personaLabel(kind, 'zh')).not.toBe(personaLabel(kind, 'en'));
    }
  });
});