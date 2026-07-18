// Counts connected components in a binary STL mesh via union-find over
// shared vertices. This is the correct way to detect genuinely disconnected
// (floating) parts — unlike OpenSCAD's own "Volumes:" summary line, which
// counts Nef-polyhedron regions (including hollow cavities) and reports the
// same count for a valid single-piece hollow object as for two entirely
// separate disconnected ones. Verified empirically before relying on this.
//
// Caveat: any object with a fully enclosed internal cavity (a sealed void,
// as opposed to a mug-like cavity that's open to the outside at the rim)
// will legitimately report 2+ components — the outer skin and the cavity
// lining never share a vertex even though it's a single valid printable
// part. Treat a count above 1 as "worth a second look", not proof of a bug.
class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x);
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  add(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
}

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50; // 12 floats (normal + 3 verts) + 2-byte attribute

export function countConnectedComponents(stl) {
  if (stl.length < HEADER_SIZE + 4) return 1;

  const triCount = stl.readUInt32LE(HEADER_SIZE);
  const expectedSize = HEADER_SIZE + 4 + triCount * TRIANGLE_SIZE;
  if (triCount === 0 || expectedSize > stl.length) return 1;

  const uf = new UnionFind();
  const vertexIds = new Map();
  const idFor = (x, y, z) => {
    // round to dedupe near-identical floating point vertices from CGAL
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertexIds.size;
      vertexIds.set(key, id);
      uf.add(id);
    }
    return id;
  };

  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triCount; i++) {
    // skip the 12-byte normal vector, read the 3 vertices
    const ax = stl.readFloatLE(offset + 12);
    const ay = stl.readFloatLE(offset + 16);
    const az = stl.readFloatLE(offset + 20);
    const bx = stl.readFloatLE(offset + 24);
    const by = stl.readFloatLE(offset + 28);
    const bz = stl.readFloatLE(offset + 32);
    const cx = stl.readFloatLE(offset + 36);
    const cy = stl.readFloatLE(offset + 40);
    const cz = stl.readFloatLE(offset + 44);

    const a = idFor(ax, ay, az);
    const b = idFor(bx, by, bz);
    const c = idFor(cx, cy, cz);
    uf.union(a, b);
    uf.union(b, c);

    offset += TRIANGLE_SIZE;
  }

  const roots = new Set();
  for (const id of vertexIds.values()) roots.add(uf.find(id));
  return roots.size;
}
