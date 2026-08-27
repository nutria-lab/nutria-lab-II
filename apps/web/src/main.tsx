import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreferencesPage } from './modules/profile/pages/PreferencesPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesPage />
  </StrictMode>,
);
