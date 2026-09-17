type Cat = "PLAYER" | "LIBRARY" | "IPC" | "UI" | "IMPORT" | "SYNC";
const dev = import.meta.env.DEV;
export const log = {
  debug: (cat: Cat, ...a: unknown[]) => dev && console.debug(`[${cat}]`, ...a),
  info: (cat: Cat, ...a: unknown[]) => dev && console.info(`[${cat}]`, ...a),
  warn: (cat: Cat, ...a: unknown[]) => console.warn(`[${cat}]`, ...a),
  error: (cat: Cat, ...a: unknown[]) => console.error(`[${cat}]`, ...a),
};
