// WSL invocation detection for agent tool_use events.
//
// We don't run anything in WSL and don't watch its processes — we only look
// at the command text an agent actually submitted to its Bash tool and decide
// "is this a WSL invocation, and if so what does it run inside WSL?". This
// stays zero-touch: no scripts installed inside the distro, no changes to the
// agent's own workflow.
//
// Detection rules:
//  - the command must contain a standalone `wsl` / `wsl.exe` token;
//  - a preceding `.` or `/` (e.g. `wslpath`, `/mnt/wsl/...`) disqualifies it,
//    so `wslpath` and WSL filesystem paths are never mistaken for a WSL call;
//  - `wsl` must sit at a command boundary (start of line, or right after
//    `&&` / `;` / `|` / `(` / quotes) — `echo hello wsl world` is NOT a WSL
//    invocation, it just mentions the word;
//  - after the token we parse wsl's own flags (`-d distro`, `-u user`,
//    `-e/--exec`, `--cd ...`) and report the first real command that runs
//    inside WSL.

export interface WslInfo {
  // The command executed inside WSL (e.g. "python train.py"). Falls back to
  // the remaining wsl args when there is no inner command (e.g. `wsl --list`).
  command: string;
  // The target distro when the agent used `-d <distro>` / `--distribution`.
  distro?: string;
}

// Standalone wsl token: not preceded by a word char, `.` or `/`; followed by
// whitespace, `-` (flags) or end of line. This rejects wslpath / wslvar and
// /mnt/wsl/... paths while accepting `wsl -e bash -c "…"` and `wsl.exe --`.
// No `g` flag on purpose: a module-level `g` regex keeps a mutable lastIndex
// and would make repeated exec() calls start from the previous match position.
const WSL_TOKEN_RE = /(?<![\w./])wsl(?:\.exe)?(?=[\s-]|$)/i;

// Characters that end a shell command token. `wsl` must directly follow one
// of these (or the start of the string) to count as a command invocation.
const COMMAND_SEPARATORS = new Set([";", "&", "|", "(", "<", ">", '"', "'", "`", "$"]);

function atCommandStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return COMMAND_SEPARATORS.has(c);
  }
  return true;
}

const MAX_COMMAND = 120;

export function detectWsl(
  tool: string | undefined,
  message: string | undefined,
): WslInfo | null {
  if (!message) return null;
  const m = WSL_TOKEN_RE.exec(message);
  if (!m) return null;
  if (!atCommandStart(message, m.index)) return null;

  const rest = message.slice(m.index + m[0].length).trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  let distro: string | undefined;
  let command: string | undefined;
  let i = 0;

  // Management flags (--list / --status / --shutdown / --terminate ...) take
  // no inner command — show the whole wsl argument list as the "command".
  if (tokens.length > 0 && /^(?:-l|--list|--status|--shutdown|--terminate|--version|-v|--help|-h)$/i.test(tokens[0])) {
    return { command: rest, distro: undefined };
  }

  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-d" || t === "--distribution") {
      distro = tokens[i + 1];
      i += 2;
    } else if (t.startsWith("--distribution=")) {
      distro = t.slice("--distribution=".length);
      i += 1;
    } else if (t === "-u" || t === "--user") {
      // username only — skip it, the next token is the command
      i += 2;
    } else if (t === "-e" || t === "--exec") {
      // everything after --exec is the command
      i += 1;
    } else if (t === "--cd") {
      i += 2;
    } else if (t.startsWith("--cd=")) {
      i += 1;
    } else if (t.startsWith("-")) {
      // other wsl flags (-i, --list, --status, ...)
      i += 1;
    } else {
      // first non-flag token: the actual command (rest of the line)
      command = tokens.slice(i).join(" ");
      break;
    }
  }

  if (!command) command = rest;
  // Strip trailing quote/semicolon noise from `bash -c "wsl --status"`.
  command = command.replace(/["';]+$/, "").trim();
  return {
    command: command.length > MAX_COMMAND ? command.slice(0, MAX_COMMAND) + "…" : command,
    distro,
  };
}

// The command "stem" used as the historical aggregate key — the first token
// only (e.g. `python train.py --epochs 50` and `python train.py` both map to
// `python`). Detection keeps the full command for display, but session average
// durations are keyed on the stem so the same program with different arguments
// still matches its history and the live pill can show a percentage.
export function wslCommandKey(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const stem = command.trim().split(/\s+/)[0];
  return stem || undefined;
}
