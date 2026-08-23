import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Boundary } from '@/components/Boundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside App, because App is what would be taking the tree down with it. */}
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>
);
