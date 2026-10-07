import { useCallback, useEffect, useRef, useState } from 'react';
import { localChunkStore } from '@/lib/chunkStore';

const PEER_GRACE_MS = 20_000;
const POLL_MS = 1000;

const VIDEO = /\.(mp4|m4v|webm|ogv|mov|mkv|avi)$/i;

const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.btorrent.xyz',
];

export type TorrentPhase =
  | 'off'
  | 'booting'
  | 'searching'
  | 'streaming'
  | 'seeding'
  | 'error';

export type TorrentStatus = {
  phase: TorrentPhase;
  name: string | null;
  infoHash: string | null;
  magnet: string | null;
  peers: number;
  progress: number;
  down: number;
  up: number;
  lonely: boolean;
  error: string | null;
};

const IDLE: TorrentStatus = {
  phase: 'off',
  name: null,
  infoHash: null,
  magnet: null,
  peers: 0,
  progress: 0,
  down: 0,
  up: 0,
  lonely: false,
  error: null,
};

async function askToPersist() {
  try {
    if (!navigator.storage?.persist || !navigator.storage.persisted) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
  }
}

export function isMagnet(value: string) {
  return /^magnet:\?/i.test(value.trim());
}

export function bytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function pickVideo<T extends { name: string; length: number }>(files: T[]): T | undefined {
  const videos = files.filter(f => VIDEO.test(f.name));
  const pool = videos.length ? videos : files;
  if (!pool.length) return undefined;
  return pool.reduce((best, f) => (f.length > best.length ? f : best), pool[0]);
}

export function useTorrent() {
  const [status, setStatus] = useState<TorrentStatus>(IDLE);

  type Client = InstanceType<typeof import('webtorrent/dist/webtorrent.min.js').default>;
  type Torrent = import('webtorrent/dist/webtorrent.min.js').Torrent;
  type TorrentFile = import('webtorrent/dist/webtorrent.min.js').TorrentFile;
  const clientRef = useRef<Client | null>(null);
  const torrentRef = useRef<Torrent | null>(null);
  const elemRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<TorrentFile | null>(null);
  const bootRef = useRef<Promise<Client> | null>(null);
  const loadingRef = useRef<string | null>(null);
  const localRef = useRef<File | null>(null);
  const localURLRef = useRef<string | null>(null);

  const patch = useCallback((p: Partial<TorrentStatus>) => {
    setStatus(prev => ({ ...prev, ...p }));
  }, []);

  const link = useCallback(() => {
    const el = elemRef.current;
    if (!el) return;

    if (localRef.current) {
      localURLRef.current ??= URL.createObjectURL(localRef.current);
      if (el.getAttribute('src') !== localURLRef.current) el.src = localURLRef.current;
      return;
    }

    const file = fileRef.current;
    if (!file) return;
    if (!torrentRef.current || torrentRef.current.destroyed) return;
    try {
      const url = file.streamURL;
      if (el.getAttribute('src') === url) return;
      el.src = url;
    } catch (e) {
      fileRef.current = null;
      patch({ phase: 'error', error: 'A fonte foi encerrada antes do vídeo começar. Escolha de novo.' });
      console.error('[cineclube] streamTo falhou:', e);
    }
  }, [patch]);

  const boot = useCallback(async () => {
    if (bootRef.current) return bootRef.current;

    bootRef.current = (async () => {
      if (!window.isSecureContext) {
        throw new Error(
          'O modo torrent precisa de HTTPS ou de localhost: nesta URL o navegador bloqueia o service worker que serve o vídeo. Abra pelo endereço do Render, ou use as outras fontes.'
        );
      }
      if (!('serviceWorker' in navigator)) {
        throw new Error('Este navegador não tem service worker — sem ele o vídeo do torrent não pode ser servido.');
      }

      const reg = await navigator.serviceWorker.register('/app-sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      const { default: WebTorrent } = await import('webtorrent/dist/webtorrent.min.js');
      const client = new WebTorrent({ maxConns: 16 });
      client.createServer({ controller: reg });
      client.on('error', err => {
        patch({ phase: 'error', error: String(err instanceof Error ? err.message : err) });
      });
      clientRef.current = client;
      return client;
    })();

    try {
      return await bootRef.current;
    } catch (e) {
      bootRef.current = null;
      throw e;
    }
  }, [patch]);

  const clearTorrent = useCallback(() => {
    fileRef.current = null;
    try {
      torrentRef.current?.destroy();
    } catch {
    }
    torrentRef.current = null;
    if (elemRef.current) elemRef.current.removeAttribute('src');
  }, []);

  const dropLocal = useCallback(() => {
    if (localURLRef.current) URL.revokeObjectURL(localURLRef.current);
    localURLRef.current = null;
    localRef.current = null;
  }, []);

  const hold = useCallback(
    (torrent: Torrent, mode: 'streaming' | 'seeding') => {
      if (torrent.destroyed) {
        patch({ phase: 'error', error: 'Essa fonte foi encerrada. Escolha de novo.' });
        return;
      }
      torrentRef.current = torrent;

      const file = pickVideo(torrent.files);
      if (!file) {
        patch({ phase: 'error', error: 'Este torrent não tem nenhum arquivo dentro.' });
        return;
      }
      fileRef.current = file;
      link();

      patch({
        phase: mode,
        name: file.name,
        infoHash: torrent.infoHash,
        magnet: torrent.magnetURI,
        lonely: false,
        error: null,
      });

      torrent.on('error', err => {
        patch({ phase: 'error', error: String(err instanceof Error ? err.message : err) });
      });
    },
    [link, patch]
  );

  const receive = useCallback(
    async (input: string | File) => {
      const wanted = typeof input === 'string' ? input.trim() : input;
      if (typeof wanted === 'string' && loadingRef.current === wanted) return;
      loadingRef.current = typeof wanted === 'string' ? wanted : null;

      patch({ ...IDLE, phase: 'booting' });
      dropLocal();
      void askToPersist();
      try {
        const client = await boot();
        clearTorrent();
        patch({ phase: 'searching' });
        client.add(wanted, { announce: TRACKERS }, torrent => {
          hold(torrent, 'streaming');
        });
      } catch (e) {
        loadingRef.current = null;
        patch({ phase: 'error', error: (e as Error).message });
      }
    },
    [boot, clearTorrent, dropLocal, hold, patch]
  );

  const seed = useCallback(
    async (file: File) => {
      loadingRef.current = null;
      patch({ ...IDLE, phase: 'booting' });

      dropLocal();
      clearTorrent();
      localRef.current = file;
      link();

      try {
        const client = await boot();
        patch({ phase: 'searching' });
        client.seed(
          file,
          {
            announce: TRACKERS,
            store: localChunkStore(file),
            storeCacheSlots: 6,
          } as Parameters<typeof client.seed>[1],
          torrent => {
            hold(torrent, 'seeding');
          }
        );
      } catch (e) {
        patch({ phase: 'error', error: (e as Error).message });
      }
    },
    [boot, clearTorrent, dropLocal, hold, link, patch]
  );

  const attach = useCallback(
    (el: HTMLVideoElement | null) => {
      elemRef.current = el;
      link();
    },
    [link]
  );

  const stop = useCallback(() => {
    loadingRef.current = null;
    dropLocal();
    clearTorrent();
    setStatus(IDLE);
  }, [clearTorrent, dropLocal]);

  useEffect(() => {
    if (status.phase !== 'streaming' && status.phase !== 'seeding' && status.phase !== 'searching') return;
    const id = window.setInterval(() => {
      const t = torrentRef.current;
      if (!t) return;
      setStatus(prev => ({
        ...prev,
        peers: t.numPeers,
        progress: t.progress,
        down: t.downloadSpeed,
        up: t.uploadSpeed,
      }));
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [status.phase]);

  useEffect(() => {
    if (status.phase !== 'searching' && status.phase !== 'streaming') return;
    const id = window.setTimeout(() => {
      const t = torrentRef.current;
      const alone = !t || (t.numPeers === 0 && t.progress === 0);
      if (alone) patch({ lonely: true });
    }, PEER_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [status.phase, status.infoHash, patch]);

  useEffect(
    () => () => {
      try {
        clientRef.current?.destroy();
      } catch {
      }
      clientRef.current = null;
      torrentRef.current = null;
      bootRef.current = null;
      if (localURLRef.current) URL.revokeObjectURL(localURLRef.current);
      localURLRef.current = null;
      localRef.current = null;
    },
    []
  );

  return { status, receive, seed, attach, stop };
}

export type TorrentEngine = ReturnType<typeof useTorrent>;
