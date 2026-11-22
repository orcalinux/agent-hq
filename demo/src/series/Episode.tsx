import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { sans } from '../theme';
import { IntroCard, OutroCard } from './Cards';
import { episode, XFADE, type EpisodePlan, type Part } from './plan';
import { Recording } from './Recording';
import { Subtitles } from './Subtitles';

export interface EpisodeProps extends Record<string, unknown> { id: string; plan?: EpisodePlan }

const Fade = ({ part, children, first, last }: { part: Part; children: React.ReactNode; first?: boolean; last?: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(
    first ? 1 : interpolate(frame, [0, XFADE], [0, 1], { extrapolateRight: 'clamp' }),
    interpolate(frame, [part.frames - (last ? 14 : XFADE), part.frames], [1, 0], { extrapolateLeft: 'clamp' }),
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Voices = ({ part }: { part: Part }) => (
  <>
    {part.voice.map((line) => (
      <Sequence key={line.file + line.from} from={line.from} durationInFrames={line.frames + 3} layout="none">
        <Audio src={staticFile(line.file)} />
      </Sequence>
    ))}
  </>
);

export const Episode = ({ id, plan }: EpisodeProps) => {
  if (!plan) return null;
  const ep = episode(id);
  const clicks = plan.capture.clicks.map((c) => Math.round((c.t - plan.rec.trim) * 30)).filter((f) => f >= 0 && f < plan.rec.frames);
  return (
    <AbsoluteFill style={{ fontFamily: sans }}>
      <Backdrop />
      <Sequence durationInFrames={plan.intro.frames} name="Intro">
        <Fade part={plan.intro} first>
          <IntroCard ep={ep} part={plan.intro} />
          <Subtitles voice={plan.intro.voice} top={960} />
        </Fade>
        <Voices part={plan.intro} />
      </Sequence>
      <Sequence from={plan.rec.from} durationInFrames={plan.rec.frames} name="Recording">
        <Fade part={plan.rec}>
          <Recording ep={ep} plan={plan} />
          <Subtitles voice={plan.rec.voice} />
        </Fade>
        <Voices part={plan.rec} />
        {clicks.map((f) => (
          <Sequence key={f} from={f} durationInFrames={6} layout="none">
            <Audio src={staticFile('sfx/click.wav')} volume={0.32} />
          </Sequence>
        ))}
      </Sequence>
      <Sequence from={plan.outro.from} durationInFrames={plan.outro.frames} name="Outro">
        <Fade part={plan.outro} last>
          <OutroCard ep={ep} part={plan.outro} />
          <Subtitles voice={plan.outro.voice} top={960} />
        </Fade>
        <Voices part={plan.outro} />
      </Sequence>
    </AbsoluteFill>
  );
};
