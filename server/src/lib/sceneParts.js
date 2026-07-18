// A "scene" (a house + several trees + a dog + a shepherd, say) is really
// several independent objects with no boolean interaction between them. The
// model marks this explicitly with a comment line, followed by one
// self-contained top-level statement per line — which lets us render each
// part in its own (small, fast) CSG tree instead of one giant combined one.
//
// Matched by regex rather than an exact string: models reliably include the
// words "SCENE PARTS" but vary the decorative "=" padding around them (seen
// in practice: "// ===== SCENE PARTS =====" vs "// ===================== SCENE
// PARTS ====================="), and a strict substring match silently falls
// through to slow monolithic rendering the moment the padding differs.
const SCENE_MARKER_RE = /^\s*\/\/\s*=*\s*SCENE PARTS\s*=*\s*$/im;

/**
 * Splits `code` into shared definitions + a list of independent top-level
 * statements, if (and only if) the model used the scene-parts convention
 * with at least 2 parts. Returns null otherwise — callers should fall back
 * to normal single-file rendering.
 */
export function splitSceneParts(code) {
  const match = code.match(SCENE_MARKER_RE);
  if (!match) return null;

  const idx = match.index;
  const defs = code.slice(0, idx);
  const partsSection = code.slice(idx + match[0].length);
  const parts = partsSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

  if (parts.length < 2) return null;
  return { defs, parts };
}
