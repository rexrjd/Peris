import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import MapPreview from './features/map/preview/MapPreview';
import './app/styles/index.css';
const mapPreview = new URLSearchParams(window.location.search).get('map-preview') === '1';
createRoot(document.getElementById('root')!).render(<StrictMode>
    {mapPreview ? <MapPreview /> : <App />}
  </StrictMode>);
