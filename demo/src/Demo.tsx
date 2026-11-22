import { Fragment } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Backdrop } from './components/Backdrop';
import { Captions } from './components/Captions';
import { Chapter } from './components/Chapter';
import { FlowScene } from './scenes/FlowScene';
import { LadderScene } from './scenes/LadderScene';
import { OutroScene } from './scenes/OutroScene';
import { ShotsScene } from './scenes/ShotsScene';
import { TeamScene } from './scenes/TeamScene';
import { TitleScene } from './scenes/TitleScene';
import { scenes, TRANSITION, type Scene } from './timeline';
import { sans } from './theme';

function Visual({ scene }: { scene: Scene }) {
  switch (scene.kind) {
    case 'title': return <TitleScene scene={scene} />;
    case 'flow': return <FlowScene scene={scene} />;
    case 'team': return <TeamScene scene={scene} />;
    case 'ladder': return <LadderScene scene={scene} />;
    case 'outro': return <OutroScene scene={scene} />;
    default: return <ShotsScene scene={scene} />;
  }
}

export const Demo = () => (
  <AbsoluteFill style={{ fontFamily: sans }}>
    <Backdrop />
    <TransitionSeries>
      {scenes.map((scene, i) => (
        <Fragment key={scene.id}>
          {i > 0 ? <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} /> : null}
          <TransitionSeries.Sequence durationInFrames={scene.frames}>
            <Visual scene={scene} />
            {scene.chapter ? <Chapter label={scene.chapter} /> : null}
            <Captions lines={scene.voice} />
            {scene.voice.map((line) => (
              <Sequence key={line.file + line.from} from={line.from} durationInFrames={line.frames + 2} layout="none">
                <Audio src={staticFile(line.file)} />
              </Sequence>
            ))}
          </TransitionSeries.Sequence>
        </Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
