// Concatenates independently-rendered binary STL parts into one file. Valid
// only because scene parts are non-overlapping by construction (each part's
// own translate()/rotate() already places it in world coordinates) — this is
// a plain triangle-list concatenation, not a boolean union, so it costs
// nothing beyond the parts' own render time.
const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

export function mergeBinarySTLs(buffers) {
  let totalTriangles = 0;
  const triangleChunks = [];

  for (const buf of buffers) {
    const count = buf.readUInt32LE(HEADER_SIZE);
    totalTriangles += count;
    const start = HEADER_SIZE + 4;
    triangleChunks.push(buf.subarray(start, start + count * TRIANGLE_SIZE));
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header.write("text2scad merged scene STL", 0, "ascii");
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(totalTriangles, 0);

  return Buffer.concat([header, countBuf, ...triangleChunks]);
}

/** Runs `items` through `fn` with at most `limit` in flight at once. */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
