import { Composition } from 'remotion';
import { Demo } from './Demo';
import { Episode } from './series/Episode';
import { EPISODES, loadPlan } from './series/plan';
import { FPS, HEIGHT, WIDTH } from './theme';
import { totalFrames } from './timeline';

/** 00 is the narrated overview; 01-06 are the recorded tutorials, each sized from its own recording. */
export const Root = () => (
  <>
    <Composition id="Overview" component={Demo} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
    {EPISODES.map((ep) => (
      <Composition
        key={ep.id}
        id={`Episode-${ep.id}`}
        component={Episode}
        defaultProps={{ id: ep.id }}
        calculateMetadata={async ({ props }) => {
          const plan = await loadPlan(props.id);
          return { durationInFrames: plan.total, props: { ...props, plan } };
        }}
        durationInFrames={300}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    ))}
  </>
);
