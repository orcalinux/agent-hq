import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Icon } from '../components/Icon';
import { Card, rise, Tile, useEnter } from '../components/ui';
import { C } from '../theme';
import type { Scene } from '../timeline';

const RULES = [
  { icon: 'user', title: 'You', detail: 'A model you picked in the plan card', color: C.accent },
  { icon: 'lock', title: 'Locked agent', detail: 'Agents → Always this model', color: C.roles.backend },
  { icon: 'lock', title: 'Locked level', detail: 'Settings → Locked, or Force my setup', color: C.warning },
  { icon: 'crown', title: 'Sovereign', detail: 'Chooses a better model and says why', color: C.roles.manager },
  { icon: 'star', title: 'Preferred level', detail: 'Your pin, as a starting point', color: C.roles.architect },
  { icon: 'layers', title: 'Magpie group', detail: 'The account with the most quota left', color: C.roles.frontend },
  { icon: 'shuffle', title: 'Auto', detail: 'Best-ranked models take turns', color: C.success },
];
const TOP = 170;
const ROW = 98;
const LEFT = 250;
const WIDTH = 1120;
const STOP = 3;

export const LadderScene = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const last = scene.voice[8];
  const current = scene.voice.findIndex((l, i) => frame >= l.from && frame < (scene.voice[i + 1]?.from ?? Infinity));
  const probe = interpolate(frame, [last.from, last.from + Math.min(70, last.frames * 0.6)], [0, STOP], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const landed = spring({ frame: frame - (last.from + Math.min(70, last.frames * 0.6)), fps, config: { damping: 12 } });
  const chip = useEnter(last.from - 6);
  const header = useEnter(scene.voice[0].from);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: LEFT, top: 92, fontSize: 44, fontWeight: 700, color: C.fg, letterSpacing: -1, ...rise(header) }}>
        Who picks each task's model? <span style={{ color: C.accent }}>The first rule that applies.</span>
      </div>
      {RULES.map((r, i) => {
        const line = scene.voice[i + 1];
        const p = useEnter(line.from - 4);
        const speaking = current === i + 1;
        const checked = current === 8 && probe > i + 0.5 && i < STOP;
        const winner = current === 8 && i === STOP && landed > 0.5;
        return (
          <div key={r.title} style={{ position: 'absolute', left: LEFT, top: TOP + i * ROW, width: WIDTH, ...rise(p, 20), opacity: Math.min(1, p * 1.4) * (checked ? 0.45 : 1) }}>
            <Card glow={speaking || winner ? r.color : undefined} style={{ height: ROW - 14, display: 'flex', alignItems: 'center', gap: 22, padding: '0 22px' }}>
              <div style={{ width: 40, fontSize: 30, fontWeight: 700, color: C.subtle, textAlign: 'center' }}>{i + 1}</div>
              <Tile color={r.color} size={54}>
                <Icon name={r.icon} size={26} />
              </Tile>
              <span style={{ fontSize: 32, fontWeight: 700, color: C.fg, width: 250 }}>{r.title}</span>
              <span style={{ fontSize: 25, color: C.muted, flex: 1, whiteSpace: 'nowrap' }}>{r.detail}</span>
              {winner ? <span style={{ fontSize: 22, fontWeight: 700, color: r.color, transform: `scale(${landed})` }}>WINS</span> : null}
              {checked ? <span style={{ fontSize: 20, color: C.subtle }}>not set</span> : null}
            </Card>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: LEFT + WIDTH + 50, top: TOP + probe * ROW + 8, ...rise(chip) }}>
        <Card glow={C.accent} style={{ padding: '14px 22px', width: 420 }}>
          <div style={{ fontSize: 18, color: C.subtle, textTransform: 'uppercase', letterSpacing: 1.5 }}>Task</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: C.fg, marginTop: 4 }}>Add subtract helper</div>
          <div style={{ fontSize: 22, color: landed > 0.5 ? C.roles.manager : C.muted, marginTop: 6 }}>{landed > 0.5 ? '→ GPT-5 Codex, by Sovereign' : 'checking rules…'}</div>
        </Card>
      </div>
    </AbsoluteFill>
  );
};
