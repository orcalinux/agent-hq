import { useMemo } from 'react';
import { resolveAgentModel, useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { routingFor } from '@/engine/modelRouting';

/** Live model routing: the models agents may use and the model for each complexity. */
export function useRouting() {
  const providers = useConnectionsStore((s) => s.providers);
  const scope = useAgentStore((s) => s.modelScope);
  const overrides = useAgentStore((s) => s.tierModels);
  const enabled = useAgentStore((s) => s.complexityRouting);
  const sovereignModel = useAgentStore((s) => resolveAgentModel(s.agents['agent-manager'], s.roleDefaults));
  return useMemo(() => {
    const { models, tiers } = routingFor(providers, { scope, overrides, sovereignModel });
    return { models, tiers, enabled, scope, refs: models.map((m) => m.ref), provider: models[0]?.provider };
  }, [providers, scope, overrides, sovereignModel, enabled]);
}
