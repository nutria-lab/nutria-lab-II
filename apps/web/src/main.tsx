import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginPage } from './features/auth/LoginPage';

function App() {
  return <LoginPage />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
