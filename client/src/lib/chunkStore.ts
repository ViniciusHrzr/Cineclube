/* ── serving the film without making a second one ─────────────────────────
   By default the engine keeps every torrent in a chunk store backed by the
   origin-private filesystem, and seeding fills it by streaming the chosen file
   into it end to end. For somebody receiving, that store is the film — there
   is nowhere else it could live. For somebody seeding it is a duplicate: a
   second copy of a file this disk already holds, written in full before the
   magnet even exists, and then read back out of all evening.

   Three costs, and the seeder pays all of them. A multi-gigabyte write racing
   the player's own reads for the same disk, at exactly the moment the film is
   starting. A storage quota that a couple of features will exhaust, after
   which the write fails mid-session. And a copy that outlives the screening,
   because nothing deletes it — so the disk carries every film the club has
   ever watched.

   None of it buys anything. The bytes peers ask for are in the `File`, and a
   browser reads a slice of a file natively and off the main thread. So this is
   the store: `get` is a read of the real file, `put` has nothing to do because
   there is nothing this store could learn that it does not already have, and
   the engine writes zero bytes anywhere.

   Handed over as a class rather than an instance because the chunk size is the
   torrent's piece length, which is chosen while the torrent is being created —
   the engine constructs this with the real number, and computing it here
   instead would be a guess that corrupts what peers receive when it is wrong.

   ── the only part with arithmetic in it ───────────────────────────────────
   `get` is asked for a piece, and sometimes for one block inside a piece. Both
   the offset and the short final piece are places where being wrong hands a
   peer bytes that are not the bytes it asked for — which does not fail here,
   it fails as a hash mismatch on somebody else's machine. `chunkstore.test.js`
   holds it to the arithmetic. */

/** What a chunk store answers with. Errors first, in the Node style the engine expects. */
type Done = (err: Error | null, buf?: Uint8Array) => void;

/** The slice of `File` this needs. Lets a test stand in for one. */
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
      /* The engine's own idea of the length, not the file's. They agree for
         the single-file torrent this always is, and if they ever did not, the
         engine's is the one the pieces were hashed against. */
      this.length = opts?.length ?? file.size;
    }

    put(_index: number, _buf: Uint8Array, cb?: (err: Error | null) => void) {
      cb?.(null);
    }

    get(index: number, opts: { offset?: number; length?: number } | null | Done, cb?: Done): void {
      /* The wrappers call both arities: `get(i, cb)` from the cache, and
         `get(i, {offset, length}, cb)` from a peer asking for one block. */
      if (typeof opts === 'function') return this.get(index, null, opts);
      const done: Done = cb ?? (() => {});

      const chunkStart = index * this.chunkLength;
      if (index < 0 || chunkStart >= this.length) {
        queueMicrotask(() => done(new Error(`Peça ${index} está fora do arquivo.`)));
        return;
      }
      /* The last piece is short, and asking a `File` for bytes past its end
         returns a shorter slice rather than an error — which would hand a peer
         a truncated block that fails its hash somewhere else entirely. */
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

    /* Nothing of ours to delete — the film belongs to the person who chose it
       and is none of this store's business. */
    destroy(cb?: (err: Error | null) => void) {
      cb?.(null);
    }
  };
}
