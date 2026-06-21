import {
  initialize,
  type ActivationContext,
  type ContextMenuScope,
  type ExtensionContext,
} from "@ableton-extensions/sdk";

import * as path from "node:path";
import * as os from "node:os";

import { collectSnapshot, type LiveSnapshot } from "./snapshot.js";
import { liveSetToMoveSong } from "./move-format.js";
import { writeMoveSet, bundleSet } from "./move-writer.js";
import dialogHtml from "./move-export.html";

type ApiVersion = "1.0.0";

// Surfaces the export action shows up on. Move export is a whole-Set
// operation, so the broad scopes are convenience entry points.
const SCOPES: ContextMenuScope<ApiVersion>[] = [
  "AudioTrack",
  "MidiTrack",
  "Scene",
  "ClipSlot",
];

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("moveExport.export", () => {
    void exportToMove(context).catch((e) => {
      console.error("[MoveExport] failed:", e);
    });
  });

  for (const scope of SCOPES) {
    context.ui.registerContextMenuAction(
      scope,
      "Move Export: Export Set to Ableton Move…",
      "moveExport.export",
    );
  }
}

async function exportToMove(
  context: ExtensionContext<ApiVersion>,
): Promise<void> {
  // 1. Walk the Set into a neutral snapshot.
  const snapshot = (await context.ui.withinProgressDialog(
    "Move Export — reading Set…",
    { progress: 0 },
    async (update, signal) => collectSnapshot(context, update, signal),
  )) as LiveSnapshot | null;
  if (!snapshot) return;

  // 2. Convert the snapshot into the Move Song document + sample list.
  const setName = "Exported Set"; // TODO: derive from the .als name / prompt the user.
  const converted = liveSetToMoveSong(snapshot, setName);

  // 3. Write Song.abl + Samples/ to disk, then try to bundle it.
  const outDir =
    context.environment.storageDirectory ??
    context.environment.tempDirectory ??
    path.join(os.tmpdir(), "move-export");

  const written = await writeMoveSet(outDir, setName, converted);
  const bundle = await bundleSet(written.setDir);

  // 4. Report.
  const html = dialogHtml
    .replace("__SET_NAME__", escapeHtml(setName))
    .replace("__SET_DIR__", escapeHtml(written.setDir))
    .replace("__BUNDLE__", escapeHtml(bundle ?? "(not bundled — folder only)"))
    .replace(
      "__SAMPLES__",
      escapeHtml(
        `${written.copiedSamples.length} copied` +
          (written.missingSamples.length
            ? `, ${written.missingSamples.length} missing`
            : ""),
      ),
    )
    .replace("__WARNINGS__", renderWarnings(converted.warnings));

  await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(html)}`,
    640,
    480,
  );
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "<li>None.</li>";
  return warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
