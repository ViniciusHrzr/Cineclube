declare module 'webtorrent/dist/webtorrent.min.js' {
  export type TorrentFile = {
    name: string;
    path: string;
    length: number;
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
    destroyed: boolean;
    on(event: 'ready' | 'done' | 'noPeers' | 'wire', handler: () => void): void;
    on(event: 'error', handler: (err: Error | string) => void): void;
    destroy(): void;
  };

  export default class WebTorrent {
    constructor(opts?: Record<string, unknown>);
    torrents: Torrent[];
    destroyed: boolean;
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
