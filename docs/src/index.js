import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import registerServiceWorker from './registerServiceWorker';
import App from './components/App';
const rootElement = document.getElementById('root');

// Always attempt to hydrate if server-rendered HTML is present
if (rootElement.hasChildNodes()) {
  hydrateRoot(rootElement, <App />);
} else {
  // Fallback to client-side rendering if no server-rendered HTML
  const root = createRoot(rootElement);
  root.render(<App />);
}

registerServiceWorker();
