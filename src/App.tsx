import { useEffect } from "react";
import { useLightState, useMemos, useSystem } from "./hooks/useLightEvents";
import { Island } from "./components/Island";

export function App() {
  const state = useLightState();
  const memos = useMemos();
  const system = useSystem();

  // Keep <html>'s theme class in sync with the main process. The main process
  // also injects the class on startup (before React mounts) to avoid a flash,
  // but we re-apply here so a renderer reload or a missed event still
  // converges to the right state.
  useEffect(() => {
    const apply = (eff: string) => {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(eff === "light" ? "light" : "dark");
    };
    window.light?.getTheme().then((t) => apply(t.effective)).catch(() => {});
    return window.light?.onTheme((t) => apply(t.effective));
  }, []);

  return <Island sessions={state.sessions ?? []} memos={memos} system={system} />;
}
