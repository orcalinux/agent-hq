import { describe, expect, it } from 'vitest';
import { parsePlan } from '../../src/engine/orchestratorParsing';

describe('domain specialists in plans', () => {
  it('preserves arbitrary expertise and instructions without breaking task routing', () => {
    const plan = parsePlan(JSON.stringify({
      summary: 'Review firmware and sensor integration',
      newAgents: [{
        key: 'firmware',
        name: 'Volt',
        role: 'backend',
        title: 'Firmware engineer',
        specialty: 'IoT & Embedded',
        focus: 'Study STM32, MQTT and OTA updates; verify with the project toolchain.',
      }],
      tasks: [{
        id: 'firmware-review',
        title: 'Review sensor firmware',
        agentId: 'firmware',
        dependsOn: [],
      }],
    }), {});
    expect(plan.newAgents?.[0]).toMatchObject({
      specialty: 'IoT & Embedded',
      role: 'backend',
      focus: 'Study STM32, MQTT and OTA updates; verify with the project toolchain.',
    });
    expect(plan.tasks[0].agentId).toBe(plan.newAgents?.[0].key);
    expect(plan.tasks[0].stage).toBe('implementation');
  });
});
