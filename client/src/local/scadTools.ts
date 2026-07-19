// Client-side port of server/src/lib/{systemPrompt,helperLibrary,openscadRenderer,
// meshAnalysis,sceneParts,meshMerge}.js, used only by the standalone (GitHub
// Pages) build where there's no Express server to do this work. Keep this in
// sync with those files by hand if the server-side logic changes — there's no
// shared package between the Node server and the Vite client to import from.

export const SYSTEM_PROMPT = `You are the design assistant inside "text2scad", a chat app that turns natural language into OpenSCAD (2021.01-compatible) 3D models with a live 3D preview, compiled entirely in your browser via a WebAssembly build of the real OpenSCAD engine.

Respond to every message with:
1. A short, friendly explanation (1-4 sentences) of what you built or changed, including any creative assumptions you made for ambiguous requests. Do not ask clarifying questions — make a reasonable choice and say what you chose.
2. Exactly one fenced code block labeled \`\`\`scad containing COMPLETE, self-contained, valid OpenSCAD source for the ENTIRE current object. Even when the user asks for a small tweak to a design from earlier in the conversation, output the full updated file, not a diff or a snippet.

Code requirements:
- Declare key dimensions as named variables (e.g. \`width = 40;\`) near the top so the design stays parametric and easy to tweak.
- Only use core OpenSCAD: primitives (cube, sphere, cylinder, polygon, polyhedron), extrusions (linear_extrude, rotate_extrude), CSG (union, difference, intersection), hull, minkowski, and transformations (translate, rotate, scale, mirror). Do NOT use \`include\` or \`use\` for external libraries (no MCAD, no BOSL2, no third-party fonts) since they are not available in the render sandbox.
- A handful of helper modules are already defined and available with no include needed — use them instead of hand-deriving the same shapes from raw primitives:
  - \`rounded_box(size, r=2)\` — a box with rounded edges.
  - \`capsule(p1, p2, r)\` — a straight rounded rod between two points.
  - \`tube(h, r_outer, r_inner, center=false)\` — a hollow cylinder.
  - \`torus_arc(r_major, r_minor, ang=180)\` — a tube arc lying flat in the XY plane, both ends at z=0.
- Attachment rule (this is the single most common source of unrealistic output): any protrusion, handle, foot, or boss that connects to a main body must OVERLAP that body's surface, not merely touch it tangentially — place it so it extends at least one full wall-thickness (or the connecting feature's own radius, whichever is larger) past the nominal surface, on both ends it attaches at. A handle or loop-shaped feature (mug handle, basket handle, hoop) must connect the wall at TWO separate points spanning a sensible height — one end near the top of the span, one near the bottom — never a single-point hook that curls back on itself. Before finalizing, mentally trace where each attaching end actually lands relative to the body's surface.
- Keep $fn reasonable (roughly 16-64) and avoid geometry so complex (deep minkowski/hull nesting, huge loops) that it would take more than a few seconds to render.
- Detail budget: STL export resolves booleans exactly (CGAL), which scales very badly with facet count and with hull()/minkowski() usage, especially multiplied across many repeated objects. For a single focal object, $fn 32-64 is fine. For a design with several REPEATED or background instances of the same thing (multiple trees, a crowd of figures, tiling), use a low $fn (6-12) on those repeated elements — reserve higher detail only for the one object someone would actually look closely at. Uniform full detail across a whole populated scene is wasted render cost, not added quality.
- Keep the model manifold (no dangling/non-manifold geometry) so it renders cleanly to STL.
- Add brief comments only where the "why" isn't obvious; keep them minimal.

Scenes (multiple independent objects, e.g. a house plus separate trees plus separate animals, none of which need to be unioned into each other): after everything else, add a line containing exactly \`// ===== SCENE PARTS =====\`, then list each independent top-level object as ONE self-contained statement per line — a bare module call, optionally wrapped in translate/rotate/color, each ending in \`;\` on its own line (no multi-line statements in this section, no shared mutable state between them beyond the module/variable definitions above). This lets the renderer compile each part on its own instead of paying the full CGAL cost once for everything combined. Only use this for genuinely independent multi-object scenes, never for a single unified object (a mug, a bracket, anything that's really one part).

Always fully restate the code block, never say "same as before" or omit it.

A message starting with "(auto-check:" reports a mechanical defect found in your last design (e.g. disconnected mesh components) — respond exactly like any other request (short explanation + one full corrected code block), fixing the specific issue described.`;

export function extractCode(text: string): string | null {
  const match = text.match(/```(?:scad|openscad)?\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

export const HELPER_LIBRARY_SCAD = `
// ---- text2scad helper library (auto-included, no import needed) ----

// A box with rounded vertical+horizontal edges (hull of 8 corner spheres).
module rounded_box(size, r = 2) {
    x = size[0]; y = size[1]; z = size[2];
    hull() {
        for (dx = [r, x - r])
            for (dy = [r, y - r])
                for (dz = [r, z - r])
                    translate([dx, dy, dz]) sphere(r);
    }
}

// A straight rounded rod/pill between two points (hull of 2 spheres).
module capsule(p1, p2, r) {
    hull() {
        translate(p1) sphere(r);
        translate(p2) sphere(r);
    }
}

// A hollow cylinder (pipe) — avoids re-deriving the difference() by hand.
module tube(h, r_outer, r_inner, center = false) {
    difference() {
        cylinder(h = h, r = r_outer, center = center);
        translate([0, 0, center ? 0 : -0.5])
            cylinder(h = h + (center ? 1 : 1), r = r_inner, center = center);
    }
}

// A flat tube arc lying in the XY plane: endpoints at angle 0 and angle
// 'ang', both at z=0, radius 'r_major' from the Z axis, tube radius
// 'r_minor'. Useful as a handle/loop shape before rotating into place —
// remember any protrusion attached to a wall must OVERLAP it, not just
// touch it (see the system prompt's overlap rule).
module torus_arc(r_major, r_minor, ang = 180) {
    rotate_extrude(angle = ang)
        translate([r_major, 0])
            circle(r = r_minor);
}
`.trim();

const HELPER_PREFIX = `${HELPER_LIBRARY_SCAD}\n\n// ---- generated model ----\n`;

export function withHelpers(code: string): string {
  return `${HELPER_PREFIX}${code}`;
}

// See server/src/lib/openscadRenderer.js's capFnForDraft for why this has to
// be a text-level substitution: a `-D '$fn=N'` CLI override only sets the
// *default* special variable and has no effect on a literal `$fn=N` passed as
// a named argument, which is common, idiomatic OpenSCAD.
export function capFnForDraft(code: string, maxFn: number): string {
  return code.replace(/\$fn\s*=\s*(\d+(?:\.\d+)?)/g, (_match, value) => {
    const capped = Math.min(Math.round(Number(value)), maxFn);
    return `$fn=${capped}`;
  });
}

const SCENE_MARKER_RE = /^\s*\/\/\s*=*\s*SCENE PARTS\s*=*\s*$/im;

export interface SceneSplit {
  defs: string;
  parts: string[];
}

export function splitSceneParts(code: string): SceneSplit | null {
  const match = code.match(SCENE_MARKER_RE);
  if (!match) return null;

  const idx = match.index!;
  const defs = code.slice(0, idx);
  const partsSection = code.slice(idx + match[0].length);
  const parts = partsSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

  if (parts.length < 2) return null;
  return { defs, parts };
}

const STL_HEADER_SIZE = 80;
const STL_TRIANGLE_SIZE = 50; // 12 floats (normal + 3 verts) + 2-byte attribute

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  add(x: number): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
}

/** Browser port of server/src/lib/meshAnalysis.js — see there for the
 *  algorithm rationale and the "hollow cavity legitimately reports 2+" caveat. */
export function countConnectedComponents(stl: Uint8Array): number {
  if (stl.length < STL_HEADER_SIZE + 4) return 1;

  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const triCount = dv.getUint32(STL_HEADER_SIZE, true);
  const expectedSize = STL_HEADER_SIZE + 4 + triCount * STL_TRIANGLE_SIZE;
  if (triCount === 0 || expectedSize > stl.length) return 1;

  const uf = new UnionFind();
  const vertexIds = new Map<string, number>();
  const idFor = (x: number, y: number, z: number): number => {
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertexIds.size;
      vertexIds.set(key, id);
      uf.add(id);
    }
    return id;
  };

  let offset = STL_HEADER_SIZE + 4;
  for (let i = 0; i < triCount; i++) {
    const ax = dv.getFloat32(offset + 12, true);
    const ay = dv.getFloat32(offset + 16, true);
    const az = dv.getFloat32(offset + 20, true);
    const bx = dv.getFloat32(offset + 24, true);
    const by = dv.getFloat32(offset + 28, true);
    const bz = dv.getFloat32(offset + 32, true);
    const cx = dv.getFloat32(offset + 36, true);
    const cy = dv.getFloat32(offset + 40, true);
    const cz = dv.getFloat32(offset + 44, true);

    const a = idFor(ax, ay, az);
    const b = idFor(bx, by, bz);
    const c = idFor(cx, cy, cz);
    uf.union(a, b);
    uf.union(b, c);

    offset += STL_TRIANGLE_SIZE;
  }

  const roots = new Set<number>();
  for (const id of vertexIds.values()) roots.add(uf.find(id));
  return roots.size;
}

/** Browser port of server/src/lib/meshMerge.js's mergeBinarySTLs — valid only
 *  because scene parts are non-overlapping by construction (see splitSceneParts). */
export function mergeBinarySTLs(buffers: Uint8Array[]): Uint8Array {
  let totalTriangles = 0;
  const chunks: Uint8Array[] = [];

  for (const buf of buffers) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const count = dv.getUint32(STL_HEADER_SIZE, true);
    totalTriangles += count;
    const start = STL_HEADER_SIZE + 4;
    chunks.push(buf.subarray(start, start + count * STL_TRIANGLE_SIZE));
  }

  const out = new Uint8Array(STL_HEADER_SIZE + 4 + totalTriangles * STL_TRIANGLE_SIZE);
  new TextEncoder().encodeInto("text2scad merged scene STL", out);
  new DataView(out.buffer).setUint32(STL_HEADER_SIZE, totalTriangles, true);

  let offset = STL_HEADER_SIZE + 4;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
