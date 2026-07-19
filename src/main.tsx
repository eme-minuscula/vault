import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { applyTheme, useTheme } from './state/theme.ts';

// Apply the persisted theme before first paint to avoid a flash of the wrong mode.
applyTheme(useTheme.getState().theme);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
