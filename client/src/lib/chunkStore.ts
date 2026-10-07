type Done = (err: Error | null, buf?: Uint8Array) => void;

export type Sliceable = {
  size: number;
  slice: (start: number, end: number) => { arrayBuffer: () => Promise<ArrayBuffer> };
};

export function localChunkStore(file: Sliceable) {
  return class LocalFileChunkStore {
    chunkLength: number;
    length: number;

    constructor(chunkLength: number, opts?: { length?: number }) {
      this.chunkLength = chunkLength;
      this.length = opts?.length ?? file.size;
    }

    put(_index: number, _buf: Uint8Array, cb?: (err: Error | null) => void) {
      cb?.(null);
    }

    get(index: number, opts: { offset?: number; length?: number } | null | Done, cb?: Done): void {
      if (typeof opts === 'function') return this.get(index, null, opts);
      const done: Done = cb ?? (() => {});

      const chunkStart = index * this.chunkLength;
      if (index < 0 || chunkStart >= this.length) {
        queueMicrotask(() => done(new Error(`Peça ${index} está fora do arquivo.`)));
        return;
      }
      const chunkEnd = Math.min(chunkStart + this.chunkLength, this.length);
      const offset = opts?.offset ?? 0;
      const wanted = opts?.length ?? chunkEnd - chunkStart - offset;
      const from = chunkStart + offset;
      const to = Math.min(from + wanted, chunkEnd);

      if (from < chunkStart || to < from) {
        queueMicrotask(() => done(new Error(`Pedido inválido dentro da peça ${index}.`)));
        return;
      }

      Promise.resolve(file.slice(from, to).arrayBuffer()).then(
        buf => done(null, new Uint8Array(buf)),
        (err: Error) => done(err)
      );
    }

    close(cb?: (err: Error | null) => void) {
      cb?.(null);
    }

    destroy(cb?: (err: Error | null) => void) {
      cb?.(null);
    }
  };
}
