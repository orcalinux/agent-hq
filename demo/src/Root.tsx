import { Composition } from 'remotion';
import { Demo } from './Demo';
import { FPS, HEIGHT, WIDTH } from './theme';
import { totalFrames } from './timeline';

export const Root = () => <Composition id="AgentHQDemo" component={Demo} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />;
