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
server/            Express API
  src/index.js        app entry point
  src/routes/chat.js   SSE streaming chat endpoint (Anthropic)
  src/routes/render.js STL render endpoint (openscad CLI)
  src/lib/             Anthropic client, system prompt, openscad renderer

client/             React + Vite + TypeScript frontend
  src/App.tsx          layout, chat/render orchestration
  src/api/client.ts    SSE chat client + render fetch helper
  src/components/      chat bubbles, input, three.js viewer
```

## Configuration

Environment variables (`server/.env`, see `server/.env.example`):

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `CHAT_MODEL` | `claude-sonnet-5` | model used to generate/refine OpenSCAD code |
| `PORT` | `3001` | Express server port |
| `OPENSCAD_BIN` | `openscad` | path to the OpenSCAD binary |
| `RENDER_TIMEOUT_MS` | `20000` | kills a render that takes longer than this |

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
