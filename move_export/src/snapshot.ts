// ---------------------------------------------------------------------------
// Live snapshot — a neutral intermediate representation of the current Set.
// ---------------------------------------------------------------------------
//
// The Move converter (move-format.ts) consumes this, never the SDK directly.
// Keeping a plain-data layer in the middle means the SDK-walking code and the
// Move-format code can change independently, and the snapshot is trivially
// loggable/diffable while we reverse-engineer the target format.
//
// This mirrors the collection approach in ../project_sync/src/extension.ts, but
// is Session/scene oriented (Move is a clip launcher) rather than arrangement
// oriented: clips come from `track.clipSlots[i].clip`, indexed by scene.

import {
  AudioClip,
  AudioTrack,
  MidiClip,
  DrumRack,
  RackDevice,
  Simpler,
  type Clip,
  type Device,
  type Track,
  type ExtensionContext,
} from "@ableton-extensions/sdk";

type ApiVersion = "1.0.0";

export interface LiveSnapshot {
  tempo: number;
  sceneCount: number;
  sceneNames: string[];
  scale: LiveScale | null;
  locators: { name: string; time: number }[];
  tracks: LiveTrack[];
}

export interface LiveScale {
  rootNote: number;
  name: string;
  intervals: number[];
}

export interface LiveTrack {
  name: string;
  color: number;
  kind: "drum" | "melodic" | "audio";
  /** One entry per scene/clip-slot; null where the slot is empty. */
  clips: (LiveClip | null)[];
  /** Pad → sample map for drum tracks; empty otherwise. */
  drumPads: LiveDrumPad[];
  /**
   * For a melodic track playing a single sample (a Simpler), the absolute path
   * to that sample — maps onto a Move `melodicSampler`. Null for synths/VSTs we
   * can't translate, and for drum/audio tracks.
   */
  instrumentSamplePath: string | null;
}

export interface LiveDrumPad {
  /** MIDI note that triggers this pad (Move's drum grid starts at 36 = C1). */
  receivingNote: number;
  name: string;
  /** Absolute path to the pad's sample, if one is loaded (Simpler only). */
  sampleSourcePath: string | null;
  /**
   * Set to the instrument device's name when the pad HAS an instrument but its
   * sample can't be read — e.g. a Drum Cell, which the SDK exposes only as a
   * generic device with no sample accessor. Lets the exporter warn precisely
   * (and label the pad) instead of silently shipping it empty.
   */
  unreadableInstrument: string | null;
}

export interface LiveClip {
  name: string;
  /** Musical (loop) length in beats. */
  length: number;
  looping: boolean;
  color: number;
  notes: LiveNote[]; // empty for audio clips
  /** Absolute path to the source audio file for audio clips, else null. */
  sampleSourcePath: string | null;
}

export interface LiveNote {
  pitch: number;
  startTime: number; // beats, relative to clip start
  duration: number; // beats
  velocity: number; // 0..127
}

/** MIDI velocity Live uses when a note doesn't carry an explicit value. */
const DEFAULT_VELOCITY = 100;

export type Progress = (text: string, percent?: number) => Promise<void>;

export async function collectSnapshot(
  context: ExtensionContext<ApiVersion>,
  update: Progress,
  signal: AbortSignal,
): Promise<LiveSnapshot | null> {
  await update("Reading song…", 2);
  const song = context.application.song;

  const sceneNames = song.scenes.map((s, i) => s.name || `Scene ${i + 1}`);

  const tracks: LiveTrack[] = [];
  const allTracks = song.tracks;
  for (let i = 0; i < allTracks.length; i++) {
    if (signal.aborted) return null;
    const t = allTracks[i]!;
    await update(
      `Track ${i + 1}/${allTracks.length} · "${safeName(t)}"`,
      progressFor(i, allTracks.length, 5, 95),
    );
    tracks.push(collectTrack(t, song.scenes.length));
  }

  await update("Done.", 100);

  return {
    tempo: num(song.tempo),
    sceneCount: song.scenes.length,
    sceneNames,
    scale: {
      rootNote: num(song.rootNote),
      name: song.scaleName,
      intervals: song.scaleIntervals.map(num),
    },
    locators: song.cuePoints.map((cp) => ({
      name: cp.name,
      time: num(cp.time),
    })),
    tracks,
  };
}

function collectTrack(
  t: Track<ApiVersion>,
  sceneCount: number,
): LiveTrack {
  // Read clips in scene order so clips[i] lines up with scene i. A track may
  // report fewer clipSlots than there are scenes; pad the tail with nulls.
  const slots = t.clipSlots;
  const clips: (LiveClip | null)[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const slot = slots[i];
    const clip = slot ? slot.clip : null;
    clips.push(clip ? collectClip(clip) : null);
  }

  const isAudio = t instanceof AudioTrack;
  const rack = isAudio ? null : findDrumRack(t.devices);
  const kind = isAudio ? "audio" : rack ? "drum" : "melodic";

  return {
    name: safeName(t),
    color: colorOf(t),
    kind,
    clips,
    drumPads: rack ? collectDrumPads(rack) : [],
    // A melodic single-sample instrument (Simpler) → Move melodicSampler.
    instrumentSamplePath: kind === "melodic" ? findSamplePath(t.devices) : null,
  };
}

/** One pad per Drum Rack chain: its trigger note, name, and loaded sample. */
function collectDrumPads(rack: DrumRack<ApiVersion>): LiveDrumPad[] {
  return rack.chains.map((chain) => {
    const note = num(chain.receivingNote);
    const sample = findSamplePath(chain.devices);
    if (sample) {
      return {
        receivingNote: note,
        name: basename(sample),
        sampleSourcePath: sample,
        unreadableInstrument: null,
      };
    }
    // No Simpler sample — but is there an instrument we just can't read
    // (e.g. a Drum Cell)? Capture its name so we can label + warn.
    const instrName = firstDeviceName(chain.devices);
    return {
      receivingNote: note,
      name: instrName ?? `Pad ${note}`,
      sampleSourcePath: null,
      unreadableInstrument: instrName,
    };
  });
}

/** First sample path reachable in a chain (Simpler only; recurse racks). */
function findSamplePath(devices: Device<ApiVersion>[]): string | null {
  for (const d of devices) {
    if (d instanceof Simpler && d.sample) return d.sample.filePath;
    if (d instanceof RackDevice) {
      for (const chain of d.chains) {
        const found = findSamplePath(chain.devices);
        if (found) return found;
      }
    }
  }
  return null;
}

/** Name of the first instrument-ish device in a chain (recurses into racks). */
function firstDeviceName(devices: Device<ApiVersion>[]): string | null {
  for (const d of devices) {
    if (d instanceof RackDevice) {
      for (const chain of d.chains) {
        const n = firstDeviceName(chain.devices);
        if (n) return n;
      }
    } else {
      try {
        if (d.name) return d.name;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

export function collectClip(clip: Clip<ApiVersion>): LiveClip {
  const base = {
    name: clip.name,
    length: clipLength(clip),
    looping: clip.looping,
    color: num(clip.color),
  };

  if (clip instanceof AudioClip) {
    return { ...base, notes: [], sampleSourcePath: clip.filePath };
  }

  if (clip instanceof MidiClip) {
    const notes: LiveNote[] = clip.notes.map((n) => ({
      pitch: n.pitch,
      startTime: n.startTime,
      duration: n.duration,
      velocity: n.velocity ?? DEFAULT_VELOCITY,
    }));
    return { ...base, notes, sampleSourcePath: null };
  }

  // Unknown clip subtype — keep the musical envelope, drop the content.
  return { ...base, notes: [], sampleSourcePath: null };
}

/** Musical length of a session clip in beats: its loop span when looping. */
function clipLength(clip: Clip<ApiVersion>): number {
  return clip.looping
    ? Math.max(0, clip.loopEnd - clip.loopStart)
    : Math.max(0, clip.endMarker - clip.startMarker);
}

// --- track classification --------------------------------------------------

/**
 * The Drum Rack anywhere in a device tree (it may be nested inside an instrument
 * rack), or null if there isn't one. Presence of one makes a MIDI track a
 * "drum" track and is the source for its pad → sample map.
 */
function findDrumRack(
  devices: Device<ApiVersion>[],
): DrumRack<ApiVersion> | null {
  for (const d of devices) {
    if (d instanceof DrumRack) return d;
    if (d instanceof RackDevice) {
      for (const chain of d.chains) {
        const found = findDrumRack(chain.devices);
        if (found) return found;
      }
    }
  }
  return null;
}

// --- helpers ---------------------------------------------------------------

function safeName(t: Track<ApiVersion>): string {
  try {
    return t.name;
  } catch {
    return "(unnamed)";
  }
}

function colorOf(t: Track<ApiVersion>): number {
  try {
    // Tracks don't expose a color in this API version; clips do. Default 0.
    return num((t as unknown as { color?: number | bigint }).color ?? 0);
  } catch {
    return 0;
  }
}

function num(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function progressFor(i: number, total: number, lo: number, hi: number): number {
  if (total <= 0) return hi;
  const t = (i + 1) / total;
  return Math.round(lo + (hi - lo) * t);
}
