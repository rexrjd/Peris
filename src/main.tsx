import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
const gameStyles = () => import('./app/styles/index.css');
const App = lazy(() => Promise.all([import('./app/App'), gameStyles()]).then(([view]) => view));
const MapPreview = lazy(() => Promise.all([import('./features/map/preview/MapPreview'), gameStyles()]).then(([view]) => view));
const BattlePreview = lazy(() => Promise.all([import('./features/battle/preview/BattlePreview'), gameStyles()]).then(([view]) => view));
const UnitGallery = lazy(() => import('./features/battle/preview/UnitGallery'));
const mapPreview = new URLSearchParams(window.location.search).get('map-preview') === '1';
const battlePreview = new URLSearchParams(window.location.search).get('battle-preview') === '1';
const unitGallery = new URLSearchParams(window.location.search).get('unit-gallery') === '1';
createRoot(document.getElementById('root')!).render(<StrictMode>
    <Suspense fallback={<p>{unitGallery ? 'Preparing unit gallery…' : battlePreview ? 'Preparing battle preview…' : 'Preparing Peris…'}</p>}>
      {unitGallery ? <UnitGallery /> : battlePreview ? <BattlePreview /> : mapPreview ? <MapPreview /> : <App />}
    </Suspense>
  </StrictMode>);
