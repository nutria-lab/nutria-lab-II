import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { setAuthFailureHandler } from './services/apiClient';
import { clearAuthenticated } from './services/authService';
import './index.css';

setAuthFailureHandler(() => {
  clearAuthenticated();
  window.location.assign('/login');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
