import {
  initialize,
  AudioClip,
  WarpMode,
  type ActivationContext,
  type ClipLoopSettings,
  type ExtensionContext,
  type Handle,
} from "@ableton-extensions/sdk";

// The monome-styled config dialog. esbuild inlines this as a string (see build.ts).
import mlrDialog from "./mlr.html";

type ApiVersion = "1.0.0";

/** Live enforces a minimum loop length of one 16th note (0.25 beats). */
const MIN_SLICE_BEATS = 0.25;

// What pressing a slice does, in classic-MLR terms. Both modes loop — the SDK
// has no Follow Action API, so repeating is done with the clip loop brace, which
// loops indefinitely once the clip is launched.
type SliceMode =
  | "loop" // loop just that 1/N segment (monome "loop" feel)
  | "loopToEnd"; // loop from this slice to the end of the region (looping tail)

interface DialogResult {
  cancelled?: boolean;
  slices: number;
  mode: SliceMode;
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("mlr.slice", (arg: unknown) => {
    void sliceClip(context, arg as Handle).catch((e) => {
      console.error("[MLR] failed to slice clip:", e);
    });
  });

  // Entry point: right-click any audio clip in Session or Arrangement view.
  context.ui.registerContextMenuAction(
    "AudioClip",
    "MLR: Slice across grid…",
    "mlr.slice",
  );
}

async function sliceClip(
  context: ExtensionContext<ApiVersion>,
  handle: Handle,
): Promise<void> {
  const source = context.getObjectFromHandle(handle, AudioClip);

  const filePath = source.filePath;
  if (!filePath) {
    throw new Error("Source clip has no audio file path.");
  }

  // Figure out the region to chop. Prefer the loop brace when the clip loops,
  // otherwise the start/end markers, then fall back to the whole clip. All
  // positions are in beats on the sample's warped timeline, so they carry over
  // directly to the new clips (which point at the same file).
  const region = sourceRegion(source);
  if (!(region.length > 0)) {
    throw new Error(
      "Could not determine a region to slice. Make sure the clip is warped and has a non-empty loop or start/end region.",
    );
  }

  if (!source.warping) {
    console.warn(
      "[MLR] source clip is not warped; slice boundaries are derived from its beat markers and may not line up with the audio.",
    );
  }

  const maxSlices = Math.max(1, Math.floor(region.length / MIN_SLICE_BEATS));

  // Ask the performer how many slices and which playback mode.
  const dialog = await askForOptions(context, {
    name: source.name || "loop",
    regionBeats: region.length,
    maxSlices,
  });
  if (!dialog || dialog.cancelled) {
    return;
  }

  const sliceCount = clampSlices(dialog.slices, maxSlices);
  const sliceBeats = region.length / sliceCount;
  const baseName = source.name || "MLR";

  await context.ui.withinProgressDialog(
    `MLR — slicing “${baseName}” into ${sliceCount}…`,
    { progress: 0 },
    async (update, signal) => {
      // One Live track holds all the slices of this loop, one slice per scene.
      // Trigger them live from the Session grid (Push / Launchpad / keyboard).
      const song = context.application.song;
      const track = await song.createAudioTrack();
      track.name = `MLR · ${baseName}`;

      // Make sure there are at least `sliceCount` scenes to stack the slices in.
      await update("Preparing scenes…", 5);
      while (context.application.song.scenes.length < sliceCount) {
        if (signal.aborted) return;
        await song.createScene(-1);
      }

      const slots = track.clipSlots;
      for (let i = 0; i < sliceCount; i++) {
        if (signal.aborted) return;

        const segStart = region.start + i * sliceBeats;
        const loop: ClipLoopSettings =
          dialog.mode === "loop"
            ? {
                looping: true,
                startMarker: segStart,
                endMarker: segStart + sliceBeats,
                loopStart: segStart,
                loopEnd: segStart + sliceBeats,
              }
            : {
                // Loop the tail: from this slice to the end of the region, looping.
                looping: true,
                startMarker: segStart,
                endMarker: region.end,
                loopStart: segStart,
                loopEnd: region.end,
              };

        const slot = slots[i];
        if (!slot) continue;

        const clip = await slot.createAudioClip({
          filePath,
          isWarped: true,
          loopSettings: loop,
        });

        // Beat-faithful warp mode + a rainbow across the row, monome-LED style.
        clip.warpMode = WarpMode.Beats;
        clip.name = `${baseName} ${String(i + 1).padStart(2, "0")}`;
        clip.color = hueColor(i / sliceCount);

        await update(
          `Slicing… ${i + 1}/${sliceCount}`,
          5 + Math.round(((i + 1) / sliceCount) * 95),
        );
      }
    },
  );
}

interface Region {
  start: number;
  end: number;
  length: number;
}

function sourceRegion(source: AudioClip<ApiVersion>): Region {
  const candidates: Array<[number, number]> = [];
  if (source.looping) candidates.push([source.loopStart, source.loopEnd]);
  candidates.push([source.startMarker, source.endMarker]);
  candidates.push([0, source.duration]);

  for (const [start, end] of candidates) {
    if (end - start > 0) return { start, end, length: end - start };
  }
  const [start, end] = candidates[0]!;
  return { start, end, length: end - start };
}

function clampSlices(requested: number, max: number): number {
  const n = Math.floor(requested);
  if (!Number.isFinite(n) || n < 1) return Math.min(16, max);
  if (n > max) {
    console.warn(
      `[MLR] ${n} slices would be shorter than a 16th note; clamping to ${max}.`,
    );
    return max;
  }
  return n;
}

/** Maps a 0..1 position to an evenly-bright RGB int, for a rainbow row of clips. */
function hueColor(t: number): number {
  const h = t * 360;
  const s = 0.65;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}

async function askForOptions(
  context: ExtensionContext<ApiVersion>,
  info: { name: string; regionBeats: number; maxSlices: number },
): Promise<DialogResult | null> {
  const params = encodeURIComponent(JSON.stringify(info));
  const html = mlrDialog.replace("__MLR_INFO__", params);
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(html)}`,
    420,
    360,
  );
  try {
    return JSON.parse(raw) as DialogResult;
  } catch {
    return null;
  }
}
