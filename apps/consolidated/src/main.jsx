import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@markets/shell/styles/base.css';
import '@markets/shell/styles/bloom.css';
import '@markets/insider/insider.css';
import '@markets/competitors/competitors.css';
import '@markets/management/management.css';
import '@markets/industry/industry.css';
import '@markets/outlook/outlook.css';
import '@markets/summary/summary.css';
import '@markets/alerts/alerts.css';
import App from './App.jsx';
import { armBoot, dismissBoot } from '@markets/shell/lib/boot.js';

// The escape hatch and the hard ceiling, armed as soon as the bundle runs. The
// cover is already on screen — index.html painted it with the first frame.
armBoot();

// A render that throws would otherwise leave the cover up until the ceiling,
// hiding a real error behind a spinner for nine seconds. Lift it immediately
// and let the failure be visible.
window.addEventListener('error', () => dismissBoot('error'), { once: true });

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
);
