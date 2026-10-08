import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import MapPreview from './features/map/preview/MapPreview';
const BattlePreview = lazy(() => import('./features/battle/preview/BattlePreview'));
import './app/styles/index.css';
const mapPreview = new URLSearchParams(window.location.search).get('map-preview') === '1';
const battlePreview = new URLSearchParams(window.location.search).get('battle-preview') === '1';
createRoot(document.getElementById('root')!).render(<StrictMode>
    {battlePreview ? <Suspense fallback={<p>Preparing battle preview…</p>}><BattlePreview /></Suspense> : mapPreview ? <MapPreview /> : <App />}
  </StrictMode>);
