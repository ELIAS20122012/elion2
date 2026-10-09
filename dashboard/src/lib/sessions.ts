/** Real FX session windows (UTC), used by the Elion pages instead of a hardcoded "Active/Upcoming/Closed" list. */
export interface SessionInfo { name: string; status: "Active" | "Upcoming" | "Closed"; hours: string }

export const CITY_COORDS: Record<string, [number, number]> = {
  "New York": [-74, 40.7],
  London: [-0.1, 51.5],
  Tokyo: [139.7, 35.7],
};

const DEFS: { name: string; start: number; end: number }[] = [
  { name: "Tokyo", start: 0, end: 9 },
  { name: "London", start: 7, end: 16 },
  { name: "New York", start: 13, end: 22 },
];

export function sessionsNow(d = new Date()): SessionInfo[] {
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return DEFS.map((s) => {
    const active = s.start <= s.end ? h >= s.start && h < s.end : h >= s.start || h < s.end;
    const untilStart = ((s.start - h) + 24) % 24;
    const status: SessionInfo["status"] = active ? "Active" : untilStart <= 4 ? "Upcoming" : "Closed";
    return { name: s.name, status, hours: `${String(s.start).padStart(2, "0")}:00 - ${String(s.end).padStart(2, "0")}:00` };
  });
}

export function currentSessionName(d = new Date()): string {
  const list = sessionsNow(d);
  return list.find((s) => s.status === "Active")?.name ?? list[0].name;
}

/** Which of the three sessions a given unix-seconds timestamp falls in (used to label journal trades). */
export function sessionAt(unixSec: number): string {
  return currentSessionName(new Date(unixSec * 1000));
}
