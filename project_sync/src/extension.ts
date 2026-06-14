import {
  initialize,
  AudioClip,
  AudioTrack,
  Track,
  CuePoint,
  GridQuantization,
  WarpMode,
  type ActivationContext,
  type ContextMenuScope,
  type ExtensionContext,
} from "@ableton-extensions/sdk";

import { writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import dialogHtml from "./project-sync.html";

type ApiVersion = "1.0.0";

// Every scope listed in the SDK's ContextMenuScope union, so the action
// shows up on any right-clickable surface in Live (tracks, clips, slots,
// scenes, racks, samples, simpler instances, and arrangement/clip-slot
// selections). See api/types/ContextMenuScope.html.
const SCOPES: ContextMenuScope<ApiVersion>[] = [
  "AudioClip",
  "AudioTrack",
  "ClipSlot",
  "DrumRack",
  "MidiClip",
  "MidiTrack",
  "Sample",
  "Scene",
  "Simpler",
  "ClipSlotSelection",
  "AudioTrack.ArrangementSelection",
  "MidiTrack.ArrangementSelection",
];

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("projectSync.inspect", () => {
    void inspectProject(context).catch((e) => {
      console.error("[ProjectSync] failed:", e);
    });
  });

  for (const scope of SCOPES) {
    context.ui.registerContextMenuAction(
      scope,
      "Project Sync: Inspect arrangement…",
      "projectSync.inspect",
    );
  }
}

async function inspectProject(
  context: ExtensionContext<ApiVersion>,
): Promise<void> {
  const snapshot = (await context.ui.withinProgressDialog(
    "Project Sync — gathering arrangement…",
    { progress: 0 },
    async (update, signal) => {
      return await collectSnapshot(context, update, signal);
    },
  )) as Snapshot | null;

  if (!snapshot) return;

  const savedPath = await dumpJson(context, snapshot);

  const html = dialogHtml
    .replace("__API__", escapeHtml("1.0.0"))
    .replace("__TS__", escapeHtml(new Date().toISOString()))
    .replace("__SAVED_PATH__", escapeHtml(savedPath ?? "(could not write file)"))
    .replace("__COUNTS__", renderCountsHtml(snapshot))
    .replace("__ARRANGEMENT__", renderArrangementHtml(snapshot))
    .replace("__TREE__", renderTreeHtml(snapshot));

  await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(html)}`,
    820,
    640,
  );
}

// ---------------------------------------------------------------------------
// Snapshot model — arrangement + audio clips only
// ---------------------------------------------------------------------------

interface Snapshot {
  song: SongInfo;
  audioTracks: AudioTrackInfo[];
  totals: {
    audioTrackCount: number;
    arrangementClipCount: number;
    takeLaneClipCount: number;
  };
}

interface SongInfo {
  tempo: number;
  gridQuantization: { value: number; label: string; isTriplet: boolean };
  scale: {
    rootNote: number;
    rootNoteName: string;
    name: string;
    mode: boolean;
    intervals: number[];
  };
  cuePoints: CuePointInfo[];
}

interface AudioTrackInfo {
  name: string;
  mute: boolean;
  solo: boolean;
  arm: boolean;
  mutedViaSolo: boolean;
  groupTrackName: string | null;
  arrangementClips: AudioClipInfo[];
  takeLanes: TakeLaneInfo[];
}

interface TakeLaneInfo {
  name: string;
  clips: AudioClipInfo[];
}

interface AudioClipInfo {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  startMarker: number;
  endMarker: number;
  looping: boolean;
  loopStart: number;
  loopEnd: number;
  color: number;
  colorHex: string;
  muted: boolean;
  filePath: string;
  warping: boolean;
  warpMode: { value: number; name: string };
  warpMarkerCount: number;
}

interface CuePointInfo {
  name: string;
  time: number;
}

// ---------------------------------------------------------------------------
// Walkers
// ---------------------------------------------------------------------------

type Progress = (text: string, percent?: number) => Promise<void>;

async function collectSnapshot(
  context: ExtensionContext<ApiVersion>,
  update: Progress,
  signal: AbortSignal,
): Promise<Snapshot | null> {
  await update("Reading song properties…", 2);
  const song = context.application.song;

  // Audio tracks only — arrangement clips live on tracks, and we're scoped to audio.
  const audioTracks = song.tracks.filter(
    (t): t is AudioTrack<ApiVersion> => t instanceof AudioTrack,
  );

  const tracks: AudioTrackInfo[] = [];
  let arrangementClipCount = 0;
  let takeLaneClipCount = 0;

  for (let i = 0; i < audioTracks.length; i++) {
    if (signal.aborted) return null;
    const t = audioTracks[i]!;
    await update(
      `Track ${i + 1}/${audioTracks.length} · "${safeName(t)}"`,
      progressFor(i, audioTracks.length, 5, 95),
    );
    const info = collectAudioTrack(t);
    arrangementClipCount += info.arrangementClips.length;
    for (const lane of info.takeLanes) takeLaneClipCount += lane.clips.length;
    tracks.push(info);
  }

  await update("Cue points…", 98);
  const cuePoints = song.cuePoints.map(collectCuePoint);

  await update("Done.", 100);

  return {
    song: {
      tempo: num(song.tempo),
      gridQuantization: {
        value: num(song.gridQuantization),
        label: gridQuantizationName(song.gridQuantization),
        isTriplet: song.gridIsTriplet,
      },
      scale: {
        rootNote: num(song.rootNote),
        rootNoteName: noteName(num(song.rootNote)),
        name: song.scaleName,
        mode: song.scaleMode,
        intervals: song.scaleIntervals.map(num),
      },
      cuePoints,
    },
    audioTracks: tracks,
    totals: {
      audioTrackCount: tracks.length,
      arrangementClipCount,
      takeLaneClipCount,
    },
  };
}

function collectAudioTrack(t: AudioTrack<ApiVersion>): AudioTrackInfo {
  const group = t.groupTrack;

  const arrangementClips: AudioClipInfo[] = [];
  for (const clip of t.arrangementClips) {
    if (clip instanceof AudioClip) arrangementClips.push(collectAudioClip(clip));
  }

  const takeLanes: TakeLaneInfo[] = t.takeLanes.map((lane) => ({
    name: lane.name,
    clips: lane.clips
      .filter((c): c is AudioClip<ApiVersion> => c instanceof AudioClip)
      .map(collectAudioClip),
  }));

  return {
    name: safeName(t),
    mute: t.mute,
    solo: t.solo,
    arm: t.arm,
    mutedViaSolo: t.mutedViaSolo,
    groupTrackName: group ? safeName(group) : null,
    arrangementClips,
    takeLanes,
  };
}

function collectAudioClip(clip: AudioClip<ApiVersion>): AudioClipInfo {
  const colorNum = num(clip.color);
  const mode = num(clip.warpMode);
  return {
    name: clip.name,
    startTime: num(clip.startTime),
    endTime: num(clip.endTime),
    duration: num(clip.duration),
    startMarker: num(clip.startMarker),
    endMarker: num(clip.endMarker),
    looping: clip.looping,
    loopStart: num(clip.loopStart),
    loopEnd: num(clip.loopEnd),
    color: colorNum,
    colorHex: `#${(colorNum & 0xffffff).toString(16).padStart(6, "0")}`,
    muted: clip.muted,
    filePath: clip.filePath,
    warping: clip.warping,
    warpMode: { value: mode, name: warpModeName(mode) },
    warpMarkerCount: clip.warpMarkers.length,
  };
}

function collectCuePoint(cp: CuePoint<ApiVersion>): CuePointInfo {
  return { name: cp.name, time: num(cp.time) };
}

// ---------------------------------------------------------------------------
// JSON dump
// ---------------------------------------------------------------------------

async function dumpJson(
  context: ExtensionContext<ApiVersion>,
  snapshot: Snapshot,
): Promise<string | null> {
  // Strategy: write the JSON to a scratch path we control, then ask Live's
  // Resources API to import it into the current project folder. That gives us
  // a stable, user-discoverable location (sitting next to the .als) instead of
  // a hidden temp dir.
  const scratchDir =
    context.environment.tempDirectory ??
    context.environment.storageDirectory ??
    path.join(os.tmpdir(), "project-sync");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scratchFile = path.join(scratchDir, `project-sync-${stamp}.json`);
  const payload = {
    generatedAt: new Date().toISOString(),
    hostApiVersion: "1.0.0",
    snapshot,
  };

  try {
    await mkdir(scratchDir, { recursive: true });
    await writeFile(scratchFile, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.error("[ProjectSync] failed to write scratch JSON:", e);
    return null;
  }

  // Hand the file to Live; it copies it into the Set's project folder and
  // returns the imported path. Falls back to the scratch path if the import
  // fails (e.g. an unsaved Set with no project folder yet).
  try {
    const imported = await context.resources.importIntoProject(scratchFile);
    console.log(`[ProjectSync] imported snapshot into project: ${imported}`);
    return imported;
  } catch (e) {
    console.warn(
      "[ProjectSync] importIntoProject failed; leaving file at scratch path:",
      e,
    );
    return scratchFile;
  }
}

// ---------------------------------------------------------------------------
// HTML rendering (server-side)
// ---------------------------------------------------------------------------

const EXPANDED_KEYS = new Set([
  "song",
  "audioTracks",
  "scale",
  "gridQuantization",
  "cuePoints",
  "totals",
]);

function renderCountsHtml(s: Snapshot): string {
  const stats: Array<[string, string]> = [
    ["Tempo", `${s.song.tempo.toFixed(2)} BPM`],
    ["Audio tracks", String(s.totals.audioTrackCount)],
    ["Arr. clips", String(s.totals.arrangementClipCount)],
    ["Take clips", String(s.totals.takeLaneClipCount)],
    ["Cue pts", String(s.song.cuePoints.length)],
    [
      "Scale",
      `${s.song.scale.rootNoteName} ${s.song.scale.name} (${s.song.scale.mode ? "on" : "off"})`,
    ],
    [
      "Grid",
      `${s.song.gridQuantization.label}${s.song.gridQuantization.isTriplet ? " · T" : ""}`,
    ],
  ];
  return stats
    .map(
      ([k, v]) =>
        `<div class="chip"><span class="chip-k">${escapeHtml(k)}</span><span class="chip-v">${escapeHtml(v)}</span></div>`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Arrangement view — pre-rendered timeline
// ---------------------------------------------------------------------------

function renderArrangementHtml(s: Snapshot): string {
  // Find the rightmost beat we need to show. Everything is laid out in beat-
  // space; the client picks pixels/beat at runtime so it can fit the chart to
  // whatever width the dialog ends up at and respond to zoom + resize without
  // a re-render.
  let maxBeat = 16;
  for (const t of s.audioTracks) {
    for (const c of t.arrangementClips) if (c.endTime > maxBeat) maxBeat = c.endTime;
    for (const lane of t.takeLanes) {
      for (const c of lane.clips) if (c.endTime > maxBeat) maxBeat = c.endTime;
    }
  }
  for (const cp of s.song.cuePoints) if (cp.time > maxBeat) maxBeat = cp.time;
  maxBeat = Math.ceil(maxBeat / 4) * 4; // round up to next bar (4/4 assumed)

  // Beat ruler — minor tick every beat, major + bar number every 4 beats.
  const rulerTicks: string[] = [];
  for (let b = 0; b <= maxBeat; b++) {
    const isBar = b % 4 === 0;
    rulerTicks.push(
      `<div class="tick ${isBar ? "bar" : "beat"}" style="--at:${b}"></div>`,
    );
    if (isBar) {
      rulerTicks.push(
        `<div class="bar-num" style="--at:${b}">${b / 4 + 1}</div>`,
      );
    }
  }

  const cueLines = s.song.cuePoints
    .map((cp, i) => {
      return (
        `<div class="cue-line" style="--at:${cp.time}"></div>` +
        `<div class="cue-label" style="--at:${cp.time};top:${i % 2 === 0 ? 0 : 12}px">${escapeHtml(cp.name || "·")}</div>`
      );
    })
    .join("");

  const trackLanes = s.audioTracks.map(renderTrackLane).join("");

  // `--total-beats` and `--px-per-beat` flow into every position calc below.
  // The client sets --px-per-beat on load + on zoom + on resize.
  return `
    <div class="arr-wrap" data-total-beats="${maxBeat}" style="--total-beats:${maxBeat}; --px-per-beat:6px">
      <div class="arr-toolbar">
        <button class="alx-button small" id="arrZoomOut" title="Zoom out">−</button>
        <button class="alx-button small" id="arrZoomFit" title="Fit to window">Fit</button>
        <button class="alx-button small" id="arrZoomIn" title="Zoom in">+</button>
        <span class="arr-zoom-display" id="arrZoomDisplay">—</span>
        <div class="spacer"></div>
        <span class="arr-summary">${s.audioTracks.length} tracks · ${s.totals.arrangementClipCount} clips · ${s.totals.takeLaneClipCount} take clips · ${maxBeat / 4} bars @ 4/4</span>
      </div>
      <div class="arr-scroll" id="arrScroll">
        <div class="arr-ruler">${rulerTicks.join("")}</div>
        <div class="arr-cues">${cueLines}</div>
        <div class="arr-tracks">${trackLanes}</div>
      </div>
    </div>
  `;
}

function renderTrackLane(t: AudioTrackInfo): string {
  const trackClips = t.arrangementClips
    .map((c) => renderClipBar(c, "arr"))
    .join("");

  const takeLanes = t.takeLanes
    .filter((l) => l.clips.length > 0)
    .map((lane) => {
      const clips = lane.clips.map((c) => renderClipBar(c, "take")).join("");
      return `
        <div class="lane take-lane">
          <div class="lane-label sub">↳ ${escapeHtml(lane.name || "take")}</div>
          <div class="lane-clips">${clips}</div>
        </div>`;
    })
    .join("");

  const flagBits: string[] = [];
  if (t.mute) flagBits.push(`<span class="flag mute" title="Muted">M</span>`);
  if (t.solo) flagBits.push(`<span class="flag solo" title="Solo">S</span>`);
  if (t.arm)  flagBits.push(`<span class="flag arm"  title="Armed">●</span>`);
  if (t.mutedViaSolo) flagBits.push(`<span class="flag dim" title="Muted via solo">m</span>`);
  const flags = flagBits.join("");

  return `
    <div class="lane">
      <div class="lane-label">
        <span class="track-name">${escapeHtml(t.name)}</span>
        <span class="flags">${flags}</span>
      </div>
      <div class="lane-clips">${trackClips}</div>
    </div>
    ${takeLanes}
  `;
}

function renderClipBar(c: AudioClipInfo, variant: "arr" | "take"): string {
  const start = c.startTime;
  const span = Math.max(0.001, c.endTime - c.startTime);

  let loopOverlay = "";
  if (c.looping) {
    const loopX = c.loopStart - c.startTime;
    const loopW = Math.max(0.001, c.loopEnd - c.loopStart);
    loopOverlay = `<div class="loop" style="--lx:${loopX};--lw:${loopW}"></div>`;
  }

  const tip = [
    c.name || "(unnamed)",
    `start ${c.startTime.toFixed(2)} → end ${c.endTime.toFixed(2)}  (${span.toFixed(2)} beats)`,
    c.looping ? `loop ${c.loopStart.toFixed(2)}–${c.loopEnd.toFixed(2)}` : "no loop",
    `warp: ${c.warping ? c.warpMode.name : "off"}`,
    c.filePath,
  ].join("\n");

  const label = `<span class="clip-label">${escapeHtml(c.name || basename(c.filePath))}</span>`;
  return (
    `<div class="clip ${variant}${c.muted ? " muted" : ""}" ` +
    `style="--start:${start};--span:${span};background:${escapeHtml(c.colorHex)}" ` +
    `title="${escapeHtml(tip)}">${loopOverlay}${label}</div>`
  );
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function renderTreeHtml(s: Snapshot): string {
  return `<ul class="children">${renderNode("snapshot", s as unknown, 0)}</ul>`;
}

function renderNode(
  key: string | null,
  value: unknown,
  depth: number,
): string {
  const composite = isObjectLike(value) || Array.isArray(value);
  const expanded = depth === 0 || (key !== null && EXPANDED_KEYS.has(key));
  const toggleChar = composite ? (expanded ? "▾" : "▸") : " ";
  const keyMarkup =
    key !== null && key !== undefined
      ? `<span class="k">${escapeHtml(String(key))}</span><span class="sep">:</span>`
      : "";

  const valSummary = summaryHtml(value);
  const extras = extraMarkup(key, value);

  let childrenHtml = "";
  if (composite) {
    const childCls = `children${expanded ? "" : " collapsed"}`;
    const inner = Array.isArray(value)
      ? value
          .map((item, i) =>
            renderNode(labelForArrayItem(item, i), item, depth + 1),
          )
          .join("")
      : Object.entries(value as Record<string, unknown>)
          .map(([k, v]) => renderNode(k, v, depth + 1))
          .join("");
    childrenHtml = `<ul class="${childCls}">${inner}</ul>`;
  }

  return (
    `<li class="node" data-depth="${depth}">` +
    `<div class="row"><span class="toggle">${toggleChar}</span>` +
    keyMarkup +
    `<span class="v ${typeClass(value)}">${valSummary}</span>${extras}</div>` +
    childrenHtml +
    `</li>`
  );
}

function labelForArrayItem(item: unknown, i: number): string {
  if (isObjectLike(item)) {
    const o = item as Record<string, unknown>;
    if (typeof o.name === "string" && o.name) return `[${i}] ${o.name}`;
  }
  return `[${i}]`;
}

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeClass(v: unknown): string {
  if (v === null) return "v-null";
  if (Array.isArray(v)) return "v-array";
  if (isObjectLike(v)) return "v-object";
  if (typeof v === "string") return "v-string";
  if (typeof v === "number" || typeof v === "bigint") return "v-number";
  if (typeof v === "boolean") return "v-bool";
  return "v-other";
}

function summaryHtml(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return escapeHtml(`[ ${v.length} ]`);
  if (isObjectLike(v)) {
    const keys = Object.keys(v);
    const preview = keys.slice(0, 3).join(", ");
    return escapeHtml(
      keys.length > 3
        ? `{ ${preview}, … (${keys.length}) }`
        : `{ ${preview} }`,
    );
  }
  if (typeof v === "string") {
    const s = v.length > 80 ? v.slice(0, 80) + "…" : v;
    return escapeHtml(JSON.stringify(s));
  }
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof v === "bigint") return `${v.toString()}n`;
  return escapeHtml(String(v));
}

function extraMarkup(key: string | null, value: unknown): string {
  if (key === "color" && typeof value === "number") {
    const hex = `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
    return `<span class="swatch" style="background:${hex}" title="${hex}"></span>`;
  }
  if (key === "colorHex" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return `<span class="swatch" style="background:${value}" title="${escapeHtml(value)}"></span>`;
  }
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeName(t: Track<ApiVersion>): string {
  try { return t.name; } catch { return "(unnamed)"; }
}

function num(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v;
}

function progressFor(i: number, total: number, lo: number, hi: number): number {
  if (total <= 0) return hi;
  const t = (i + 1) / total;
  return Math.round(lo + (hi - lo) * t);
}

function gridQuantizationName(g: GridQuantization): string {
  switch (g) {
    case GridQuantization.NoGrid: return "No grid";
    case GridQuantization.EightBars: return "8 bars";
    case GridQuantization.FourBars: return "4 bars";
    case GridQuantization.TwoBars: return "2 bars";
    case GridQuantization.Bar: return "1 bar";
    case GridQuantization.Half: return "1/2";
    case GridQuantization.Quarter: return "1/4";
    case GridQuantization.Eighth: return "1/8";
    case GridQuantization.Sixteenth: return "1/16";
    case GridQuantization.ThirtySecond: return "1/32";
  }
}

function warpModeName(m: WarpMode): string {
  switch (m) {
    case WarpMode.Beats: return "Beats";
    case WarpMode.Tones: return "Tones";
    case WarpMode.Texture: return "Texture";
    case WarpMode.Repitch: return "Re-Pitch";
    case WarpMode.Complex: return "Complex";
    case WarpMode.ComplexPro: return "Complex Pro";
    default: return `Unknown(${m as number})`;
  }
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n: number): string {
  if (n < 0 || n > 11) return String(n);
  return NOTE_NAMES[n]!;
}
