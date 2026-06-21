# Move Export — Ableton Move Set Exporter

Exports the current Live Set into the **Ableton Move project format** (a
`Song.abl` JSON document plus a `Samples/` folder, optionally zipped into a
`.ablbundle`) so it can be loaded onto an Ableton Move.

> **Status: scaffolding.** The plumbing is in place end-to-end — context-menu
> action → walk the Set → convert → write `Song.abl` + `Samples/` → bundle →
> report. The *format mapping itself* is stubbed: clips, devices, and the exact
> `Song.abl` schema still need to be filled in and verified against a real Move
> round-trip. Search the source for `TODO` for every spot that needs work.

## Architecture

The code is split so the SDK-walking and the Move-format knowledge stay
independent — you can iterate on the target format without touching the Live
traversal, and vice-versa.

| File | Responsibility |
| --- | --- |
| `src/extension.ts`   | Registers the context-menu action; orchestrates the pipeline; shows the result dialog. |
| `src/snapshot.ts`    | Walks `context.application.song` into a neutral `LiveSnapshot` (plain data, no SDK types leaking out). |
| `src/move-format.ts` | Owns the Move `Song.abl` types **and** `liveSetToMoveSong()` — the conversion from snapshot to Move document (incl. the Drum Rack builder). |
| `src/move-device-defaults.ts` | Default parameter blocks (rack macros, the 42-param `drumCell`, chain mixer) lifted from a real Move preset. |
| `src/move-writer.ts` | Writes the `Song.abl` + `Samples/` folder and best-effort zips it into `<Set>.ablbundle`. |
| `src/move-export.html` | Result dialog (folder path, bundle path, sample/warning summary). |

```
LiveSnapshot  ──liveSetToMoveSong()──►  MoveSong + sampleSources
   ▲                                          │
collectSnapshot()                        writeMoveSet() ──► <Set>/Song.abl + Samples/
   │                                          │
context.application.song                 bundleSet() ──► <Set>.ablbundle
```

## The Move format

A Move Set is a folder:

```
<Set Name>/
├── Song.abl       JSON, validated against an Ableton schema
└── Samples/       every referenced audio file, by name
```

`Song.abl` is validated against `…/schema/song/1.5.1/song.json`. The structure
in `move-format.ts` is **grounded in real Move Sets**, not guessed:

- the song-level shape (top-level keys, `kind:"midi"` tracks, `{hasStop,clip}`
  clip slots, `region`/`notes`/`envelopes` clips, `noteNumber`/`offVelocity`
  notes, `scale` as a string + separate `rootNote`) was read off the `.abl`
  examples in [`charlesvestal/extending-move`](https://github.com/charlesvestal/extending-move)
  (`examples/Sets/blank.abl`, `midi_template.abl`). The exporter's output passes
  a key-level structural diff against those files at every nesting level.
- the device-chain shape (`drumRack` / `drumCell`, `drumZoneSettings`,
  `deviceData.sampleUri`) is cross-checked against both those Sets and
  `resources/Preset.ablpreset` in the neighbour project
  [`../../move_tools/`](../../move_tools/).

## What's implemented

- **`snapshot.ts` → clip collection** — reads `track.clipSlots[i].clip` in scene
  order, discriminates audio vs. MIDI clips, extracts MIDI notes
  (`pitch`/`startTime`/`duration`/`velocity`, defaulting velocity to 100),
  computes each clip's musical loop length, and classifies each track as
  `drum` / `melodic` / `audio` (drum = a Drum Rack anywhere in the device tree).
- **`snapshot.ts` → drum pads** — for drum tracks, walks the Drum Rack chains
  and records each pad's `receivingNote`, name, and loaded sample path
  (`findDrumRack` / `collectDrumPads`).
- **`move-format.ts` → `convertClip`** — maps a `LiveClip` onto a `MoveClip`
  (notes + sample reference) and registers each audio file for copying.
- **`move-format.ts` → song document** — emits the full verified `Song.abl`:
  correct `$schema` (1.5.1), `tempo`/`rootNote`/`scale`/`stepEditorResolution`,
  exactly 4 tracks (padding empties / warning on overflow), an 8-scene grid,
  `{hasStop,clip}` clip slots, `region`+`notes`+`envelopes` clips, and
  `returnTracks`/`masterTrack`/`scenes`/`grooves`/`metadata`. Output key-matches
  real Sets at every level.
- **`move-format.ts` → `buildDrumRackDevice`** — emits the real
  `instrumentRack ▸ chain ▸ drumRack ▸ one chain per pad ▸ drumCell` envelope:
  each pad carries `drumZoneSettings.receivingNote`, the full `drumCell` default
  parameter block (`move-device-defaults.ts`), and `deviceData.sampleUri`
  (`Samples/<url-encoded name>`, matching the file the writer copies). Empty pads
  get `deviceData: {}`. Reproduces the reference `sampleUri` byte-for-byte.
- **`move-format.ts` → `buildMelodicSamplerDevice`** — a melodic track playing a
  single sample (a Simpler) maps onto a Move `melodicSampler`:
  `instrumentRack ▸ chain ▸ melodicSampler`, with the full 28-parameter default
  block and `deviceData.sampleUri`. Device + every parameter key-match the real
  `melodicSampler` preset. Snapshot side: `instrumentSamplePath` captures the
  Simpler's sample (`snapshot.ts`).
- **`move-format.ts` → audio clips (Move 2.0)** — audio tracks export as real
  Move audio tracks with audio clips, verified against **two** real 1.8.3 Sets
  (`Set 143`, and the bundled `Set 150` — the same form we output). An audio clip
  carries a top-level `sampleUri` (`Samples/<url-encoded>`), `warping`
  (`{markers:[], tempoAfterLastMarker: tempo}`), `gain`/`transpose`/`detune`
  (neutral defaults — matches real Sets), `region`/`loop`, and `timeSignature`.
  Audio tracks use a slimmer shell than MIDI tracks (no note-repeat fields).
  Output key-matches both reference Sets at every level. Schema bumped to
  **1.8.3** (audio doesn't exist in earlier schemas); the MIDI/drum/melodic
  output is a structural subset the device loads fine.

## Validating an export locally

The Move `Song.abl` JSON schema is published by `extending-move` at
`static/schemas/abl_set_schema.json`. It's stricter/older than the device's
actual loader (real device-made Sets fail it too), so validate **differentially**:
generate an export, run it and a couple of your own known-good `.ablbundle` Sets
through the schema, and treat only the errors **unique to your export** as real.
That loop caught the two fixes below without a device round-trip.

## Device-validated fixes

These were all found by uploading to a real Move (`POST /api/v1/data/Sets`) and
reading the rejection — the export now uploads clean (`"error": null`) for drum,
melodic-sampler, Drift, MIDI-clip, and audio-clip Sets.

- **Clip/track color is a palette index (0–25), not RGB** — the Live SDK returns
  packed RGB (e.g. `4047616`); passing it through → *“Document invariant
  violation.”* `moveColorIndex()` maps RGB to the nearest of Move's 26 palette
  colors. (This was the bug that blocked real exported Sets — synthetic tests used
  small color values and slipped past it.)
- **Set folder is cleaned before writing** — a stale `Samples/` from a prior
  export was bloating bundles (a 30 MB bundle with 50 orphan samples) and
  shipping unreferenced files.
- **Every MIDI track needs exactly one device, an `instrumentRack`** — empty/
  uninstrumented tracks were exported with `devices: []` → *“MIDI track must have
  exactly one device, found 0.”*
- **A rack chain must contain an instrument** — an `instrumentRack` with an empty
  chain → *“No instrument device in rack chain.”* MIDI tracks with no translatable
  instrument now get a stock **Drift** synth (needs no sample;
  `defaultDriftParameters()`).
- **A Drum Rack must have exactly 16 pads** — uploading returned *“Document
  invariant violation.”* Every real drumRack has 16 chains spanning notes
  36–51 (the 16 Move pads); we were emitting one chain per Live pad.
  `buildDrumRackDevice` now always emits 16 (Live pads placed on the grid, the
  rest empty).
- **Bundle layout must be root-level** — Move Manager's upload
  (`POST /api/v1/data/Sets`) returned **400** for a `.ablbundle` whose entries
  were nested under `<Set>/`. Real bundles put `Song.abl`, `BundleInfo.json`, and
  `Samples/` at the **zip root**; `bundleSet()` now zips the folder's contents,
  not the folder.
- **`BundleInfo.json` is required** — real bundles carry one mapping each
  `Samples/<x>` to its original `ableton:/packs/…` URI. Our samples are user
  files with no factory original, so we write `{ "originalSampleUris": {} }`.
- **Rack macros are plain numbers** — `Macro0..7` export as `0.0`, not the
  `{value, customName}` object form (real 1.8.3 Sets use plain numbers).
- **instrumentRack chain needs a `mixer`** — the Drum Rack's wrapping
  instrumentRack chain now carries a mixer, like the melodic one and real Sets.
- **`sends` must match `returnTracks`** — loading an exported Set on Move failed
  with *“too many sends: 1, expected 0”*. Every mixer's `sends` array must have
  exactly one entry per return track; since we export `returnTracks: []`, all
  `sends` must be empty. The drum-pad mixer had inherited a send from its source
  preset — now `[]` (see the INVARIANT note in `move-device-defaults.ts`).

## Known SDK limitations

- **Drum Cell samples can't be read** — modern Live drum kits put a **Drum Cell**
  on each pad, but the Extensions SDK (`1.0.0-beta.0`) exposes a sample path only
  for **Simpler** (`Simpler.sample.filePath`); a Drum Cell is an opaque generic
  `Device` (name + numeric params, no sample accessor). So drum kits built on Drum
  Cells export with **silent pads** (the export labels them from the device name
  and warns; the sample path exists in the `.als` but the SDK doesn't surface it).
  Simpler-based drum pads export their samples fine. Fixing this needs a newer SDK
  that models Drum Cell, or a Simpler-based kit.

## What's stubbed (the real work)

- **Melodic synths/VSTs** — only single-sample (Simpler) melodic instruments
  translate. A Drift/Wavetable/Operator/plug-in track exports its notes but lands
  without an instrument (and warns); faithful synth-parameter mapping is a much
  larger, version-specific job.
- **Audio clip warp/gain detail** — `gain`/`transpose`/`detune` export as neutral
  defaults (the SDK doesn't expose them and real Sets use the same defaults), and
  warp markers are empty with the clip synced to the Set tempo. Per-clip gain and
  warp-marker fidelity would need more SDK data.
- **drumCell parameters are defaults** — pad samples and trigger notes are real,
  but the synthesis params are reference defaults, not read off the live device.
- **`masterTrack` / `grooveId`** — master chain is emitted empty and `grooveId`
  is `null`; real Sets carry master devices and a groove reference. `TODO(verify)`.
- **Bundling on Windows** — `bundleSet()` shells out to `zip`; add a JS-zip
  fallback.

## Usage

1. Enable **Developer Mode** in Live's *Preferences → Extensions*.
2. `npm install`
3. `npm start -- --live "/Applications/Ableton Live Beta.app"`
4. In Live, right-click a **track**, **scene**, or **clip slot** →
   **“Move Export: Export Set to Ableton Move…”**.
5. The dialog reports where the Set folder / `.ablbundle` was written and any
   warnings (unsupported features, dropped tracks, missing samples).

## Files

- `build.ts` — esbuild bundling, with the `.html` text loader (identical to the
  other extensions in this repo).
