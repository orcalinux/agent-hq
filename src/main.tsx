import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import App from './App';
import { ErrorBoundary } from '@/components/shell/ErrorBoundary';
import { installDesktopBridge } from '@/desktop/bridge';

installDesktopBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
