import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | { state: "idle"; message: string }
  | { state: "checking"; message: string }
  | { state: "available"; message: string }
  | { state: "downloading"; message: string }
  | { state: "installed"; message: string }
  | { state: "none"; message: string }
  | { state: "error"; message: string };

export async function checkAndInstallUpdate(
  onStatus: (status: UpdateStatus) => void,
): Promise<void> {
  onStatus({ state: "checking", message: "Checking local/static update endpoint..." });
  try {
    const update = await check();
    if (!update) {
      onStatus({ state: "none", message: "No update available from the configured endpoint." });
      return;
    }

    onStatus({
      state: "available",
      message: `Found ${update.version}${update.date ? ` (${update.date})` : ""}.`,
    });

    let downloaded = 0;
    let contentLength = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        onStatus({ state: "downloading", message: "Downloading update..." });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        const suffix = contentLength > 0 ? ` ${downloaded}/${contentLength} bytes` : "";
        onStatus({ state: "downloading", message: `Downloading update...${suffix}` });
      } else if (event.event === "Finished") {
        onStatus({ state: "installed", message: "Update installed. Relaunching..." });
      }
    });

    await relaunch();
  } catch (error) {
    onStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Update check failed.",
    });
  }
}
