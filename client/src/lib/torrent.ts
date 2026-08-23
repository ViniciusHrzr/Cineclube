import { useCallback, useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   The receiver.

   This module is a BitTorrent client that happens to run in a tab. It receives
   a link somebody hands it and plays what comes back; it has no index, no
   search, and no idea which film the room has open. The screening engine does
   not import it and does not know it exists — the room synchronises a `<video>`
   element, whatever is feeding it.

   ── the one fact that shapes everything ───────────────────────────────────
   A browser tab cannot open a TCP socket, and the ordinary BitTorrent swarm is
   TCP/uTP. What a tab can reach is WebRTC peers and HTTP web seeds, and nothing
   else. So a magnet from a public tracker usually resolves *zero* peers here —
   not because anything is broken, but because the swarm it names is unreachable
   from a web page. That is why this file treats "no peers after a while" as a
   named, explained state rather than an error, and why seeding from a browser
   is a first-class mode: one member with the file on disk is what makes the
   link work for everybody else.

   ── why a service worker ──────────────────────────────────────────────────
   Streaming means the video element must be able to range-request a file that
   exists only in another tab's memory. WebTorrent does that by registering a
   service worker and answering fetches through it, so `file.streamTo(el)` is
   really `el.src = <a URL the worker serves>`. That requires the worker to
   control this page, which is why it is registered at the site root and not
   beside the bundle: a worker's scope is its own directory, and one under
   /assets could never control a page at /.
   ══════════════════════════════════════════════════════════════════════════ */

/** How long a magnet is allowed to find nobody before the screen says so. */
const PEER_GRACE_MS = 20_000;
/** Progress, peers and speed, read off the torrent rather than pushed by it. */
const POLL_MS = 1000;

/* The largest file with one of these extensions is what gets played. Matroska
   is in the list without an asterisk: whether a given .mkv plays is a question
   about its codecs and about this browser, and neither is knowable from the
   file name. The player answers it by trying, and says so if it fails. */
const VIDEO = /\.(mp4|m4v|webm|ogv|mov|mkv|avi)$/i;

/* ── how two browsers find each other ─────────────────────────────────────
   They cannot. Not directly, not even on the same machine: a tab has no way to
   discover another tab, and there is no local discovery in a browser. What
   introduces them is a WebSocket tracker on the public internet, which both
   sides announce to and which hands each the other's address.

   Which makes the tracker a single point of failure for the whole feature —
   and these are volunteer-run and go down. So the list is explicit and plural
   rather than left to whichever one the engine happens to default to: one
   tracker being unreachable then costs a failed socket instead of the evening.
   Announced by the seeder, they also travel inside the magnet it generates. */
const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.btorrent.xyz',
];

export type TorrentPhase =
  /** Nothing asked for yet. */
  | 'off'
  /** Registering the worker and loading the engine. */
  | 'booting'
  /** The link is understood; the swarm has not answered yet. */
  | 'searching'
  /** Bytes are arriving and the element has a source. */
  | 'streaming'
  /** This browser is the source, and others can receive from it. */
  | 'seeding'
  | 'error';

export type TorrentStatus = {
  phase: TorrentPhase;
  name: string | null;
  /** The identity of the bytes — this is what the room compares between members. */
  infoHash: string | null;
  /** The link to hand over — to the club's room, or to the chat. */
  magnet: string | null;
  peers: number;
  /** 0 to 1. */
  progress: number;
  /** Bytes per second. */
  down: number;
  up: number;
  /** The swarm answered nobody within the grace period. */
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

/** A magnet link, wherever it came from — a drop, a paste, a field. */
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

/** The biggest video in the torrent, which is the film and not the sample. */
function pickVideo<T extends { name: string; length: number }>(files: T[]): T | undefined {
  const videos = files.filter(f => VIDEO.test(f.name));
  const pool = videos.length ? videos : files;
  if (!pool.length) return undefined;
  return pool.reduce((best, f) => (f.length > best.length ? f : best), pool[0]);
}

export function useTorrent() {
  const [status, setStatus] = useState<TorrentStatus>(IDLE);

  /* Everything below outlives the render that created it: the engine is loaded
     once, the video element arrives from a callback ref, and the poll reads all
     of it from a timer. None of it belongs in state. */
  type Client = InstanceType<typeof import('webtorrent/dist/webtorrent.min.js').default>;
  type Torrent = import('webtorrent/dist/webtorrent.min.js').Torrent;
  type TorrentFile = import('webtorrent/dist/webtorrent.min.js').TorrentFile;
  const clientRef = useRef<Client | null>(null);
  const torrentRef = useRef<Torrent | null>(null);
  const elemRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<TorrentFile | null>(null);
  const bootRef = useRef<Promise<Client> | null>(null);
  /** The link currently being loaded, so the same one is not started twice. */
  const loadingRef = useRef<string | null>(null);

  const patch = useCallback((p: Partial<TorrentStatus>) => {
    setStatus(prev => ({ ...prev, ...p }));
  }, []);

  /* The file and the element arrive in either order — a paste can resolve
     before the player has mounted, and the player can mount before anyone has
     pasted. So neither one attaches the other; both call this, and it acts only
     when both are here. */
  const link = useCallback(() => {
    const el = elemRef.current;
    const file = fileRef.current;
    if (!el || !file) return;
    /* A file whose torrent has been destroyed still exists as an object, and
       asking it for a URL reads through a back-reference that destruction set
       to null. The throw would happen inside React's ref callback — during
       commit, where there is no handler and no recovery — and take the whole
       app off the screen. Two guards, because this must not be survivable by
       luck: the state we can check, and the throw we cannot predict. */
    if (!torrentRef.current || torrentRef.current.destroyed) return;
    try {
      /* `streamTo` is `el.src = <url>`, and assigning `src` reloads the element
         even when the URL is identical — back to zero, and paused. This runs
         whenever either half arrives, so the same pairing can come round more
         than once for reasons that have nothing to do with the film: a re-render
         that re-attaches the ref, a second call from `hold`. Each repeat would
         be a restart, so the pairing that is already made is left alone.

         Compared as the attribute rather than the property: `el.src` resolves
         against the document, `streamURL` is a path, and a comparison between
         the two forms is never equal — which would make the guard a no-op and
         hide the bug it exists to stop. */
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
      /* Checked before anything else, and separately from the API existing,
         because `navigator.serviceWorker` is present on an insecure origin too
         — it just refuses to register. Opening the app by LAN address
         (http://192.168.x.x:3000) is the ordinary way to end up here, and the
         raw registration error names none of that. */
      if (!window.isSecureContext) {
        throw new Error(
          'O modo torrent precisa de HTTPS ou de localhost: nesta URL o navegador bloqueia o service worker que serve o vídeo. Abra pelo endereço do Render, ou use as outras fontes.'
        );
      }
      if (!('serviceWorker' in navigator)) {
        throw new Error('Este navegador não tem service worker — sem ele o vídeo do torrent não pode ser servido.');
      }

      const reg = await navigator.serviceWorker.register('/sw.min.js', { scope: '/' });
      /* `ready` is what guarantees an *activated* worker controlling this page;
         the registration alone can still be installing, and the engine refuses
         a controller that is not active. */
      await navigator.serviceWorker.ready;

      /* Loaded here and not at the top of the file. The engine is heavier than
         the entire rest of the app, and most visits never open this screen —
         imported dynamically, the bundler puts it in a chunk of its own that
         only downloads when somebody actually asks for a torrent.

         The prebuilt browser bundle, not the package entry: the entry expects
         Node globals (`Buffer`, `process`) that a bundler would have to be
         talked into providing, and this file is the same code with that already
         resolved. */
      const { default: WebTorrent } = await import('webtorrent/dist/webtorrent.min.js');
      const client = new WebTorrent();
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
      // A failed boot must not poison every later attempt with a rejected
      // promise nobody can retry.
      bootRef.current = null;
      throw e;
    }
  }, [patch]);

  /** Drops whatever is loaded without tearing down the engine. */
  const clearTorrent = useCallback(() => {
    fileRef.current = null;
    try {
      torrentRef.current?.destroy();
    } catch {
      /* already gone */
    }
    torrentRef.current = null;
    if (elemRef.current) elemRef.current.removeAttribute('src');
  }, []);

  const hold = useCallback(
    (torrent: Torrent, mode: 'streaming' | 'seeding') => {
      /* Adding a torrent the client already has is not an error to the engine:
         it destroys the newcomer and hands the callback the one it kept. If
         that one was itself on its way out — which is precisely what happens
         when the same magnet is dropped and re-added quickly — what arrives
         here is a dead object that still answers to every property except the
         ones that matter. */
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
        /* In both directions. Seeding, this is the link nobody else has yet;
           receiving, it is the same link normalised by the engine — and either
           way it is what the room hands to whoever arrives next. */
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

  /** A magnet, a `.torrent` file, or an infohash. */
  const receive = useCallback(
    async (input: string | File) => {
      const wanted = typeof input === 'string' ? input.trim() : input;
      /* Asking for what is already loading is not a second request. Without
         this, the room publishing a link the moment we adopt it — or a second
         render arriving mid-boot — starts the same magnet twice, and the second
         start tears down the first one's torrent on its way in. */
      if (typeof wanted === 'string' && loadingRef.current === wanted) return;
      loadingRef.current = typeof wanted === 'string' ? wanted : null;

      patch({ ...IDLE, phase: 'booting' });
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
    [boot, clearTorrent, hold, patch]
  );

  /** The other direction: this browser has the file, and hands out the link. */
  const seed = useCallback(
    async (file: File) => {
      loadingRef.current = null;
      patch({ ...IDLE, phase: 'booting' });
      try {
        const client = await boot();
        clearTorrent();
        patch({ phase: 'searching' });
        client.seed(file, { announce: TRACKERS }, torrent => {
          hold(torrent, 'seeding');
        });
      } catch (e) {
        patch({ phase: 'error', error: (e as Error).message });
      }
    },
    [boot, clearTorrent, hold, patch]
  );

  /** The player, handed over by `SyncedVideo`'s callback ref. */
  const attach = useCallback(
    (el: HTMLVideoElement | null) => {
      elemRef.current = el;
      link();
    },
    [link]
  );

  const stop = useCallback(() => {
    loadingRef.current = null;
    clearTorrent();
    setStatus(IDLE);
  }, [clearTorrent]);

  /* Peers and progress are read on a timer rather than from the `download`
     event, which fires once per received chunk — hundreds of times a second on
     a healthy swarm, each one a React render nobody can see. */
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

  /* The lonely swarm. Not an error and not a failure to report — a fact the
     screen has to be able to say in words, because the fix is social: somebody
     with the file has to open the tab. */
  useEffect(() => {
    if (status.phase !== 'searching' && status.phase !== 'streaming') return;
    const id = window.setTimeout(() => {
      const t = torrentRef.current;
      const alone = !t || (t.numPeers === 0 && t.progress === 0);
      if (alone) patch({ lonely: true });
    }, PEER_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [status.phase, status.infoHash, patch]);

  /* Leaving the screen has to close the swarm. A client that survives the
     unmount keeps uploading from a page nobody is looking at, and the next
     visit to the screen would build a second one beside it. */
  useEffect(
    () => () => {
      try {
        clientRef.current?.destroy();
      } catch {
        /* already destroyed */
      }
      clientRef.current = null;
      torrentRef.current = null;
      bootRef.current = null;
    },
    []
  );

  return { status, receive, seed, attach, stop };
}

export type TorrentEngine = ReturnType<typeof useTorrent>;
