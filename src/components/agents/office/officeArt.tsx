import type { ReactElement } from 'react';
import type { DeskSize, Door, Facing, Rect } from './officePlan';

function stripes(size: number, step: number, vertical: boolean, ox = 0, oy = 0): string {
  let d = '';
  for (let i = step / 2; i < size; i += step) d += vertical ? `M${ox + i} ${oy}v${size}` : `M${ox} ${oy + i}h${size}`;
  return d;
}

function Grad({ id, stops, x2 = 1, y2 = 0.2 }: { id: string; stops: string[]; x2?: number; y2?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      {stops.map((c, i) => <stop key={i} offset={i / (stops.length - 1)} stopColor={c} />)}
    </linearGradient>
  );
}

function Shadow({ id, dy, blur, opacity }: { id: string; dy: number; blur: number; opacity: number }) {
  return (
    <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx={dy * 0.5} dy={dy} stdDeviation={blur} floodColor="#000" floodOpacity={opacity} />
    </filter>
  );
}

function RaisedTile({ x, y, perforated }: { x: number; y: number; perforated?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={1} y={1} width={32} height={32} rx={1} fill={perforated ? '#8a949f' : '#939da8'} />
      <rect x={3} y={3} width={28} height={28} fill="none" stroke="#a6afb9" strokeWidth={0.6} />
      {perforated
        ? Array.from({ length: 36 }, (_, i) => <circle key={i} cx={6.5 + (i % 6) * 4.2} cy={6.5 + Math.floor(i / 6) * 4.2} r={0.8} fill="#6d7680" />)
        : null}
    </g>
  );
}

export function OfficeDefs() {
  return (
    <defs>
      <Shadow id="ahq-sh" dy={3} blur={2.4} opacity={0.32} />
      <Shadow id="ahq-sh-sm" dy={1.5} blur={1.2} opacity={0.3} />
      <Shadow id="ahq-sh-lg" dy={5} blur={5} opacity={0.3} />
      <filter id="ahq-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.3 -0.5" />
      </filter>
      <Grad id="ahq-wood" stops={['#a9744a', '#bb875c', '#a26d44', '#be8a60', '#a7724a', '#b7834f']} />
      <Grad id="ahq-oak" stops={['#d0b288', '#dcc29c', '#c8a97f', '#ddc59f', '#ccaf85', '#d8bd95']} />
      <Grad id="ahq-walnut" stops={['#5e3d27', '#714c32', '#573823', '#744e33', '#5b3b25', '#6a462b']} />
      <Grad id="ahq-stone" stops={['#dedad3', '#e8e5df', '#d6d1c9', '#e4e0d9']} />
      <Grad id="ahq-sun-down" stops={['rgba(255,250,235,0.38)', 'rgba(255,250,235,0)']} x2={0} y2={1} />
      <Grad id="ahq-sun-right" stops={['rgba(255,250,235,0.32)', 'rgba(255,250,235,0)']} x2={1} y2={0} />
      <linearGradient id="ahq-sun-up" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="rgba(255,250,235,0.3)" />
        <stop offset="1" stopColor="rgba(255,250,235,0)" />
      </linearGradient>
      <radialGradient id="ahq-lamp">
        <stop offset="0" stopColor="#ffe9c2" stopOpacity="0.95" />
        <stop offset="0.45" stopColor="#ffd79a" stopOpacity="0.35" />
        <stop offset="1" stopColor="#ffd79a" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ahq-screen">
        <stop offset="0" stopColor="#9bd5ff" stopOpacity="0.8" />
        <stop offset="0.45" stopColor="#6bb8ff" stopOpacity="0.3" />
        <stop offset="1" stopColor="#6bb8ff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ahq-sheen" cx="0.4" cy="0.3">
        <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <pattern id="ahq-f-parquet" width="120" height="30" patternUnits="userSpaceOnUse">
        <rect width="120" height="30" fill="#9a6a42" />
        <rect width="70" height="15" fill="#a5734a" />
        <rect x="70" width="50" height="15" fill="#94633c" />
        <rect y="15" width="35" height="15" fill="#9f6d45" />
        <rect x="35" y="15" width="85" height="15" fill="#a97850" />
        <path d="M0 15H120M0 30H120M70 0V15M35 15V30" stroke="#6f4627" strokeOpacity="0.45" strokeWidth="0.8" />
        <path d="M8 5h40M80 9h30M45 22h60M4 26h20" stroke="#7f5432" strokeOpacity="0.2" strokeWidth="0.6" />
      </pattern>
      <pattern id="ahq-f-carpet" width="48" height="48" patternUnits="userSpaceOnUse">
        <rect width="48" height="48" fill="#57616d" />
        <rect width="24" height="24" fill="#5d6874" />
        <rect x="24" y="24" width="24" height="24" fill="#5d6874" />
        <path d={stripes(24, 3, false) + stripes(24, 3, false, 24, 24)} stroke="#000" strokeOpacity="0.09" strokeWidth="0.7" />
        <path d={stripes(24, 3, true, 24, 0) + stripes(24, 3, true, 0, 24)} stroke="#000" strokeOpacity="0.09" strokeWidth="0.7" />
        <path d="M0 0H48M0 24H48M0 0V48M24 0V48" stroke="#47505a" strokeWidth="0.8" />
      </pattern>
      <pattern id="ahq-f-concrete" width="180" height="180" patternUnits="userSpaceOnUse">
        <rect width="180" height="180" fill="#bcb7ae" />
        <circle cx="40" cy="50" r="38" fill="#c6c1b8" opacity="0.6" />
        <circle cx="130" cy="120" r="46" fill="#b1aba2" opacity="0.45" />
        <circle cx="150" cy="30" r="22" fill="#c3beb5" opacity="0.5" />
        <path d="M0 0H180M0 0V180" stroke="#a29c92" strokeWidth="1" />
      </pattern>
      <pattern id="ahq-f-raised" width="68" height="68" patternUnits="userSpaceOnUse">
        <rect width="68" height="68" fill="#7c8691" />
        <RaisedTile x={0} y={0} />
        <RaisedTile x={34} y={0} />
        <RaisedTile x={0} y={34} />
        <RaisedTile x={34} y={34} perforated />
      </pattern>
      <pattern id="ahq-f-soft" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#867b8d" />
        <circle cx="1.5" cy="1.5" r="0.7" fill="#7a6f82" />
        <circle cx="4.5" cy="4.5" r="0.7" fill="#918799" />
      </pattern>
      <pattern id="ahq-f-tile" width="80" height="80" patternUnits="userSpaceOnUse">
        <rect width="80" height="80" fill="#bdb6aa" />
        <rect x="0.75" y="0.75" width="38.5" height="38.5" fill="#d9d4cb" />
        <rect x="40.75" y="0.75" width="38.5" height="38.5" fill="#d5d0c6" />
        <rect x="0.75" y="40.75" width="38.5" height="38.5" fill="#d3cec4" />
        <rect x="40.75" y="40.75" width="38.5" height="38.5" fill="#dbd6cd" />
      </pattern>
      <pattern id="ahq-f-vinyl" width="150" height="40" patternUnits="userSpaceOnUse">
        <rect width="150" height="40" fill="#c9ad86" />
        <rect width="90" height="20" fill="#d1b690" />
        <rect x="90" width="60" height="20" fill="#c4a87f" />
        <rect y="20" width="50" height="20" fill="#cdb28b" />
        <rect x="50" y="20" width="100" height="20" fill="#d4ba95" />
        <path d="M0 20H150M0 40H150M90 0V20M50 20V40" stroke="#a88b63" strokeOpacity="0.5" strokeWidth="0.7" />
      </pattern>
      <pattern id="ahq-keys" width="3" height="3" patternUnits="userSpaceOnUse">
        <rect x="0.35" y="0.35" width="2.3" height="2.3" rx="0.4" fill="#c5cad1" />
      </pattern>
      <pattern id="ahq-vent" width="4" height="2.4" patternUnits="userSpaceOnUse">
        <rect width="4" height="1.1" fill="#2c3037" />
      </pattern>
      <pattern id="ahq-blueprint" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 0H8M0 0V8" stroke="#fff" strokeOpacity="0.16" strokeWidth="0.5" />
      </pattern>
    </defs>
  );
}

export function Plant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const leaves = [0, 45, 95, 140, 190, 235, 280, 325];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} filter="url(#ahq-sh-sm)">
      <circle r={10} fill="#7a4e2e" />
      <circle r={8.2} fill="#4a3220" />
      {leaves.map((a, i) => <ellipse key={a} cy={-8} rx={4.2} ry={9} transform={`rotate(${a})`} fill={['#3f7f3a', '#559c48', '#2f6a2c'][i % 3]} />)}
      {leaves.map((a) => <ellipse key={'i' + a} cy={-5} rx={2.8} ry={6} transform={`rotate(${a + 22})`} fill="#6bb35a" />)}
      <circle r={2.4} fill="#3a6f33" />
    </g>
  );
}

export function Chair({ x, y, rot = 0, color = '#2f343c', back = '#22262c' }: { x: number; y: number; rot?: number; color?: string; back?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} filter="url(#ahq-sh-sm)">
      {[90, 162, 234, 306, 18].map((a) => {
        const r = (a * Math.PI) / 180;
        const ex = Math.cos(r) * 14;
        const ey = Math.sin(r) * 14 + 2;
        return (
          <g key={a}>
            <line x1={0} y1={2} x2={ex} y2={ey} stroke="#1f2227" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={ex} cy={ey} r={1.8} fill="#0f1114" />
          </g>
        );
      })}
      <rect x={-12} y={-11} width={24} height={21} rx={7} fill={color} />
      <rect x={-9} y={-8} width={18} height={13} rx={5} fill="#fff" opacity={0.08} />
      <rect x={-13.5} y={8} width={27} height={7.5} rx={3.75} fill={back} />
      <rect x={-16.5} y={-7} width={3.5} height={12} rx={1.75} fill="#1b1e23" />
      <rect x={13} y={-7} width={3.5} height={12} rx={1.75} fill="#1b1e23" />
    </g>
  );
}

function Monitor({ x, y, w, rot = 0, lit }: { x: number; y: number; w: number; rot?: number; lit: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-6} y={1} width={12} height={6} rx={2} fill="#2a2e35" />
      <rect x={-w / 2} y={-2.5} width={w} height={4.5} rx={1.5} fill="#121418" />
      <rect x={-w / 2 + 1} y={1.2} width={w - 2} height={1.3} rx={0.6} fill={lit ? '#9bd5ff' : '#343a43'} />
    </g>
  );
}

function Mug({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={3.2} y={-1.3} width={3.2} height={2.6} rx={1} fill="#e9e9e6" />
      <circle r={4.6} fill="#f3f3f0" stroke="#b3b3ae" strokeWidth={0.6} />
      <circle r={3.2} fill="#4a2e1b" />
      <circle cx={-1} cy={-1} r={0.9} fill="#8a5a38" opacity={0.6} />
    </g>
  );
}

function Papers({ x, y, rot = 12 }: { x: number; y: number; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-6} y={-8} width={14} height={18} fill="#e9e9e4" />
      <rect x={-7} y={-9} width={14} height={18} fill="#f8f8f5" stroke="#d6d6d0" strokeWidth={0.4} />
      <path d="M-5 -6h10M-5 -3h10M-5 0h7M-5 3h9M-5 6h6" stroke="#9aa0a8" strokeWidth={0.5} />
    </g>
  );
}

export function Laptop({ x, y, rot = 0, lit = false }: { x: number; y: number; rot?: number; lit?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-12} y={-7} width={24} height={15} rx={1.5} fill="#b9bec6" stroke="#8d939b" strokeWidth={0.4} />
      <rect x={-10} y={-4} width={20} height={7} fill="url(#ahq-keys)" opacity={0.85} />
      <rect x={-4} y={4.2} width={8} height={2.6} rx={0.6} fill="#a6acb4" />
      <rect x={-12} y={-9.5} width={24} height={3} rx={1} fill={lit ? '#5aa7e6' : '#2b2f36'} />
    </g>
  );
}

export function deskDepth(size: DeskSize): number {
  return size === 'exec' ? 50 : 40;
}

export function Desk({ x, y, facing, size = 'std', occupied, busy, accent, index }: { x: number; y: number; facing: Facing; size?: DeskSize; occupied: boolean; busy: boolean; accent?: string; index: number }) {
  const w = size === 'exec' ? 136 : size === 'small' ? 78 : 92;
  const d = deskDepth(size);
  const top = -24 - d;
  const wood = size === 'exec' ? 'url(#ahq-walnut)' : index % 2 ? 'url(#ahq-oak)' : 'url(#ahq-wood)';
  const dual = size === 'exec' || index % 3 === 0;
  const exec = size === 'exec';
  return (
    <g transform={`translate(${x} ${y}) rotate(${facing === 'down' ? 180 : 0})`}>
      <g filter="url(#ahq-sh)">
        <rect x={-w / 2} y={top} width={w} height={d} rx={3} fill={wood} stroke="#3d2814" strokeOpacity={0.35} strokeWidth={0.8} />
        {exec ? <rect x={w / 2 - 30} y={-26} width={30} height={44} rx={3} fill={wood} stroke="#3d2814" strokeOpacity={0.35} strokeWidth={0.8} /> : null}
      </g>
      <rect x={-w / 2 + 2} y={top + 1.2} width={w - 4} height={1.2} rx={0.6} fill="#fff" opacity={0.2} />
      {exec ? <rect x={-30} y={-52} width={60} height={24} rx={2} fill="#2a2522" opacity={0.9} /> : null}
      {dual ? (
        <>
          <Monitor x={-15} y={top + 8} w={28} rot={7} lit={busy} />
          <Monitor x={15} y={top + 8} w={28} rot={-7} lit={busy} />
        </>
      ) : (
        <Monitor x={0} y={top + 8} w={40} lit={busy} />
      )}
      <rect x={-17} y={-43} width={34} height={10} rx={1.5} fill="#eceef1" stroke="#b5bac2" strokeWidth={0.5} />
      <rect x={-15.5} y={-41.5} width={31} height={7} fill="url(#ahq-keys)" />
      <ellipse cx={24} cy={-37} rx={3} ry={4.3} fill="#eceef1" stroke="#9aa0a8" strokeWidth={0.5} />
      {index % 2 === 0 ? <Mug x={-w / 2 + 10} y={top + 11} /> : <Plant x={-w / 2 + 11} y={top + 11} s={0.5} />}
      {size !== 'small' ? <Papers x={w / 2 - 13} y={top + 13} rot={index % 2 ? -10 : 12} /> : null}
      {accent ? <rect x={-w / 2 + 6} y={-40} width={13} height={10} rx={1} fill={accent} opacity={0.85} transform={`rotate(-6 ${-w / 2 + 12} -35)`} /> : null}
      {exec ? (
        occupied ? <Chair x={0} y={0} color="#4a3328" back="#33231b" /> : <Chair x={0} y={-6} color="#4a3328" back="#33231b" />
      ) : occupied ? (
        <Chair x={0} y={0} />
      ) : (
        <Chair x={0} y={-7} rot={index % 2 ? 7 : -9} />
      )}
    </g>
  );
}

export function Sofa({ x, y, w, h = 30, rot = 0, frame = '#3d4552', back = '#4a5363', seat = '#58627a', pillow = '#c9a227' }: { x: number; y: number; w: number; h?: number; rot?: number; frame?: string; back?: string; seat?: string; pillow?: string }) {
  const n = Math.max(2, Math.round((w - 18) / 34));
  const cw = (w - 18) / n;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} ${w / 2} ${h / 2})`} filter="url(#ahq-sh)">
      <rect width={w} height={h} rx={6} fill={frame} />
      <rect width={w} height={10} rx={5} fill={back} />
      <rect width={9} height={h} rx={4.5} fill={back} />
      <rect x={w - 9} width={9} height={h} rx={4.5} fill={back} />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <rect x={9 + i * cw + 1} y={10.5} width={cw - 2} height={h - 12.5} rx={3} fill={seat} />
          <rect x={9 + i * cw + 3} y={12} width={cw - 6} height={3} rx={1.5} fill="#fff" opacity={0.08} />
        </g>
      ))}
      <rect x={12} y={11} width={9} height={9} rx={2} fill={pillow} transform="rotate(-14 16 15)" />
    </g>
  );
}

export function Rug({ x, y, w, h, fill, border }: Rect & { fill: string; border: string }) {
  const fringe = Array.from({ length: Math.floor(h / 4) }, (_, i) => `M${x} ${y + 2 + i * 4}h-4M${x + w} ${y + 2 + i * 4}h4`).join('');
  return (
    <g>
      <path d={fringe} stroke={border} strokeWidth={0.8} opacity={0.7} />
      <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} />
      <rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} fill="none" stroke={border} strokeWidth={1.6} opacity={0.8} />
      <rect x={x + 11} y={y + 11} width={w - 22} height={h - 22} fill="none" stroke={border} strokeWidth={0.6} opacity={0.6} />
    </g>
  );
}

const BOOK_W = [4, 3, 5, 3.5, 4.5, 3, 6, 4];
const BOOK_C = ['#8b2f2f', '#2f5d8b', '#c9a227', '#3f7a4a', '#6b4c8a', '#d0d0c8', '#8a5a2b', '#2d2d2d', '#b5523b'];

export function Bookshelf({ x, y, w, h = 12, rot = 0 }: { x: number; y: number; w: number; h?: number; rot?: number }) {
  const books: ReactElement[] = [];
  let bx = 2;
  for (let i = 0; bx < w - 6; i++) {
    const bw = BOOK_W[i % BOOK_W.length];
    if (i % 11 === 10) {
      bx += 5;
      continue;
    }
    books.push(<rect key={i} x={bx} y={2} width={bw - 0.6} height={h - 4 - (i % 3)} fill={BOOK_C[i % BOOK_C.length]} />);
    bx += bw;
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <g filter="url(#ahq-sh-sm)">
        <rect width={w} height={h} rx={1} fill="#5b3c25" />
      </g>
      {books}
    </g>
  );
}

export function ConferenceTable({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return (
    <g>
      {[205, 270, 335, 25, 90, 155].map((a) => {
        const r = (a * Math.PI) / 180;
        return <Chair key={a} x={cx + Math.cos(r) * (rx + 13)} y={cy + Math.sin(r) * (ry + 13)} rot={a - 90} color="#4b5563" back="#374151" />;
      })}
      <g filter="url(#ahq-sh-lg)">
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#ahq-walnut)" />
      </g>
      <ellipse cx={cx - rx * 0.15} cy={cy - ry * 0.3} rx={rx * 0.7} ry={ry * 0.45} fill="url(#ahq-sheen)" />
      <Laptop x={cx - 24} y={cy - 2} rot={-8} />
      <Papers x={cx + 26} y={cy + 2} rot={-18} />
      <circle cx={cx} cy={cy} r={5.5} fill="#1f2328" />
      <circle cx={cx} cy={cy} r={2} fill="#3b4048" />
      {[[-40, -12], [40, -10], [-6, 16]].map(([dx, dy]) => <circle key={dx} cx={cx + dx} cy={cy + dy} r={2.3} fill="#cfe8f7" stroke="#8fb8d0" strokeWidth={0.5} />)}
    </g>
  );
}

const LED = ['#22c55e', '#22c55e', '#f59e0b', '#22c55e', '#38bdf8', '#22c55e'];

export function ServerRack({ x, y, seed }: { x: number; y: number; seed: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g filter="url(#ahq-sh)">
        <rect width={52} height={34} rx={2} fill="#1b1e23" stroke="#0c0d10" />
      </g>
      <rect x={9} y={3} width={40} height={28} fill="url(#ahq-vent)" />
      <rect width={6} height={34} rx={1.5} fill="#2b3038" />
      {LED.map((c, i) => (
        <circle key={i} cx={3} cy={4 + i * 5.2} r={1.2} fill={c} className="ahq-led" style={{ animationDelay: `${((i * 0.37 + seed * 0.53) % 1.4).toFixed(2)}s` }} />
      ))}
    </g>
  );
}

export function TestBench({ x, y, w, h }: Rect) {
  return (
    <g>
      <g filter="url(#ahq-sh)">
        <rect x={x} y={y} width={w} height={h} rx={2} fill="#c7cbd1" stroke="#9ca3ab" strokeWidth={0.6} />
      </g>
      <rect x={x + 6} y={y + 5} width={w - 12} height={h - 10} rx={2} fill="#2f5f63" />
      <g transform={`translate(${x + 16} ${y + 11})`}>
        <rect width={28} height={17} rx={1} fill="#1d6b3c" />
        <rect x={9} y={4} width={9} height={9} fill="#111" />
        <rect x={2} y={2} width={2.5} height={13} fill="#c9a227" opacity={0.85} />
        <circle cx={23} cy={4} r={1.3} fill="#ef4444" />
        {Array.from({ length: 6 }, (_, i) => <rect key={i} x={6 + i * 3.5} y={15} width={1.4} height={1.6} fill="#d4d4d4" />)}
      </g>
      <path d={`M${x + 44} ${y + 20} C ${x + 62} ${y + 30}, ${x + 80} ${y + 10}, ${x + w - 54} ${y + 18}`} stroke="#151515" strokeWidth={1.1} fill="none" />
      <g transform={`translate(${x + 60} ${y + 11})`}>
        <rect width={11} height={18} rx={1.5} fill="#f2c94c" />
        <rect x={1.5} y={2} width={8} height={5} fill="#3a4a3a" />
        <circle cx={5.5} cy={12} r={2.8} fill="#2b2b2b" />
      </g>
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${x + 82 + i * 14} ${y + 12})`}>
          <rect width={9} height={16} rx={1.8} fill="#111" />
          <rect x={1} y={1.5} width={7} height={13} rx={1} fill={i ? '#1f3550' : '#24364c'} />
        </g>
      ))}
      <Laptop x={x + w - 34} y={y + h / 2} rot={-4} lit />
    </g>
  );
}

export function DraftingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(-5)`}>
      <g filter="url(#ahq-sh)">
        <rect width={84} height={62} rx={2} fill="url(#ahq-oak)" />
      </g>
      <rect x={6} y={6} width={72} height={48} fill="#1f4e8c" />
      <rect x={6} y={6} width={72} height={48} fill="url(#ahq-blueprint)" />
      <path d="M14 14h30v18h-30z M44 22h24v24h-24z M22 32v12h22 M30 14v-4" stroke="#e8f1ff" strokeWidth={0.9} fill="none" opacity={0.9} />
      <circle cx={60} cy={14} r={4.5} stroke="#e8f1ff" strokeWidth={0.8} fill="none" opacity={0.9} />
      <rect x={4} y={56} width={76} height={3.2} fill="#e7d9b0" />
      <line x1={84} y1={2} x2={68} y2={18} stroke="#2b2f36" strokeWidth={1.6} />
      <circle cx={68} cy={18} r={5} fill="#2b2f36" />
    </g>
  );
}

export function BeanBag({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} filter="url(#ahq-sh)">
      <ellipse rx={15} ry={13} fill={color} />
      <ellipse cx={-2} cy={-2} rx={9} ry={7} fill="#fff" opacity={0.12} />
      <path d="M-8 4 Q0 9 8 3" stroke="#000" strokeOpacity={0.18} fill="none" />
    </g>
  );
}

export function RoundTable({ x, y, r = 16, chairs = 4 }: { x: number; y: number; r?: number; chairs?: number }) {
  return (
    <g>
      {Array.from({ length: chairs }, (_, i) => {
        const a = (360 / chairs) * i + 45;
        const rad = (a * Math.PI) / 180;
        return <Chair key={i} x={x + Math.cos(rad) * (r + 12)} y={y + Math.sin(rad) * (r + 12)} rot={a - 90} color="#6b7280" back="#4b5563" />;
      })}
      <g filter="url(#ahq-sh)">
        <circle cx={x} cy={y} r={r} fill="url(#ahq-oak)" stroke="#8a6a44" strokeOpacity={0.4} />
      </g>
      <Mug x={x - 5} y={y - 3} />
    </g>
  );
}

export function Printer({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g filter="url(#ahq-sh)">
        <rect width={40} height={30} rx={3} fill="#e2e5e9" stroke="#b7bcc3" strokeWidth={0.6} />
      </g>
      <rect x={4} y={4} width={32} height={9} rx={1.5} fill="#2f343c" />
      <rect x={26} y={6} width={7} height={5} rx={1} fill="#4ade80" opacity={0.7} />
      <rect x={8} y={17} width={24} height={11} fill="#fbfbf8" stroke="#d4d4cf" strokeWidth={0.4} />
    </g>
  );
}

export function StandingDesk({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={8} y={36} width={54} height={20} rx={4} fill="#2f3a2f" opacity={0.85} />
      <g filter="url(#ahq-sh-lg)">
        <rect width={70} height={34} rx={3} fill="#e8e6e1" stroke="#b6b2aa" strokeWidth={0.6} />
      </g>
      <Laptop x={35} y={17} />
    </g>
  );
}

export function Whiteboard({ x, y, len, vertical }: { x: number; y: number; len: number; vertical?: boolean }) {
  const w = vertical ? 6 : len;
  const h = vertical ? len : 6;
  return (
    <g filter="url(#ahq-sh-sm)">
      <rect x={x} y={y} width={w} height={h} rx={1.5} fill="#f6f7f8" stroke="#8b929b" strokeWidth={0.8} />
      {[0.2, 0.45, 0.7].map((t, i) => (
        <rect key={t} x={vertical ? x - 1.5 : x + len * t} y={vertical ? y + len * t : y - 1.5} width={vertical ? 3 : 6} height={vertical ? 6 : 3} fill={['#facc15', '#f472b6', '#60a5fa'][i]} />
      ))}
    </g>
  );
}

export function Stairs({ x, y, w, h }: Rect) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#c9c4bb" stroke="#8e887e" strokeWidth={0.8} />
      <path d={Array.from({ length: Math.floor(w / 7) }, (_, i) => `M${x + 3.5 + i * 7} ${y}v${h}`).join('')} stroke="#9a948a" strokeWidth={0.8} />
      <path d={`M${x + 6} ${y + h / 2}H${x + w - 8}m-5 -4l5 4l-5 4`} stroke="#5f5a52" strokeWidth={1.1} fill="none" />
    </g>
  );
}

export function BreakRoomFixtures({ night }: { night: boolean }) {
  return (
    <g>
      <g filter="url(#ahq-sh)">
        <rect x={900} y={700} width={212} height={24} rx={1.5} fill="#ece9e3" />
      </g>
      <rect x={900} y={700} width={212} height={24} fill="url(#ahq-stone)" opacity={0.9} />
      <rect x={968} y={704} width={26} height={16} rx={4} fill="#aeb6be" stroke="#8a929a" strokeWidth={0.6} />
      <circle cx={981} cy={712} r={1.6} fill="#5f666d" />
      <rect x={918} y={703} width={26} height={17} rx={1.5} fill="#3a3d42" />
      <rect x={921} y={706} width={15} height={11} rx={1} fill={night ? '#26303b' : '#1b2026'} />
      <rect x={1050} y={703} width={20} height={17} rx={2} fill="#2a2a2a" />
      <circle cx={1060} cy={710} r={3.5} fill="#4a4a4a" />
      <Mug x={1080} y={712} />
      <g filter="url(#ahq-sh)">
        <rect x={1116} y={684} width={44} height={40} rx={2.5} fill="#e3e7eb" stroke="#b9c0c7" strokeWidth={0.6} />
      </g>
      <path d="M1116 700H1160M1121 690v6M1121 705v12" stroke="#a7aeb5" strokeWidth={1.2} />
      <g filter="url(#ahq-sh)">
        <rect x={1126} y={598} width={36} height={30} rx={2} fill="#b4232c" />
      </g>
      <rect x={1129} y={601} width={20} height={24} fill="#1d2a3a" />
      {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={1133 + (i % 3) * 6} cy={605 + Math.floor(i / 3) * 5.5} r={1.4} fill={['#facc15', '#22c55e', '#f97316'][i % 3]} />)}
      <g transform="translate(1100 616)" filter="url(#ahq-sh-sm)">
        <circle r={8} fill="#e6ebef" stroke="#b8c1c9" strokeWidth={0.6} />
        <circle r={5.4} fill="#9fd3f0" opacity={0.9} />
        <circle cx={-1.5} cy={-1.5} r={1.6} fill="#fff" opacity={0.6} />
      </g>
      <RoundTable x={760} y={642} />
      <RoundTable x={866} y={664} r={15} chairs={3} />
      <Plant x={1150} y={572} s={0.9} />
    </g>
  );
}

function leaf(hx: number, hy: number, ax: number, ay: number, ix: number, iy: number, len: number) {
  const sweep = ax * iy - ay * ix > 0 ? 1 : 0;
  return (
    <g>
      <path d={`M${hx + ax * len} ${hy + ay * len} A${len} ${len} 0 0 ${sweep} ${hx + ix * len} ${hy + iy * len}`} stroke="#6f695f" strokeWidth={0.8} strokeDasharray="2 2" fill="none" opacity={0.75} />
      <line x1={hx} y1={hy} x2={hx + ix * len} y2={hy + iy * len} stroke="#7a5a3a" strokeWidth={3} strokeLinecap="round" />
    </g>
  );
}

export function DoorSwing({ door }: { door: Door }) {
  const { x, y, len, orient, dir, double, outer } = door;
  const t = outer ? 13 : 9;
  const opening = orient === 'h' ? <rect x={x} y={y - t / 2} width={len} height={t} fill="#a49d92" /> : <rect x={x - t / 2} y={y} width={t} height={len} fill="#a49d92" />;
  const ix = orient === 'v' ? dir : 0;
  const iy = orient === 'h' ? dir : 0;
  const ax = orient === 'h' ? 1 : 0;
  const ay = orient === 'v' ? 1 : 0;
  return (
    <g>
      {opening}
      {double ? (
        <>
          {leaf(x, y, ax, ay, ix, iy, len / 2)}
          {leaf(x + ax * len, y + ay * len, -ax, -ay, ix, iy, len / 2)}
        </>
      ) : (
        leaf(x, y, ax, ay, ix, iy, len)
      )}
    </g>
  );
}

export function WindowPane({ r, night }: { r: Rect; night: boolean }) {
  const horizontal = r.w > r.h;
  const count = Math.max(1, Math.round((horizontal ? r.w : r.h) / 44));
  const mullions = Array.from({ length: count - 1 }, (_, i) => {
    const t = ((i + 1) / count) * (horizontal ? r.w : r.h);
    return horizontal ? `M${r.x + t} ${r.y}v${r.h}` : `M${r.x} ${r.y + t}h${r.w}`;
  }).join('');
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={night ? '#1d2a44' : '#b9dbef'} />
      <path d={horizontal ? `M${r.x} ${r.y + r.h / 2}h${r.w}` : `M${r.x + r.w / 2} ${r.y}v${r.h}`} stroke="#fff" strokeOpacity={night ? 0.25 : 0.8} strokeWidth={0.8} />
      <path d={mullions} stroke="#59606a" strokeWidth={2} />
    </g>
  );
}

export function Camera({ x, y, rot }: { x: number; y: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-2} y={-3} width={12} height={6} rx={2} fill="#e5e7eb" stroke="#9ca3af" strokeWidth={0.5} />
      <circle cx={10} cy={0} r={1.4} fill="#111" />
      <circle cx={-1} cy={0} r={0.9} fill="#ef4444" className="ahq-led" />
    </g>
  );
}

export function Extinguisher({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} filter="url(#ahq-sh-sm)">
      <circle r={4.5} fill="#d42c2c" />
      <rect x={-1.2} y={-7} width={2.4} height={3.5} fill="#222" />
    </g>
  );
}
