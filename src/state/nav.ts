import { create } from "zustand";

export type Route =
  | { name: "home" }
  | { name: "search"; q?: string }
  | { name: "albums" }
  | { name: "album"; id: number }
  | { name: "artists" }
  | { name: "artist"; id: number }
  | { name: "tracks" }
  | { name: "genres" }
  | { name: "genre"; genre: string }
  | { name: "year"; year: number }
  | { name: "videos" }
  | { name: "playlists" }
  | { name: "playlist"; id: number }
  | { name: "smart"; which: "favourites" | "history" | "most-played" | "recently-added" }
  | { name: "settings"; section?: string };

interface Entry {
  route: Route;
  scroll: number;
}

interface NavState {
  stack: Entry[];
  index: number;
  route: Route;
  go: (r: Route) => void;
  back: () => void;
  forward: () => void;
  saveScroll: (y: number) => void;
  canBack: boolean;
  canForward: boolean;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

/** In-app history. Scroll positions are restored when navigating back. */
export const useNav = create<NavState>((set, get) => ({
  stack: [{ route: { name: "home" }, scroll: 0 }],
  index: 0,
  route: { name: "home" },
  canBack: false,
  canForward: false,
  go: (r) => {
    const { stack, index } = get();
    if (same(stack[index].route, r)) return;
    const next = [...stack.slice(0, index + 1), { route: r, scroll: 0 }].slice(-60);
    set({ stack: next, index: next.length - 1, route: r, canBack: next.length > 1, canForward: false });
  },
  back: () => {
    const { stack, index } = get();
    if (index === 0) return;
    set({ index: index - 1, route: stack[index - 1].route, canBack: index - 1 > 0, canForward: true });
  },
  forward: () => {
    const { stack, index } = get();
    if (index >= stack.length - 1) return;
    set({ index: index + 1, route: stack[index + 1].route, canBack: true, canForward: index + 1 < stack.length - 1 });
  },
  saveScroll: (y) => {
    const { stack, index } = get();
    if (stack[index]) stack[index].scroll = y;
  },
}));

export const routeKey = (r: Route) => JSON.stringify(r);
