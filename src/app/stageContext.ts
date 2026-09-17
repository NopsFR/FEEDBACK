import { createContext, useContext } from "react";

export const StageScrollContext = createContext<{ current: HTMLElement | null }>({ current: null });
export const useStageScroll = () => useContext(StageScrollContext);
