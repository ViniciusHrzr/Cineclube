import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Boundary } from '@/components/Boundary';
import './index.css';

/* ── o worker, registrado uma vez ─────────────────────────────────────────
   É ele que faz o navegador do celular oferecer "instalar" e o app abrir sem
   rede depois da primeira visita. O arquivo é UM só e importa o do WebTorrent
   dentro dele — o escopo `/` aceita um registro, e um segundo substituiria o
   primeiro em vez de somar. Ver public/app-sw.js.

   Depois do `load` para não disputar banda com a primeira tela, e em silêncio
   quando falha: sem service worker o app continua inteiro, só não instala nem
   abre offline. Um erro no console de quem abriu por IP de rede local — onde o
   navegador recusa registrar — não é notícia para ninguém. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app-sw.js', { scope: '/' }).catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside App, because App is what would be taking the tree down with it. */}
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>
);
