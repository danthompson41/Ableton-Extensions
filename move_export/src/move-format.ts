// ---------------------------------------------------------------------------
// Ableton Move project ("Set") format
// ---------------------------------------------------------------------------
//
// A Move Set on the device is a *folder* (shared as a `.ablbundle`, which is
// just a zip of that folder). The folder contains:
//
//   <Set Name>/
//   ├── Song.abl          JSON document describing the whole set (this file)
//   └── Samples/          every audio file the set references, by name
//
// The structure below is grounded in **real** Move Sets — the `.abl` examples
// in charlesvestal/extending-move (`examples/Sets/*.abl`) plus the drumRack /
// drumCell device shape from `move_tools/resources/Preset.ablpreset`. Verified
// facts:
//   - schema is `…/schema/song/1.5.1/song.json`
//   - a Set has exactly 4 tracks; observed Sets carry 8 scenes (= 8 clipSlots
//     per track)
//   - `scale` is a string name (e.g. "Phrygian"); `rootNote` is a separate int
//   - tracks are `kind: "midi" | "audio"` — "drum-ness" is implied by a
//     drumRack in the device chain, not the track kind
//   - clipSlots are `{ hasStop, clip }` wrappers; notes use `noteNumber` /
//     `offVelocity`; clips carry a `region` + `envelopes`
//
// Anything still unconfirmed is marked `TODO(verify)`:
//   - audio clips/tracks: Move 2.0 (2026) added them, but no real audio-track
//     `.abl` is available to verify the structure and the schema host isn't
//     reachable, so we DON'T fabricate one — audio tracks export as empty MIDI
//     placeholders (their samples are copied for manual re-import). See
//     convertTrack.
//   - master devices and grooveId semantics.
// Treat this module as the single owner of "what the Move JSON looks like" so
// the rest of the extension stays format-agnostic.
// ---------------------------------------------------------------------------

import type {
  LiveSnapshot,
  LiveTrack,
  LiveClip,
  LiveDrumPad,
} from "./snapshot.js";
import {
  defaultRackMacros,
  defaultDrumCellParameters,
  defaultMelodicSamplerParameters,
  defaultDriftParameters,
  defaultChainMixer,
  defaultRackChainMixer,
  type MoveChainMixer,
} from "./move-device-defaults.js";

/**
 * Schema URI stamped into the exported Song.abl. Bumped to 1.8.3 — the version
 * of the real audio-track Set we verified against — because audio clips don't
 * exist in earlier schemas. The MIDI/drum/melodic output is a structural subset
 * the device loads fine (it tolerates missing fields; see notes below).
 */
export const MOVE_SONG_SCHEMA =
  "http://tech.ableton.com/schema/song/1.8.3/song.json";

/** Move hardware has exactly 4 tracks; observed Sets use an 8-scene grid. */
export const MOVE_TRACK_COUNT = 4;
export const MOVE_DEFAULT_SCENES = 8;

export interface MoveTimeSignature {
  upper: number;
  lower: number;
}

// --- Top-level document ----------------------------------------------------

export interface MoveSong {
  $schema: string;
  stepEditorResolution: string;
  tempo: number;
  timeSignature: MoveTimeSignature;
  globalGrooveAmount: number;
  rootNote: number;
  scale: string;
  melodicLayout: string;
  tracks: MoveTrack[];
  returnTracks: unknown[];
  masterTrack: MoveMasterTrack;
  scenes: MoveScene[];
  grooves: unknown[];
  metadata: { usedFeatures: string[] };
}

export interface MoveScene {
  name: string;
  color: number | null;
}

export interface MoveMasterTrack {
  color: number;
  isSelected: boolean;
  // TODO(verify): real Sets carry a few master devices (limiter, etc.). An
  // empty chain may be rejected by a strict Move; revisit with a device round-trip.
  devices: MoveDevice[];
  mixer: { pan: number; volume: number };
}

// --- Tracks ----------------------------------------------------------------

export type MoveTrackKind = "midi" | "audio";

/** Fields common to both track kinds. */
interface MoveTrackBase {
  name: string;
  color: number;
  isSelected: boolean;
  clipSlots: MoveClipSlot[];
  devices: MoveDevice[];
  mixer: MoveTrackMixer;
}

/** A MIDI/instrument track — carries the note-repeat / octave UI state. */
export interface MoveMidiTrack extends MoveTrackBase {
  kind: "midi";
  isNoteRepeatOn: boolean;
  noteRepeatRate: string;
  noteRepeatArpeggio: { style: string };
  uiOctaveIndex: number;
  midiInputMode: string;
  midiOutputEndpoint: null;
}

/** An audio track — a slimmer shape (no MIDI-input/note-repeat fields). */
export interface MoveAudioTrack extends MoveTrackBase {
  kind: "audio";
}

export type MoveTrack = MoveMidiTrack | MoveAudioTrack;

export interface MoveClipSlot {
  hasStop: boolean;
  clip: MoveClip | null;
}

export interface MoveTrackMixer {
  pan: number;
  "solo-cue": boolean;
  speakerOn: boolean;
  volume: number;
  sends: unknown[];
}

// --- Devices (verified against real drumRack / drumCell) -------------------

export interface MoveDevice {
  presetUri: string | null;
  kind: string; // "instrumentRack" | "drumRack" | "drumCell" | ...
  name: string;
  parameters: Record<string, MoveParameter>;
  chains?: MoveChain[];
  /** Device-specific payload, e.g. a drumCell's `{ sampleUri }`. */
  deviceData?: Record<string, unknown>;
}

export interface MoveChain {
  name: string;
  color: number;
  devices: MoveDevice[];
  mixer?: MoveChainMixer;
  /** Present on Drum Rack pad chains: which note triggers the pad. */
  drumZoneSettings?: MoveDrumZoneSettings;
}

export interface MoveDrumZoneSettings {
  receivingNote: number;
  sendingNote: number;
  chokeGroup: number | null;
}

/** Parameters are either a bare scalar or an object with a custom mapping name. */
export type MoveParameter =
  | number
  | boolean
  | string
  | { value: number | boolean | string; customName?: string };

// --- Clips -----------------------------------------------------------------

export type MoveClip = MoveMidiClip | MoveAudioClip;

/** Fields common to MIDI and audio clips. */
interface MoveClipBase {
  name: string;
  color: number;
  isEnabled: boolean;
  timeSignature: MoveTimeSignature;
  region: MoveRegion;
  stepEditorScrollPosition: number;
  envelopes: unknown[];
}

/** A MIDI clip — its content is `notes`. */
export interface MoveMidiClip extends MoveClipBase {
  // TODO(verify): real Sets reference a groove (grooveId:1). Exported clips have
  // no groove; null is the natural "none".
  grooveId: number | null;
  notes: MoveNote[];
}

/**
 * An audio clip (Move 2.0) — verified against a real 1.8.3 Set. The sample is
 * referenced by a top-level `sampleUri` (unlike a drumCell's `deviceData`), and
 * the clip carries warp / gain / pitch state.
 */
export interface MoveAudioClip extends MoveClipBase {
  sampleUri: string;
  warping: MoveWarping;
  gain: number;
  transpose: number;
  detune: number;
}

export interface MoveWarping {
  markers: unknown[];
  tempoAfterLastMarker: number;
}

export interface MoveRegion {
  start: number;
  end: number;
  loop: { start: number; end: number; isEnabled: boolean };
}

export interface MoveNote {
  noteNumber: number;
  startTime: number; // beats, relative to clip start
  duration: number; // beats
  velocity: number; // 0..127 (real Sets store as float, e.g. 127.0)
  offVelocity: number;
}

// ---------------------------------------------------------------------------
// Conversion: Live snapshot  ->  Move Song
// ---------------------------------------------------------------------------

export interface ConvertResult {
  song: MoveSong;
  /** Absolute source paths of every sample that must be copied into Samples/. */
  sampleSources: string[];
  /** Non-fatal issues to surface to the user (unsupported features, clamping). */
  warnings: string[];
}

export function liveSetToMoveSong(
  snapshot: LiveSnapshot,
  setName: string,
): ConvertResult {
  const warnings: string[] = [];
  const sampleSources: string[] = [];

  // Move uses an 8-scene grid in every Set we've seen; never go below it, and
  // grow to fit a larger source Set.
  const sceneCount = Math.max(MOVE_DEFAULT_SCENES, snapshot.sceneCount);

  // Exactly 4 tracks: take the first 4, pad with empties if fewer.
  const sourceTracks = snapshot.tracks.slice(0, MOVE_TRACK_COUNT);
  if (snapshot.tracks.length > MOVE_TRACK_COUNT) {
    warnings.push(
      `Set has ${snapshot.tracks.length} tracks; Move supports ${MOVE_TRACK_COUNT}. ` +
        `Exporting the first ${MOVE_TRACK_COUNT}.`,
    );
  }

  const tracks: MoveTrack[] = [];
  for (let i = 0; i < MOVE_TRACK_COUNT; i++) {
    const src = sourceTracks[i];
    tracks.push(
      src
        ? convertTrack(src, sceneCount, snapshot.tempo, sampleSources, warnings)
        : emptyTrack(sceneCount),
    );
  }

  const scenes: MoveScene[] = Array.from({ length: sceneCount }, (_, i) => ({
    name: snapshot.sceneNames[i] ?? "",
    color: null,
  }));

  const song: MoveSong = {
    $schema: MOVE_SONG_SCHEMA,
    stepEditorResolution: "1/16",
    tempo: snapshot.tempo,
    timeSignature: { upper: 4, lower: 4 },
    globalGrooveAmount: 0.0,
    rootNote: snapshot.scale?.rootNote ?? 0,
    scale: snapshot.scale?.name || "Major",
    melodicLayout: "chromatic",
    tracks,
    returnTracks: [],
    masterTrack: emptyMasterTrack(),
    scenes,
    grooves: [],
    metadata: { usedFeatures: [] },
  };

  return { song, sampleSources, warnings };
}

function convertTrack(
  t: LiveTrack,
  sceneCount: number,
  tempo: number,
  sampleSources: string[],
  warnings: string[],
): MoveTrack {
  // Audio track → Move audio track with audio clips (verified against a real
  // 1.8.3 Set). No instrument device; effects are left for the user to add.
  if (t.kind === "audio") {
    const clipSlots: MoveClipSlot[] = Array.from(
      { length: sceneCount },
      (_, i) => {
        const c = t.clips[i] ?? null;
        return {
          hasStop: true,
          clip: c ? buildAudioClip(c, tempo, sampleSources, warnings) : null,
        };
      },
    );
    return { ...audioTrackShell(t.name, moveColorIndex(t.color)), clipSlots, devices: [] };
  }

  // MIDI/drum/melodic track.
  const clipSlots: MoveClipSlot[] = Array.from(
    { length: sceneCount },
    (_, i) => {
      const c = t.clips[i] ?? null;
      return { hasStop: true, clip: c ? convertMidiClip(c) : null };
    },
  );

  let devices: MoveDevice[] = [];
  if (t.kind === "drum") {
    devices = [buildDrumRackDevice(t.name, t.drumPads, sampleSources, warnings)];
  } else if (t.kind === "melodic") {
    if (t.instrumentSamplePath) {
      // Single-sample (Simpler) instrument → Move melodicSampler.
      devices = [
        buildMelodicSamplerDevice(t.name, t.instrumentSamplePath, sampleSources),
      ];
    } else {
      // A synth/VST (Drift, Wavetable, Operator, plug-in, …) — no faithful
      // parameter mapping yet. Clips still export; the track gets an empty
      // instrument rack for the user to fill in on Move.
      devices = [emptyInstrumentRack(t.name)];
      warnings.push(
        `Track "${t.name}": instrument isn't a single-sample player and wasn't ` +
          `translated; exported with notes only (add an instrument on Move).`,
      );
    }
  }
  return { ...midiTrackShell(t.name, moveColorIndex(t.color)), clipSlots, devices };
}

function convertMidiClip(c: LiveClip): MoveMidiClip {
  return {
    ...clipBase(c),
    grooveId: null,
    notes: c.notes.map((n) => ({
      noteNumber: n.pitch,
      startTime: n.startTime,
      duration: n.duration,
      velocity: n.velocity,
      offVelocity: 0.0,
    })),
  };
}

/**
 * Audio clip (Move 2.0). The sample is copied into Samples/ and referenced by a
 * top-level `sampleUri`. gain/transpose/detune default to neutral — the SDK
 * doesn't expose them — and warping carries the Set tempo so Move keeps the clip
 * in sync. See the real-Set notes on `MoveAudioClip`.
 */
function buildAudioClip(
  c: LiveClip,
  tempo: number,
  sampleSources: string[],
  warnings: string[],
): MoveAudioClip | null {
  if (!c.sampleSourcePath) {
    warnings.push(
      `Audio clip "${c.name || "(unnamed)"}" has no source file; skipped.`,
    );
    return null;
  }
  sampleSources.push(c.sampleSourcePath);
  return {
    ...clipBase(c),
    sampleUri: sampleUriFor(c.sampleSourcePath),
    warping: { markers: [], tempoAfterLastMarker: tempo },
    gain: 0.0,
    transpose: 0,
    detune: 0.0,
  };
}

/** The fields shared by every Move clip, derived from a LiveClip. */
function clipBase(c: LiveClip): MoveClipBase {
  const length = Math.max(0, c.length);
  return {
    name: c.name,
    color: moveColorIndex(c.color),
    isEnabled: true,
    timeSignature: { upper: 4, lower: 4 },
    region: {
      start: 0,
      end: length,
      loop: { start: 0, end: length, isEnabled: c.looping },
    },
    stepEditorScrollPosition: 0.0,
    envelopes: [],
  };
}

// ---------------------------------------------------------------------------
// Drum Rack:  instrumentRack ▸ chain ▸ drumRack ▸ one chain per pad ▸ drumCell
// Verified against examples/Sets/*.abl and Preset.ablpreset.
// ---------------------------------------------------------------------------

// A Move Drum Rack has exactly 16 pads, triggered by notes 36..51. (Verified:
// every real drumRack has 16 chains spanning these notes.) A drumRack with a
// different chain count is a document-invariant violation.
const MOVE_PAD_NOTES = Array.from({ length: 16 }, (_, i) => 36 + i);

function buildDrumRackDevice(
  trackName: string,
  pads: LiveDrumPad[],
  sampleSources: string[],
  warnings: string[],
): MoveDevice {
  // Place each Live pad on the Move grid: prefer its own note when it falls in
  // 36..51, then pack any out-of-range pads into the remaining free slots so
  // their samples aren't lost.
  const byNote = new Map<number, LiveDrumPad>();
  const leftover: LiveDrumPad[] = [];
  for (const pad of pads) {
    if (MOVE_PAD_NOTES.includes(pad.receivingNote) && !byNote.has(pad.receivingNote)) {
      byNote.set(pad.receivingNote, pad);
    } else {
      leftover.push(pad);
    }
  }
  if (leftover.length) {
    const free = MOVE_PAD_NOTES.filter((n) => !byNote.has(n)).length;
    if (leftover.length > free) {
      warnings.push(
        `Track "${trackName}": ${leftover.length - free} drum pad(s) didn't fit ` +
          `Move's 16-pad grid and were dropped.`,
      );
    }
  }

  // Pads whose instrument the SDK can't read (Drum Cell etc.) — flag them so
  // the silent pads are explained rather than mysterious.
  const unreadable = pads.filter((p) => p.unreadableInstrument).length;
  if (unreadable > 0) {
    warnings.push(
      `Track "${trackName}": ${unreadable} drum pad(s) use a device whose sample ` +
        `the Extensions SDK can't read (e.g. Drum Cell) — exported silent. Pads ` +
        `using Simpler export fine.`,
    );
  }

  const padChains: MoveChain[] = MOVE_PAD_NOTES.map((note) => {
    const pad = byNote.get(note) ?? leftover.shift() ?? null;

    let sampleUri: string | null = null;
    if (pad?.sampleSourcePath) {
      sampleSources.push(pad.sampleSourcePath);
      sampleUri = sampleUriFor(pad.sampleSourcePath);
    }
    const padName = pad?.name ?? "";

    const drumCell: MoveDevice = {
      presetUri: null,
      kind: "drumCell",
      name: padName,
      parameters: defaultDrumCellParameters(),
      deviceData: sampleUri ? { sampleUri } : {},
    };

    return {
      name: padName,
      color: 4,
      devices: [drumCell],
      mixer: defaultChainMixer(),
      drumZoneSettings: {
        receivingNote: note,
        sendingNote: 60,
        chokeGroup: null,
      },
    };
  });

  const drumRack: MoveDevice = {
    presetUri: null,
    kind: "drumRack",
    name: "",
    parameters: defaultRackMacros(),
    chains: padChains,
  };

  return {
    presetUri: null,
    kind: "instrumentRack",
    name: trackName,
    parameters: defaultRackMacros(),
    // Real Sets give the instrumentRack's chain a mixer (like the melodic one).
    chains: [
      { name: "", color: 4, devices: [drumRack], mixer: defaultRackChainMixer() },
    ],
  };
}

/**
 * `Samples/<url-encoded basename>` — must match the file name the writer copies
 * into Samples/ (it copies by basename). Spaces become %20, matching real Move
 * presets; encodeURIComponent leaves `-._~` and alphanumerics untouched.
 */
function sampleUriFor(sourcePath: string): string {
  return `Samples/${encodeURIComponent(basename(sourcePath))}`;
}

// ---------------------------------------------------------------------------
// Melodic Sampler:  instrumentRack ▸ chain ▸ melodicSampler
// Verified against examples/Track Presets/melodicSampler/*.ablpreset — the
// instrument sits directly in the rack chain (no per-pad nesting like drums).
// ---------------------------------------------------------------------------

function buildMelodicSamplerDevice(
  trackName: string,
  samplePath: string,
  sampleSources: string[],
): MoveDevice {
  sampleSources.push(samplePath);

  const sampler: MoveDevice = {
    presetUri: null,
    kind: "melodicSampler",
    name: trackName,
    parameters: defaultMelodicSamplerParameters(),
    deviceData: { sampleUri: sampleUriFor(samplePath) },
  };

  return {
    presetUri: null,
    kind: "instrumentRack",
    name: trackName,
    parameters: defaultRackMacros(),
    chains: [
      {
        name: "",
        color: 4,
        devices: [sampler],
        mixer: defaultRackChainMixer(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Track / master shells — the boilerplate fields every Move track carries.
// ---------------------------------------------------------------------------

const NO_SENDS_MIXER: MoveTrackMixer = {
  pan: 0.0,
  "solo-cue": false,
  speakerOn: true,
  volume: 0.0,
  sends: [],
};

function midiTrackShell(
  name: string,
  color: number,
): Omit<MoveMidiTrack, "clipSlots" | "devices"> {
  return {
    kind: "midi",
    name,
    color,
    isSelected: false,
    isNoteRepeatOn: false,
    noteRepeatRate: "1/16",
    noteRepeatArpeggio: { style: "chordRepeat" },
    uiOctaveIndex: 4,
    midiInputMode: "auto",
    midiOutputEndpoint: null,
    mixer: { ...NO_SENDS_MIXER },
  };
}

function audioTrackShell(
  name: string,
  color: number,
): Omit<MoveAudioTrack, "clipSlots" | "devices"> {
  return {
    kind: "audio",
    name,
    color,
    isSelected: false,
    mixer: { ...NO_SENDS_MIXER },
  };
}

function emptyTrack(sceneCount: number): MoveTrack {
  return {
    ...midiTrackShell("", 0),
    clipSlots: emptyClipSlots(sceneCount),
    // A MIDI track must have exactly one device (an instrumentRack).
    devices: [emptyInstrumentRack("")],
  };
}

/**
 * A stock instrumentRack for MIDI tracks with no translatable instrument. Move
 * requires every MIDI track to carry exactly one device, and that rack chain to
 * contain an instrument — so the chain holds a default Drift synth (needs no
 * sample).
 */
function emptyInstrumentRack(name: string): MoveDevice {
  const drift: MoveDevice = {
    presetUri: null,
    kind: "drift",
    name: "",
    parameters: defaultDriftParameters(),
    deviceData: {},
  };
  return {
    presetUri: null,
    kind: "instrumentRack",
    name,
    parameters: defaultRackMacros(),
    chains: [
      { name: "", color: 0, devices: [drift], mixer: defaultRackChainMixer() },
    ],
  };
}

function emptyClipSlots(sceneCount: number): MoveClipSlot[] {
  return Array.from({ length: sceneCount }, () => ({
    hasStop: true,
    clip: null,
  }));
}

function emptyMasterTrack(): MoveMasterTrack {
  return {
    color: 0,
    isSelected: false,
    devices: [],
    mixer: { pan: 0.0, volume: 0.0 },
  };
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

// ---------------------------------------------------------------------------
// Colors. Move uses a 26-entry palette index (0..25); the Live SDK hands us a
// packed 24-bit RGB int. Passing RGB straight through (e.g. 4047616) is a
// document-invariant violation. Map RGB to the nearest palette index. Values
// already in 0..25 are treated as palette indices and kept as-is.
// (Palette from extending-move core/pad_colors.py; index 0 = none/default.)
// ---------------------------------------------------------------------------
const MOVE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 25, 23], [255, 142, 12], [255, 98, 41], [255, 186, 115], [215, 74, 9],
  [231, 231, 127], [255, 233, 94], [192, 255, 112], [135, 255, 109], [93, 219, 32],
  [161, 206, 47], [106, 237, 196], [0, 206, 197], [0, 212, 198], [29, 247, 243],
  [113, 167, 231], [34, 133, 240], [125, 87, 229], [34, 171, 240], [150, 139, 233],
  [178, 139, 233], [223, 139, 233], [199, 90, 214], [247, 35, 141], [227, 95, 200],
]; // palette indices 1..25 in order

function moveColorIndex(color: number): number {
  if (Number.isInteger(color) && color >= 0 && color <= 25) return color;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  let best = 1;
  let bestDist = Infinity;
  for (let i = 0; i < MOVE_PALETTE.length; i++) {
    const [pr, pg, pb] = MOVE_PALETTE[i]!;
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i + 1; // palette array is 0-based for indices 1..25
    }
  }
  return best;
}
