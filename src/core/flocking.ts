const AVOID_RADIUS = 90;
const AVOID_PUSH = 26;

export interface Mover {
  readonly x: number;
  readonly y: number;
}

/**
 * The side a cursor dodges when a neighbour crowds it. Neighbours parked ahead
 * move less than ones crossing the path, so the push is weighted by how close
 * they are and summed over everyone inside AVOID_RADIUS.
 */
export class Flock {
  private readonly movers: Mover[] = [];

  add(mover: Mover): void {
    this.movers.push(mover);
  }

  offset(from: Mover): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const other of this.movers) {
      if (other === from) continue;
      const dx = from.x - other.x;
      const dy = from.y - other.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= AVOID_RADIUS) continue;
      const weight = 1 - distance / AVOID_RADIUS;
      if (distance < 1) {
        // Dead overlap has no direction. Spread pairs by index so two cursors
        // landing on the same spot do not both dodge the same way.
        const angle = (this.movers.indexOf(from) * 2.4) % (Math.PI * 2);
        x += Math.cos(angle) * weight;
        y += Math.sin(angle) * weight;
        continue;
      }
      x += (dx / distance) * weight;
      y += (dy / distance) * weight;
    }
    return { x: x * AVOID_PUSH, y: y * AVOID_PUSH };
  }
}
