// Theme store: light / dark / auto (follow system).
//
// Persisted to userData/theme.json. The "auto" mode resolves to light or dark
// by reading Electron's nativeTheme.shouldUseDarkColors, and re-resolves
// whenever the OS theme changes (main.ts wires the nativeTheme 'updated'
// event). The effective colour is applied to the renderer by toggling a
// `light` class on <html>.

import { nativeTheme } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Theme = "light" | "dark" | "auto";
export type EffectiveTheme = "light" | "dark";

const DEFAULT: Theme = "dark";

export class ThemeStore {
  private filePath: string;
  private theme: Theme = DEFAULT;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "theme.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        const t = parsed?.theme;
        if (t === "light" || t === "dark" || t === "auto") this.theme = t;
      }
    } catch {
      /* ignore — fall back to default */
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ theme: this.theme }), "utf8");
    } catch {
      /* ignore */
    }
  }

  get(): Theme {
    return this.theme;
  }

  set(t: Theme): Theme {
    this.theme = t;
    this.save();
    return this.theme;
  }

  // Resolve "auto" to the actual colour the renderer should use right now.
  effective(): EffectiveTheme {
    if (this.theme === "auto") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    return this.theme;
  }
}
