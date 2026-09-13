import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SessionProvider } from './auth/session';
import { AnnouncerProvider } from './components/ui';
import { applyDocumentLocale, detectLocale, TranslationProvider } from './i18n';
import { RouterProvider } from './router';
import './style.css';

// Direction is set before the first render so a right-to-left interface never flashes
// left-to-right on load.
const initialLocale = detectLocale();
applyDocumentLocale(initialLocale);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TranslationProvider initialLocale={initialLocale}>
      <AnnouncerProvider>
        <SessionProvider>
          <RouterProvider>
            <App />
          </RouterProvider>
        </SessionProvider>
      </AnnouncerProvider>
    </TranslationProvider>
  </React.StrictMode>
);
