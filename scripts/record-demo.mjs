#!/usr/bin/env node
/**
 * Records the README's demo GIF (docs/assets/demo.gif) by driving the real
 * app end-to-end with Playwright — actual Anthropic + OpenSCAD calls, no
 * mocking — then encoding the capture down with ffmpeg.
 *
 * Requirements (not installed by default, since this is a one-off authoring
 * tool rather than something the app needs at runtime):
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   ffmpeg on PATH
 *
 * The app itself must already be running (npm run dev) at DEV_SERVER_URL
 * below, with a real ANTHROPIC_API_KEY configured, before you run this.
 *
 * Usage:
 *   node scripts/record-demo.mjs
 *
 * Edit the TURNS array to change what the demo shows.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_GIF = path.join(REPO_ROOT, "docs/assets/demo.gif");

const DEV_SERVER_URL = "http://localhost:5173";

// What the demo walks through. `send` types into the chat box and submits;
// `click` clicks a button by its visible accessible name; `orbit` drags the
// 3D viewer to show the model off. Each step waits for the turn it triggers
// (including any automatic disconnected-mesh correction round) to settle
// before moving on.
// orbit spanY defaults to 0: horizontal-only dragging just spins the camera
// around the model's vertical axis. OrbitControls has no polar-angle clamp,
// so any vertical component compounds across successive orbit() calls and
// tips the camera toward top-down, flattening a standing figure's silhouette.
const TURNS = [
  { kind: "send", text: "a monkey sitting on the back of a horse" },
  { kind: "orbit", spanX: 100, steps: 16 },
  { kind: "click", name: "Check realism" },
  { kind: "orbit", spanX: 80, steps: 14 },
  { kind: "send", text: "turn the horse into a dragon with wings, breathing fire" },
  { kind: "orbit", spanX: 120, steps: 20 },
];

// GIF encoding — tuned to keep the file a few MB despite a ~3min raw capture
// full of high-entropy content (code text, a rotating shaded mesh). GIF
// compresses flat/static frames well and busy/dithered ones very badly, so
// speeding up playback and dropping fps/colors matters more than resolution.
const SPEEDUP = 6; // playback speed multiplier applied before GIF encoding
const GIF_FPS = 7;
const GIF_WIDTH = 620;
const GIF_MAX_COLORS = 64;

async function waitForDone(page, timeout) {
  await page.waitForFunction(
    () => {
      const bubbles = document.querySelectorAll(".bubble-assistant");
      const last = bubbles[bubbles.length - 1];
      if (!last) return false;
      const stage = last.querySelector(".bubble-stage");
      return stage?.textContent === "Done";
    },
    undefined,
    { timeout }
  );
}

/** Waits for the current turn to finish, then gives the app a short window to
 *  kick off an automatic disconnected-mesh correction round (see App.tsx's
 *  MAX_AUTO_FIXES) and waits that out too, up to 2 rounds, so the camera
 *  doesn't move and the next message doesn't send mid-correction. */
async function waitForSettled(page, timeout = 150_000) {
  await waitForDone(page, timeout);
  for (let round = 0; round < 2; round++) {
    const countBefore = await page.locator(".bubble-assistant").count();
    let grew = false;
    try {
      await page.waitForFunction(
        (prev) => document.querySelectorAll(".bubble-assistant").length > prev,
        countBefore,
        { timeout: 4500 }
      );
      grew = true;
    } catch {
      grew = false;
    }
    if (!grew) break;
    await waitForDone(page, timeout);
  }
  await page.waitForTimeout(400);
}

async function sendMessage(page, text) {
  const textarea = page.locator(".chat-input textarea");
  await textarea.click();
  await textarea.pressSequentially(text, { delay: 24 });
  await page.waitForTimeout(350);
  await page.locator(".chat-input button").click();
  await waitForSettled(page);
}

async function clickButton(page, name) {
  await page.getByRole("button", { name }).click();
  await waitForSettled(page);
}

async function orbit(page, { spanX = 100, spanY = 0, steps = 16 } = {}) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - spanX / 2, cy);
  await page.mouse.down();
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(cx - spanX / 2 + (i * spanX) / steps, cy - (i * spanY) / steps, { steps: 3 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
}

async function record(videoDir) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();

  await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  for (const turn of TURNS) {
    if (turn.kind === "send") await sendMessage(page, turn.text);
    else if (turn.kind === "click") await clickButton(page, turn.name);
    else if (turn.kind === "orbit") await orbit(page, turn);
  }

  await context.close();
  await browser.close();
}

function encodeGif(webmPath, outputPath) {
  const paletteFile = path.join(path.dirname(webmPath), "palette.png");
  const filters = `setpts=PTS/${SPEEDUP},fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;

  execFileSync("ffmpeg", [
    "-y", "-i", webmPath,
    "-vf", `${filters},palettegen=stats_mode=diff:max_colors=${GIF_MAX_COLORS}`,
    "-update", "1", paletteFile,
  ]);

  execFileSync("ffmpeg", [
    "-y", "-i", webmPath, "-i", paletteFile,
    "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=none`,
    "-loop", "0", outputPath,
  ]);
}

const workDir = mkdtempSync(path.join(tmpdir(), "text2scad-demo-"));
try {
  console.log(`recording via Playwright (workdir: ${workDir})...`);
  await record(workDir);

  const { readdirSync } = await import("node:fs");
  const webm = readdirSync(workDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`no .webm found in ${workDir}`);

  console.log("encoding GIF with ffmpeg...");
  encodeGif(path.join(workDir, webm), OUTPUT_GIF);
  console.log(`wrote ${path.relative(REPO_ROOT, OUTPUT_GIF)}`);
} finally {
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
}
