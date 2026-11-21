import { useMemo } from 'react';
import { resolveAgentModel, useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { rankModels, routingFor } from '@/engine/modelRouting';
import { useModelWatchStore } from '@/store/useModelWatchStore';

/** Live model routing: the models agents may use and the model for each complexity. */
export function useRouting() {
  const providers = useConnectionsStore((s) => s.providers);
  const scope = useAgentStore((s) => s.modelScope);
  const overrides = useAgentStore((s) => s.tierModels);
  const enabled = useAgentStore((s) => s.complexityRouting);
  const results = useModelWatchStore((s) => s.results);
  const sovereignModel = useAgentStore((s) => resolveAgentModel(s.agents['agent-manager'], s.roleDefaults));
  return useMemo(() => {
    const { models, tiers, peers } = routingFor(providers, { scope, overrides, sovereignModel, results });
    const ranked = rankModels(models, results);
    return { models, ranked, tiers, peers, results, enabled, scope, refs: models.map((m) => m.ref), provider: models[0]?.provider };
  }, [providers, scope, overrides, sovereignModel, enabled, results]);
}
