import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() { return <main><h1>nutria-labII</h1><p>Workspace listo.</p></main>; }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
