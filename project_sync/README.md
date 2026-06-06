# Project Sync — Metadata Inspector

A read-only inspector that walks the current Live Set and shows **everything
the Extensions SDK exposes** in a collapsible tree.

Useful as:

- a quick reference while you're building your own extension (what does the SDK
  actually return for *my* set?), and
- a starting point — fork it as the data-collection half of a real "project
  sync" (export to file, post to a server, diff against a previous snapshot,
  etc.).

## What it shows

Walks `context.application.song` and every reachable SDK object:

- **Environment** — `storageDirectory`, `tempDirectory`, `language`.
- **Song** — `tempo`, `gridQuantization` (+ triplet flag, decoded label), scale
  (`rootNote`, `scaleName`, `scaleMode`, `scaleIntervals`), and counts.
- **Tracks** (regular, returns, main) — `name`, `mute`, `solo`, `arm`,
  `mutedViaSolo`, `groupTrack`, plus:
  - **Mixer** — `volume`, `panning`, every `send` (each with current value, min,
    max, default, quantization, value items).
  - **Devices** — recursive. For `RackDevice` / `DrumRack`, each chain (and
    each chain's mixer + devices). For `Simpler`, the loaded `sample.filePath`.
    Every device parameter is dumped with its **live value** (async-fetched).
  - **Clip slots** — every slot, with its clip if any.
  - **Take lanes** — name + clips.
  - **Arrangement clips** — full clip data.
- **Clips** — for audio clips: `filePath`, `warping`, decoded `warpMode`, warp
  marker count. For MIDI clips: every note (`pitch`, `startTime`, `duration`,
  `velocity`, …).
- **Scenes** — `name`, `tempo`, `signatureNumerator/Denominator`.
- **Cue points** — `name`, `time`.

Because device-parameter values are async, the dialog gathers behind a progress
bar; large sets with many devices take a moment.

## Usage

1. Enable **Developer Mode** in Live's *Preferences → Extensions*.
2. `npm install`
3. `npm start -- --live "/Applications/Ableton Live Beta.app"`
4. In Live, right-click a **scene**, **audio track**, **MIDI track**, or **audio
   clip** → **"Project Sync: Inspect metadata…"**.
5. The dialog opens with a tree of everything the SDK could see. Use:
   - the **filter box** (cmd-F) to grep keys and values,
   - **Expand / Collapse all**,
   - **Copy JSON** to copy the whole snapshot to the clipboard for diffing or
     sharing.

## Files

- `src/extension.ts` — registers the context-menu actions; walks the
  `Song` object graph, builds a plain JSON snapshot, opens the dialog.
- `src/project-sync.html` — themed dark tree viewer with filter and copy.
- `build.ts` — esbuild bundling, with the `.html` text loader.
