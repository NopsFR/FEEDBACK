import { create } from "zustand";
import type { ReactNode } from "react";

export interface Toast {
  id: number;
  message: string;
  tone?: "info" | "error";
  action?: { label: string; run: () => void };
}

export interface MenuItem {
  label: string;
  hint?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
  submenu?: MenuItem[];
  separator?: boolean;
}

interface UiState {
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;
  queueOpen: boolean;
  toggleQueue: (v?: boolean) => void;
  nowPlayingOpen: boolean;
  setNowPlaying: (v: boolean) => void;
  shelfCollapsed: boolean;
  toggleShelf: () => void;
  dialog: ReactNode | null;
  setDialog: (d: ReactNode | null) => void;
  sheet: ReactNode | null;
  setSheet: (d: ReactNode | null) => void;
}

let tid = 1;
export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  toast: (t) => {
    const id = tid++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.action ? 6500 : 3800);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  queueOpen: false,
  toggleQueue: (v) => set({ queueOpen: v ?? !get().queueOpen }),
  nowPlayingOpen: false,
  setNowPlaying: (v) => set({ nowPlayingOpen: v }),
  shelfCollapsed: false,
  toggleShelf: () => set({ shelfCollapsed: !get().shelfCollapsed }),
  dialog: null,
  setDialog: (d) => set({ dialog: d }),
  sheet: null,
  setSheet: (d) => set({ sheet: d }),
}));

export const toast = (message: string, tone: Toast["tone"] = "info", action?: Toast["action"]) => useUi.getState().toast({ message, tone, action });
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong.", "error");
