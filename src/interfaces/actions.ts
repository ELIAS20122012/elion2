// Which "/command args" an AI answer may run by itself, and which need Elias's ▶️ tap.
// Elias talks naturally; the chat agent turns the request into action lines. Harmless, local or read-only
// actions run at once; anything that deletes, publishes, costs money or changes the PC waits for a tap.

/** command → args are fine to auto-run when this returns true */
const SAFE: Record<string, (args: string) => boolean> = {
  remind: () => true,
  reminders: (a) => !/^off\b/i.test(a.trim()), // listing yes, deleting a daily reminder no
  termin: (a) => !/^(del|delete|حذف)\b/i.test(a.trim()),
  remember: () => true,
  notes: () => true,
  note: () => true, // appends to today's Obsidian note
  find: () => true,
  vault: () => true,
  research: (a) => !/^off\b/i.test(a.trim()),
  team: () => true,
  health: () => true,
  report: () => true,
  account: () => true,
  trades: () => true,
  lot: () => true,
  draw: () => true,
  backup: () => true,
  review: () => true,
  compare: () => true,
  lab: () => true,
  memory: (a) => !/^apply\b/i.test(a.trim()), // replacing the whole memory needs a tap
  agent: (a) => !/^go\b/i.test(a.trim()), // the agent itself stops before risky steps; "go" is Elias's tap
  screen: () => true,
  open: () => true,
  file: () => true,
  apps: () => true,
  close: (a) => !/\byes\b/i.test(a), // without "yes" it only asks
  power: (a) => !/\byes\b/i.test(a), // lock/cancel run; restart/shutdown/sleep only ask
  pc: (a) => !/\b(yes|undo)\b|بله|آره/i.test(a), // report / previews only; the real clean-up needs a tap
};

export function isSafeAction(action: string): boolean {
  const m = action.trim().match(/^\/([a-z][a-z0-9_]*)(?:\s+([\s\S]*))?$/i);
  if (!m) return false;
  const rule = SAFE[m[1]!.toLowerCase()];
  return !!rule && rule(m[2] ?? "");
}
