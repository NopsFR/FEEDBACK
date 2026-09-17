import { create } from "zustand";
import { library } from "@/services/library";
import { log } from "@/lib/log";

export type IntroMode = "full" | "fast" | "off";
export type ReplayGainMode = "off" | "track" | "album";

export interface Settings {
  intro: IntroMode;
  introSound: boolean;
  replayGain: ReplayGainMode;
  crossfadeSec: number;
  gapless: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  visualiser: boolean;
  discMode: boolean;
  ambientArtwork: boolean;
  resumeOnLaunch: boolean;
  reducedMotion: "system" | "on" | "off";
  mobileData: "wifi" | "any";
  /** Opt-in catalogue lookups (MusicBrainz / Cover Art Archive). Metadata only. */
  onlineLookups: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  intro: "full",
  introSound: false,
  replayGain: "album",
  crossfadeSec: 0,
  gapless: true,
  eqEnabled: false,
  eqPreset: "flat",
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  visualiser: true,
  discMode: false,
  ambientArtwork: true,
  resumeOnLaunch: false,
  reducedMotion: "system",
  mobileData: "wifi",
  onlineLookups: false,
};

const LOCAL_KEY = "feedback.settings.v1";

interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

function readLocal(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Settings live in SQLite (authoritative). A localStorage mirror lets the intro decide instantly before IPC is ready. */
export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  ...readLocal(),
  loaded: false,
  load: async () => {
    try {
      const all = await library.settings();
      const s: Partial<Settings> = {};
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        if (`settings.${k}` in all) (s as Record<string, unknown>)[k] = all[`settings.${k}`];
      }
      set({ ...s, loaded: true });
    } catch (e) {
      log.warn("UI", "settings load failed", e);
      set({ loaded: true });
    }
  },
  set: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    const snapshot: Partial<Settings> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) (snapshot as Record<string, unknown>)[k] = get()[k];
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
    } catch {
      /* storage unavailable */
    }
    library.setSetting(`settings.${key}`, value).catch((e) => log.warn("UI", "setting save failed", e));
  },
}));
