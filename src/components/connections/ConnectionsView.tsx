import { useState } from 'react';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import type { AIProviderId } from '@/types';
import { Button, Tabs } from '@/components/ui/primitives';
import { ConnectionWizard } from './ConnectionWizard';
import { LocalTools, ProviderTable } from './ProviderTable';
import { ModelsPanel, RoleDefaults } from './ModelsPanel';

type TabId = 'providers' | 'models' | 'defaults';

export default function ConnectionsView() {
  const providers = useConnectionsStore((s) => s.providers);
  const error = useConnectionsStore((s) => s.error);
  const load = useConnectionsStore((s) => s.load);
  const [tab, setTab] = useState<TabId>('providers');
  const [wizard, setWizard] = useState<{ open: boolean; provider?: AIProviderId }>({ open: false });
  const connected = providers.filter((p) => p.connection).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-1.5">
        <div>
          <h1 className="text-[14px] font-semibold">Connections and models</h1>
          <p className="text-[12px] text-fg-muted">{connected} of {providers.length} providers connected</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs<TabId>
            label="Sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'providers', label: 'Providers' },
              { id: 'models', label: 'Models' },
              { id: 'defaults', label: 'Role defaults' },
            ]}
          />
          <Button variant="primary" onClick={() => setWizard({ open: true })}>Connect provider</Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="mb-3 flex items-center justify-between rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger" role="alert">
            <span>{error}</span>
            <Button size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        ) : null}
        {tab === 'providers' && (
          <>
            <ProviderTable onConnect={(id) => setWizard({ open: true, provider: id })} />
            <LocalTools />
          </>
        )}
        {tab === 'models' && <ModelsPanel />}
        {tab === 'defaults' && <RoleDefaults />}
      </div>
      <ConnectionWizard open={wizard.open} initialProvider={wizard.provider} onClose={() => setWizard({ open: false })} />
    </div>
  );
}
