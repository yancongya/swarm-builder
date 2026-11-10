import { SwarmBuilder } from './api';
import { DEFAULT_OPTIONS, SPEED_STEPS } from './core/config';
import type { SwarmBuilderOptions } from './types';

export { SwarmBuilder, DEFAULT_OPTIONS, SPEED_STEPS };
export type {
  SwarmBuilderOptions,
  SwarmConfig,
  SwarmResult,
  SwarmStatus,
  SwarmPhase,
  AgentInfo,
  CursorShape,
} from './types';

/** Creates an instance and starts the rebuild immediately. */
export function mount(options: SwarmBuilderOptions = {}): SwarmBuilder {
  const swarm = new SwarmBuilder({ ...options, autoStart: false });
  swarm.start();
  return swarm;
}
