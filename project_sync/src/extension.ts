import {
  initialize,
  AudioClip,
  AudioTrack,
  Track,
  Clip,
  CuePoint,
  GridQuantization,
  WarpMode,
  type ActivationContext,
  type ContextMenuScope,
  type ExtensionContext,
} from "@ableton-extensions/sdk";

import dialogHtml from "./project-sync.html";

type ApiVersion = "1.0.0";

const SCOPES: ContextMenuScope<ApiVersion>[] = [
  "Scene",
  "AudioTrack",
  "MidiTrack",
  "AudioClip",
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

  const html = dialogHtml
    .replace("__API__", escapeHtml("1.0.0"))
    .replace("__TS__", escapeHtml(new Date().toISOString()))
    .replace("__COUNTS__", renderCountsHtml(snapshot))
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
