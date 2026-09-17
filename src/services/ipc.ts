import { invoke } from "@tauri-apps/api/core";
import type { AppError } from "./types";
import { log } from "@/lib/log";

export class FeedbackError extends Error {
  code: string;
  constructor(e: AppError) {
    super(e.message);
    this.code = e.code;
  }
}

/** invoke() with normalised, user-safe errors. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (err && typeof err === "object" && "message" in err && "code" in err) {
      throw new FeedbackError(err as AppError);
    }
    log.error("IPC", cmd, err);
    throw new FeedbackError({ code: "unknown", message: "Something went wrong talking to the library." });
  }
}
