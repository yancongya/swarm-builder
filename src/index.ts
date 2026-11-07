import { SwarmBuilder } from './api';
import type { SwarmBuilderOptions } from './types';

export { SwarmBuilder };
export type { SwarmBuilderOptions, SwarmResult, AgentInfo, CursorShape } from './types';

/** Creates an instance and starts the rebuild immediately. */
export function mount(options: SwarmBuilderOptions = {}): SwarmBuilder {
  const swarm = new SwarmBuilder({ ...options, autoStart: false });
  swarm.start();
  return swarm;
}
