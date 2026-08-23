/* The browser bundle ships no types, and the published `@types/webtorrent` is
   written against version 1 — it describes `file.appendTo` and `file.renderTo`,
   which version 2 replaced with the service worker and `file.streamTo`. A wrong
   type is worse than none: it would type-check calls that throw at runtime.

   So this declares only what `@/lib/torrent` actually touches, checked against
   `webtorrent/lib/file.js` and `webtorrent/index.js` of the installed version.
   Anything used here that this file does not name is a compile error, which is
   the whole point. */
declare module 'webtorrent/dist/webtorrent.min.js' {
  export type TorrentFile = {
    name: string;
    path: string;
    length: number;
    /* The URL the service worker serves the stream from — a path, relative to
       the document. `streamTo(elem)` is nothing but `elem.src = streamURL`, and
       the caller needs the string itself: assigning `src` reloads the element
       even when the value is unchanged, so it must be able to check first.
       Throws if no server has been created, or if the torrent is destroyed. */
    readonly streamURL: string;
  };

  export type Torrent = {
    infoHash: string;
    magnetURI: string;
    name: string;
    length: number;
    files: TorrentFile[];
    numPeers: number;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    ready: boolean;
    /* Set by `_destroy`, which also nulls the back-reference every file holds
       to its torrent — which is what makes `file.streamTo` throw afterwards. */
    destroyed: boolean;
    on(event: 'ready' | 'done' | 'noPeers' | 'wire', handler: () => void): void;
    on(event: 'error', handler: (err: Error | string) => void): void;
    destroy(): void;
  };

  export default class WebTorrent {
    constructor(opts?: Record<string, unknown>);
    torrents: Torrent[];
    destroyed: boolean;
    /** The browser form needs a service worker registration to stream through. */
    createServer(opts: { controller: ServiceWorkerRegistration }): unknown;
    add(
      torrentId: string | File | Blob,
      opts: { announce?: string[] },
      onTorrent: (torrent: Torrent) => void
    ): Torrent;
    seed(input: File | File[] | Blob, opts: { announce?: string[] }, onSeed: (torrent: Torrent) => void): Torrent;
    on(event: 'error', handler: (err: Error | string) => void): void;
    destroy(): void;
  }
}
