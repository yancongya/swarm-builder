import { personaLabel } from '../core/personality';
import type { CrewMember } from '../types';
import { phrase, type Lang } from './locale';

/** What the finished run leaves behind; the panel hands this straight to the card. */
export interface CrewCardData {
  crew: readonly CrewMember[];
  built: number;
  durationMs: number;
  seed: number;
}

/** The words and rows on the card, kept separate from the canvas so tests can read it. */
export interface CrewCardModel {
  lang: Lang;
  title: string;
  stats: string;
  /** Sorted by tally, most productive first. */
  rows: readonly CrewMember[];
  /** The id of the cursor with the highest tally, or null when nobody built anything. */
  mvp: number | null;
  footer: string;
  width: number;
  height: number;
}

/** A share-card proportion: wide enough for a name, tally and bar without crowding. */
const WIDTH = 960;
const PAD = 56;
const HEAD = 158;
const ROW = 44;
const FOOT = 64;
const BAR = 210;

const CARD_TOP = '#28261f';
const CARD_BOTTOM = '#1b1a17';
const WELL = 'rgba(236,234,223,.08)';
const INK = '#eceadf';
const DIM = '#9c9689';
const LINE = '#3b3831';
const ACCENT = '#c9793c';
const ON_ACCENT = '#1a1206';
const FONT = 'ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** One card from one finished run: all crew rows, the MVP, the run's numbers. */
export function crewCardModel(data: CrewCardData, lang: Lang): CrewCardModel {
  const rows = [...data.crew].sort((a, b) => b.built - a.built || a.id - b.id);
  const top = rows[0];
  return {
    lang,
    title: phrase(lang, '重建班组'),
    stats: statsLine(data, rows.length, lang),
    rows,
    // 并列第一时不并列发奖：排序已经定了一个，标出来的是这张卡的头名。
    mvp: top && top.built > 0 ? top.id : null,
    footer: phrase(lang, '同一种子，回放同一支队伍'),
    width: WIDTH,
    height: HEAD + Math.max(1, rows.length) * ROW + FOOT,
  };
}

/** 英文要单复数、中文要量词：这也是一句活话，不进字典，按语言直接拼。 */
function statsLine(data: CrewCardData, count: number, lang: Lang): string {
  const seconds = (data.durationMs / 1000).toFixed(1);
  if (lang === 'en') {
    const items = data.built === 1 ? 'item' : 'items';
    const cursors = count === 1 ? 'cursor' : 'cursors';
    return `${data.built} ${items} · ${count} ${cursors} · ${seconds}s · seed ${data.seed}`;
  }
  return `${data.built} 项 · ${count} 位光标 · 用时 ${seconds}s · 种子 ${data.seed}`;
}

/** Draw the card and return a PNG data URL; '' when the browser has no 2D context. */
export function renderCrewCard(data: CrewCardData, lang: Lang, doc: Document = document): string {
  const model = crewCardModel(data, lang);
  const ratio = doc.defaultView?.devicePixelRatio ?? 1;
  // 2x 上限：高分屏上要清晰，但别让一张名片变成 4x 的大图。
  const scale = Math.max(1, Math.min(2, Math.round(ratio)));
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(model.width * scale);
  canvas.height = Math.round(model.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(scale, scale);
  draw(ctx, model);
  return canvas.toDataURL('image/png');
}

function draw(ctx: CanvasRenderingContext2D, model: CrewCardModel): void {
  const W = model.width;
  const H = model.height;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, CARD_TOP);
  bg.addColorStop(1, CARD_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 4);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ACCENT;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText('SWARM-BUILDER', PAD, 58);

  ctx.fillStyle = INK;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(model.title, PAD, 104);

  ctx.fillStyle = DIM;
  ctx.font = `400 15px ${FONT}`;
  ctx.fillText(model.stats, PAD, 134);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEAD - 12);
  ctx.lineTo(W - PAD, HEAD - 12);
  ctx.stroke();

  const max = Math.max(1, ...model.rows.map((member) => member.built));
  const trackX = W - PAD - 46 - BAR;
  for (let i = 0; i < model.rows.length; i++) {
    const member = model.rows[i] as CrewMember;
    const cy = HEAD + i * ROW + ROW / 2;

    ctx.fillStyle = member.color;
    ctx.beginPath();
    ctx.arc(PAD + 7, cy, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = INK;
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText(member.name, PAD + 26, cy + 6);
    const nameW = ctx.measureText(member.name).width;
    ctx.fillStyle = DIM;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(`· ${personaLabel(member.personality, model.lang)}`, PAD + 26 + nameW + 8, cy + 5);

    ctx.fillStyle = WELL;
    roundRect(ctx, trackX, cy - 5, BAR, 10, 5);
    ctx.fill();
    if (member.built > 0) {
      ctx.fillStyle = member.color;
      roundRect(ctx, trackX, cy - 5, Math.max(10, (BAR * member.built) / max), 10, 5);
      ctx.fill();
    }

    ctx.fillStyle = INK;
    ctx.font = `600 17px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(member.built), W - PAD, cy + 6);
    ctx.textAlign = 'left';

    if (member.id === model.mvp) {
      ctx.fillStyle = ACCENT;
      roundRect(ctx, trackX - 46, cy - 9, 36, 18, 9);
      ctx.fill();
      ctx.fillStyle = ON_ACCENT;
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('MVP', trackX - 28, cy + 4);
      ctx.textAlign = 'left';
    }
  }

  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(PAD, H - FOOT + 14);
  ctx.lineTo(W - PAD, H - FOOT + 14);
  ctx.stroke();

  ctx.fillStyle = DIM;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText('swarm-builder', PAD, H - 26);
  ctx.textAlign = 'right';
  ctx.fillText(model.footer, W - PAD, H - 26);
  ctx.textAlign = 'left';
}

/** Chrome 61 没有 roundRect，自己按四段圆弧画；半径再大也不能超过半边。 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
