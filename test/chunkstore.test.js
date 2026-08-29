import test from 'node:test';
import assert from 'node:assert/strict';

import { localChunkStore } from '../client/src/lib/chunkStore.ts';

/* ══════════════════════════════════════════════════════════════════════════
   The store the seeder serves peers from.

   It exists so that seeding does not write a second copy of the film to disk
   — see the header of `chunkStore.ts` for why that copy was costing the
   person who brought the film their own picture. What it replaced was a store
   that genuinely held the bytes; this one computes where they are and reads
   them out of the file, so the arithmetic *is* the store.

   And arithmetic is the one kind of mistake this cannot make survivably. A
   store that returns the wrong bytes does not fail here. It fails as a hash
   mismatch in somebody else's browser, halfway through the evening, with
   nothing on screen to say why. So every offset the engine can ask for is
   pinned here: whole pieces, the short last piece, and the block-inside-a-
   piece form that a peer actually uses.
   ══════════════════════════════════════════════════════════════════════════ */

/** A stand-in for the browser's `File`, over bytes we can predict. */
function fakeFile(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251; // prime: no accidental alignment
  return {
    size,
    bytes,
    reads: [],
    slice(start, end) {
      this.reads.push([start, end]);
      const view = bytes.subarray(start, end);
      return { arrayBuffer: async () => view.slice().buffer };
    },
  };
}

/** The callback store API, as a promise. */
function get(store, index, opts) {
  return new Promise((resolve, reject) => {
    const cb = (err, buf) => (err ? reject(err) : resolve(buf));
    if (opts === undefined) store.get(index, cb);
    else store.get(index, opts, cb);
  });
}

/* 1000 bytes in pieces of 256: three whole pieces and a final one of 232. */
const SIZE = 1000;
const PIECE = 256;

function build(size = SIZE, piece = PIECE) {
  const file = fakeFile(size);
  const Store = localChunkStore(file);
  return { file, store: new Store(piece, { length: size }) };
}

test('a whole piece is exactly the bytes at that offset', async () => {
  const { file, store } = build();
  for (const index of [0, 1, 2]) {
    const buf = await get(store, index);
    assert.equal(buf.length, PIECE, `piece ${index} length`);
    assert.deepEqual(buf, file.bytes.subarray(index * PIECE, (index + 1) * PIECE));
  }
});

test('the last piece is short, not padded and not over-read', async () => {
  const { file, store } = build();
  const buf = await get(store, 3);
  assert.equal(buf.length, SIZE - 3 * PIECE, 'the remainder, 232 bytes');
  assert.deepEqual(buf, file.bytes.subarray(3 * PIECE, SIZE));
  // And it never asked the file for a byte that is not there.
  for (const [, end] of file.reads) assert.ok(end <= SIZE, `read ended at ${end}, file is ${SIZE}`);
});

test('a block inside a piece is offset from the piece, not from the file', async () => {
  const { file, store } = build();
  const buf = await get(store, 2, { offset: 16, length: 64 });
  assert.equal(buf.length, 64);
  assert.deepEqual(buf, file.bytes.subarray(2 * PIECE + 16, 2 * PIECE + 16 + 64));
});

test('a block is clipped to its own piece, never bleeding into the next', async () => {
  const { file, store } = build();
  // Asks for more than remains in piece 1 — the engine must not receive piece 2's bytes.
  const buf = await get(store, 1, { offset: PIECE - 10, length: 500 });
  assert.equal(buf.length, 10);
  assert.deepEqual(buf, file.bytes.subarray(2 * PIECE - 10, 2 * PIECE));
});

test('an offset with no length runs to the end of the piece', async () => {
  const { file, store } = build();
  const buf = await get(store, 0, { offset: 200 });
  assert.equal(buf.length, PIECE - 200);
  assert.deepEqual(buf, file.bytes.subarray(200, PIECE));
});

test('an offset into the short last piece stays inside it', async () => {
  const { file, store } = build();
  const buf = await get(store, 3, { offset: 200 });
  assert.equal(buf.length, SIZE - 3 * PIECE - 200, '32 bytes left');
  assert.deepEqual(buf, file.bytes.subarray(3 * PIECE + 200, SIZE));
});

test('a piece past the end is an error, not an empty buffer', async () => {
  const { store } = build();
  await assert.rejects(() => get(store, 4), /fora do arquivo/);
  await assert.rejects(() => get(store, -1), /fora do arquivo/);
});

test('a file that divides evenly has no short piece', async () => {
  const { file, store } = build(1024, 256);
  const buf = await get(store, 3);
  assert.equal(buf.length, 256);
  assert.deepEqual(buf, file.bytes.subarray(768, 1024));
  await assert.rejects(() => get(store, 4), /fora do arquivo/);
});

test('a file smaller than one piece is a single short piece', async () => {
  const { file, store } = build(100, 256);
  const buf = await get(store, 0);
  assert.equal(buf.length, 100);
  assert.deepEqual(buf, file.bytes.subarray(0, 100));
  await assert.rejects(() => get(store, 1), /fora do arquivo/);
});

test('the engine length wins over the file size when they disagree', async () => {
  /* The pieces were hashed against the engine's number. If a file somehow
     reads longer, serving the extra bytes would corrupt the last piece. */
  const file = fakeFile(1000);
  const Store = localChunkStore(file);
  const store = new Store(256, { length: 900 });
  const buf = await get(store, 3);
  assert.equal(buf.length, 900 - 768);
  assert.deepEqual(buf, file.bytes.subarray(768, 900));
});

test('put is accepted and writes nothing — the file is already the truth', async () => {
  const { file, store } = build();
  const before = file.reads.length;
  await new Promise((resolve, reject) =>
    store.put(0, new Uint8Array(PIECE), err => (err ? reject(err) : resolve()))
  );
  // Unchanged: a put must not be able to alter what a later get returns.
  const buf = await get(store, 0);
  assert.deepEqual(buf, file.bytes.subarray(0, PIECE));
  assert.equal(file.reads.length, before + 1, 'the put itself touched nothing');
});

test('close and destroy succeed without deleting the member’s film', async () => {
  const { file, store } = build();
  await new Promise(resolve => store.close(resolve));
  await new Promise(resolve => store.destroy(resolve));
  assert.equal(file.bytes.length, SIZE, 'the file is untouched');
});

test('chunkLength is what the engine passed, not a guess', () => {
  const file = fakeFile(SIZE);
  const Store = localChunkStore(file);
  for (const piece of [16384, 262144, 4194304]) {
    assert.equal(new Store(piece, { length: SIZE }).chunkLength, piece);
  }
});
