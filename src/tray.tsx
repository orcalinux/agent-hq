import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { TrayPanel } from './desktop/TrayPanel';
import { ErrorBoundary } from './components/shell/ErrorBoundary';
import { OverflowTooltipHost } from './components/ui/OverflowTooltip';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><TrayPanel /><OverflowTooltipHost /></ErrorBoundary>
  </StrictMode>,
);
