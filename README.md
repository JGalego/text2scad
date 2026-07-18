# text2scad

Chat with Claude to describe a 3D object in plain English, get back real OpenSCAD
source, and see it rendered live in an interactive 3D viewer. Ask for changes
("make the handle thicker", "add a hole through the base") and the model updates
in place.

## How it works

```
┌────────────┐  streamed chat   ┌──────────────┐   spawns    ┌──────────┐
│   React     │ ───────────────▶│   Express     │────────────▶│ openscad │
│   client    │◀──── SSE ────── │   server      │             │   CLI    │
│ (chat + 3D  │                 │ (Anthropic     │◀── STL ────│          │
│  viewer)    │◀── STL blob ────│  SDK + render) │             └──────────┘
└────────────┘                 └──────────────┘
```

- **Chat → code**: the client streams the full conversation to `POST /api/chat`,
  which forwards it to Claude with a system prompt that asks for a short
  explanation plus one complete ` ```scad ` code block per reply. The server
  streams the response back over Server-Sent Events so replies appear token by
  token, then extracts the code block once the reply finishes.
- **Code → 3D**: whenever a reply contains a code block, the client posts it to
  `POST /api/render`, which shells out to the real `openscad` CLI to produce a
  binary STL in a throwaway temp directory. The STL bytes come back as the
  response body and are parsed client-side with three.js's `STLLoader` and
  displayed with `@react-three/fiber` (orbit controls, lighting, grid).
- Because rendering uses the actual OpenSCAD binary (not a JS reimplementation),
  the full OpenSCAD language and its exact rendering behavior are supported.

### Realism checks

Raw LLM-generated CSG code is prone to a specific failure mode: geometry that's
syntactically valid and renders fine, but doesn't actually look like what was
asked for — a handle that's the wrong shape, a foot that doesn't quite reach
the ground. The model never sees a render of its own output, so it can't catch
this by construction. Three layers address it, roughly cheapest-first:

1. **Curated helper primitives** (`server/src/lib/helperLibrary.js`) — a small
   set of pre-verified modules (`rounded_box`, `capsule`, `tube`, `torus_arc`)
   prepended to every render, plus an explicit "overlap, don't just touch"
   rule in the system prompt — so attaching a protrusion to a body doesn't
   require hand-deriving fragile transform math from scratch each time.
2. **Mechanical connectivity check** (`server/src/lib/meshAnalysis.js`) — every
   render reports how many disconnected pieces the output mesh has (via
   union-find over shared vertices, returned as an `X-Component-Count`
   header). If a part is genuinely floating — not just touching — the client
   automatically sends the model a corrective follow-up (visible in the chat
   as a dashed "auto-check" turn) and re-renders, up to 2 attempts. Note this
   catches *disconnected* geometry specifically; it will not catch a part
   that's connected but shaped or oriented wrong — that's what the next layer
   catches. (OpenSCAD's own `Volumes:` summary line looks like it would serve
   this purpose but doesn't — it reports the same count for a valid one-piece
   hollow object as for two entirely separate ones. Don't parse it for this.)
3. **Visual critique** (`POST /api/critique`, "Check realism" button) — an
   opt-in pass that renders a PNG snapshot server-side and sends it to Claude
   with vision, asking it to judge the result and fix anything that looks
   wrong. This is the layer that actually catches proportion/orientation
   defects, since it's the only one that "looks" at the object rather than
   just its code or its raw mesh topology. Not automatic on every turn, since
   it adds a render + an extra model call. PNG export uses OpenSCAD's fast
   OpenCSG preview path (not the slow CGAL path STL export needs), so this
   stays cheap even for complex scenes — no quality tiering needed here.

### Rendering complex / multi-object scenes

STL export resolves every boolean operation exactly (CGAL) — cheap for one
object, but it scales very badly across a whole populated scene (a house plus
several trees plus animals), especially with `hull()`-heavy helpers. Measured
on a representative scene: **2m 5s** at the model's own detail level as one
combined render, **2.3s** with `$fn` capped low, and **~1s** end to end once
also decomposed into independently-rendered parts. Two mechanisms combine to
get there:

- **Draft vs. final quality** (`renderScadToStl(code, { quality })` in
  `openscadRenderer.js`) — every chat-turn render uses `quality: "draft"`,
  which caps `$fn` down (`DRAFT_FN`, default 8) for a fast interactive preview.
  This has to be a text-level substitution over literal `$fn=N` occurrences,
  not just an OpenSCAD `-D` CLI override — a per-call `$fn` argument (e.g.
  `sphere(r, $fn=24)`, which is normal, idiomatic OpenSCAD and exactly what
  the system prompt's own detail-budgeting advice encourages) always shadows
  a CLI default, so the override alone silently does nothing on code that
  sets detail per-primitive. "Download .scad/.stl" trigger a fresh
  `quality: "final"` render on demand (full detail, longer timeout) rather
  than reusing the draft buffer.
- **Scene decomposition** (`sceneParts.js` + `meshMerge.js`) — the system
  prompt asks the model to mark a scene's independent top-level objects with
  a `// ===== SCENE PARTS =====`-style comment (matched by regex, tolerant of
  the model's decorative padding varying) followed by one self-contained
  statement per line. Each part then renders in its own temp file, in
  parallel (`SCENE_PART_CONCURRENCY`, default 4), and the resulting STLs are
  concatenated directly — no CGAL boolean needed, since non-overlapping parts
  can just have their triangle lists merged. The realism auto-fix (above)
  skips its disconnected-component check for these renders, since multiple
  components is the correct, expected topology for a scene, not a defect.

## Requirements

- Node.js 18+
- The [`openscad`](https://openscad.org/downloads.html) CLI installed and on `PATH`
- An Anthropic API key

## Setup

```bash
npm install                       # installs server + client workspaces
cp server/.env.example server/.env
# edit server/.env and set ANTHROPIC_API_KEY
```

## Run

```bash
npm run dev
```

This starts the Express API on `http://localhost:3001` and the Vite dev server
on `http://localhost:5173` (which proxies `/api/*` to the backend). Open
`http://localhost:5173` and start chatting.

## Project layout

```
server/                    Express API
  src/index.js               app entry point
  src/routes/chat.js          SSE streaming chat endpoint (Anthropic)
  src/routes/render.js        STL render endpoint (openscad CLI)
  src/routes/critique.js      PNG snapshot + vision critique endpoint
  src/lib/anthropic.js        Anthropic client
  src/lib/systemPrompt.js     system prompt + code-block extraction
  src/lib/openscadRenderer.js STL/PNG rendering via the openscad CLI
  src/lib/helperLibrary.js    curated OpenSCAD helper modules
  src/lib/meshAnalysis.js     STL connected-component check
  src/lib/sceneParts.js       SCENE PARTS marker detection/split
  src/lib/meshMerge.js        STL concatenation + concurrency helper

client/                    React + Vite + TypeScript frontend
  src/App.tsx                 layout, chat/render orchestration, auto-fix loop
  src/api/client.ts           SSE chat client, render + critique fetch helpers
  src/components/             chat bubbles, input, three.js viewer
```

## Configuration

Environment variables (`server/.env`, see `server/.env.example`):

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `CHAT_MODEL` | `claude-sonnet-5` | model used to generate/refine OpenSCAD code |
| `PORT` | `3001` | Express server port |
| `OPENSCAD_BIN` | `openscad` | path to the OpenSCAD binary |
| `RENDER_TIMEOUT_MS` | `20000` | kills a "draft" quality render that takes longer than this |
| `RENDER_TIMEOUT_MS_FINAL` | `90000` | kills a "final" quality render (on-demand, e.g. downloads) |
| `DRAFT_FN` | `8` | `$fn` cap applied to draft-quality renders |
| `SCENE_PART_CONCURRENCY` | `4` | how many SCENE PARTS to render in parallel |

Client (`client/.env`, see `client/.env.example`): only needed if you change
the server's `PORT` — set `VITE_BACKEND_PORT` to the same value, since the dev
server proxies `/api/*` to it. The dev server also now uses `strictPort`, so
if `5173` is taken it fails loudly instead of silently moving to another port.

## Notes / limitations

- The backend is stateless — the full chat history is sent with every request,
  so conversation state lives in the browser only (lost on refresh).
- Generated code is restricted (via the system prompt) to core OpenSCAD, since
  `include`/`use` of external libraries (MCAD, BOSL2, fonts) isn't available in
  the render sandbox.
- Each render runs in its own temp directory with a hard timeout, but the
  `openscad` process still executes arbitrary submitted OpenSCAD source, so
  don't expose this server to untrusted users without adding sandboxing
  (containers, seccomp, resource limits) in front of it.
