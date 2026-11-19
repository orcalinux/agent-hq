import type { AgentProfile, RoomLocation } from '@/types';

export const PLAN_W = 1200;
export const PLAN_H = 760;
export const INNER = { x: 32, y: 32, w: 1136, h: 696 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Facing = 'up' | 'down';
export type DeskSize = 'exec' | 'std' | 'small';

export interface Slot {
  x: number;
  y: number;
  facing: Facing;
  size?: DeskSize;
  optional?: boolean;
}

export type RoomId = RoomLocation | 'Break Room';

export interface RoomPlan {
  id: RoomId;
  purpose: string;
  color: string;
  floor: string;
  rect: Rect;
  sign: { x: number; y: number };
  slots: Slot[];
}

const row = (xs: number[], y: number, facing: Facing, optional = false): Slot[] => xs.map((x) => ({ x, y, facing, optional }));

export const ROOMS: RoomPlan[] = [
  {
    id: 'Executive Suite',
    purpose: 'Planning & delegation',
    color: '#D97706',
    floor: 'ahq-f-parquet',
    rect: { x: 32, y: 32, w: 380, h: 230 },
    sign: { x: 238, y: 186 },
    slots: [{ x: 140, y: 92, facing: 'down', size: 'exec' }],
  },
  {
    id: 'Architecture Lab',
    purpose: 'Design & contracts',
    color: '#7C3AED',
    floor: 'ahq-f-concrete',
    rect: { x: 412, y: 32, w: 330, h: 230 },
    sign: { x: 424, y: 186 },
    slots: row([480, 586], 140, 'up'),
  },
  {
    id: 'QA Vault',
    purpose: 'Review, tests & security',
    color: '#059669',
    floor: 'ahq-f-raised',
    rect: { x: 742, y: 32, w: 426, h: 230 },
    sign: { x: 756, y: 172 },
    slots: row([806, 906, 1006], 140, 'up'),
  },
  {
    id: 'Dev Bay',
    purpose: 'Implementation',
    color: '#2563EB',
    floor: 'ahq-f-carpet',
    rect: { x: 32, y: 334, w: 640, h: 394 },
    sign: { x: 44, y: 590 },
    slots: [...row([122, 218, 362, 458], 548, 'up'), ...row([122, 218, 362, 458], 420, 'down'), ...row([380, 476, 572], 700, 'up', true)],
  },
  {
    id: 'Incubator Pod',
    purpose: 'Juniors with N+1 mentors',
    color: '#DB2777',
    floor: 'ahq-f-soft',
    rect: { x: 672, y: 334, w: 496, h: 220 },
    sign: { x: 760, y: 342 },
    slots: [...row([790, 886, 982, 1078], 440, 'up'), ...row([790, 886, 982, 1078], 527, 'up', true)],
  },
  {
    id: 'Break Room',
    purpose: 'Coffee & quick syncs',
    color: '#64748B',
    floor: 'ahq-f-vinyl',
    rect: { x: 672, y: 554, w: 496, h: 174 },
    sign: { x: 690, y: 566 },
    slots: [],
  },
];

export const AGENT_ROOMS = ROOMS.filter((r) => r.slots.length > 0);

export interface Door {
  x: number;
  y: number;
  len: number;
  orient: 'h' | 'v';
  dir: 1 | -1;
  double?: boolean;
  outer?: boolean;
}

export const DOORS: Door[] = [
  { x: 300, y: 262, len: 40, orient: 'h', dir: -1 },
  { x: 560, y: 262, len: 40, orient: 'h', dir: -1 },
  { x: 800, y: 262, len: 40, orient: 'h', dir: -1 },
  { x: 100, y: 334, len: 40, orient: 'h', dir: 1 },
  { x: 540, y: 334, len: 40, orient: 'h', dir: 1 },
  { x: 700, y: 334, len: 40, orient: 'h', dir: 1 },
  { x: 672, y: 600, len: 40, orient: 'v', dir: -1 },
  { x: 1040, y: 554, len: 36, orient: 'h', dir: 1 },
  { x: 26, y: 276, len: 44, orient: 'v', dir: 1, double: true, outer: true },
];

export const WINDOWS: Rect[] = [
  { x: 52, y: 21, w: 340, h: 10 },
  { x: 432, y: 21, w: 290, h: 10 },
  { x: 762, y: 21, w: 386, h: 10 },
  { x: 21, y: 52, w: 10, h: 190 },
  { x: 21, y: 354, w: 10, h: 354 },
  { x: 1169, y: 350, w: 10, h: 190 },
  { x: 1169, y: 570, w: 10, h: 140 },
  { x: 60, y: 729, w: 580, h: 10 },
  { x: 692, y: 729, w: 456, h: 10 },
];

export const GLASS: Array<[number, number, number, number]> = [
  [420, 262, 556, 262],
  [604, 262, 736, 262],
  [748, 262, 796, 262],
  [844, 262, 1162, 262],
];

export function lightsFor(r: Rect): Array<{ x: number; y: number }> {
  const nx = Math.max(1, Math.round(r.w / 160));
  const ny = Math.max(1, Math.round(r.h / 140));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push({ x: r.x + (r.w * (i + 0.5)) / nx, y: r.y + (r.h * (j + 0.5)) / ny });
  return out;
}

export interface Seat {
  slot: Slot;
  room: RoomId;
}

const SPILL_ORDER: RoomId[] = ['Dev Bay', 'Incubator Pod', 'QA Vault', 'Architecture Lab', 'Executive Suite'];

/** Seats every agent at a desk in its own room, spilling into other rooms and then the corridor when a room is full. */
export function assignSeats(agents: AgentProfile[]): Map<string, Seat> {
  const free = new Map<RoomId, Slot[]>(AGENT_ROOMS.map((r) => [r.id, [...r.slots]]));
  const out = new Map<string, Seat>();
  const spill: AgentProfile[] = [];
  agents.forEach((a) => {
    const room: RoomId = AGENT_ROOMS.some((r) => r.id === a.roomLocation) ? a.roomLocation : 'Dev Bay';
    const slot = free.get(room)?.shift();
    if (slot) out.set(a.id, { slot, room });
    else spill.push(a);
  });
  spill.forEach((a, i) => {
    for (const id of SPILL_ORDER) {
      const slot = free.get(id)?.shift();
      if (slot) {
        out.set(a.id, { slot, room: id });
        return;
      }
    }
    out.set(a.id, { slot: { x: 120 + (i % 12) * 80, y: 298, facing: 'up', optional: true }, room: 'Dev Bay' });
  });
  return out;
}
