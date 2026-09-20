/** One consistent 24px stroke icon set (no emoji / unicode glyphs in the UI). */
const PATHS: Record<string, string[]> = {
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"],
  chart: ["M3 3v18h18", "M7 15l4-4 3 3 5-6"],
  notebook: ["M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6z", "M9 7h6", "M9 11h6", "M9 15h4"],
  analysis: ["M3 3v18h18", "M8 17v-6", "M13 17V7", "M18 17v-3"],
  flask: ["M9 3h6", "M10 3v6L4.5 19a1 1 0 0 0 .9 1.5h13.2a1 1 0 0 0 .9-1.5L14 9V3", "M7 15h10"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  plug: ["M12 2v6", "M8 2v6", "M16 2v6", "M6 8h12v4a6 6 0 0 1-12 0z", "M12 18v4"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  menu: ["M3 6h18", "M3 12h18", "M3 18h18"],
  plus: ["M12 5v14", "M5 12h14"],
  refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 20h16"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  copy: ["M9 9h11v11H9z", "M5 15V4h11"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  play: ["M7 4l13 8-13 8z"],
  pause: ["M8 4v16", "M16 4v16"],
  step: ["M5 4l10 8-10 8z", "M19 4v16"],
  reset: ["M4 12a8 8 0 1 1 2.3 5.7", "M4 19v-7h7"],
  undo: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  "chevron-right": ["M9 6l6 6-6 6"],
  "chevron-left": ["M15 6l-6 6 6 6"],
  magnet: ["M6 3v9a6 6 0 0 0 12 0V3", "M6 8h4", "M14 8h4"],
  fit: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
  fx: ["M9 4c-2 0-3 1-3 3v10c0 2-1 3-3 3", "M4 12h6", "M15 9l6 8", "M21 9l-6 8"],
  volume: ["M5 20V10", "M12 20V4", "M19 20v-7"],
  server: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
  activity: ["M3 12h4l3-8 4 16 3-8h4"],
  wallet: ["M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 7l2-3h12", "M16 13.5h.01"],
  spark: ["M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"],
  /* drawing tools */
  cursor: ["M5 3l14 7-6 2-2 6z"],
  trend: ["M4 19L20 5", "M4 19h.01", "M20 5h.01"],
  ray: ["M4 18L20 6", "M15 6h5v5"],
  hline: ["M3 12h18"],
  hray: ["M6 12h15", "M6 12h.01"],
  vline: ["M12 3v18"],
  channel: ["M3 19L21 11", "M3 12L21 4"],
  rect: ["M4 6h16v12H4z"],
  fib: ["M3 5h18", "M3 10h18", "M3 15h12", "M3 20h18"],
  measure: ["M3 17L17 3l4 4L7 21z", "M7 13l2 2", "M10 10l2 2", "M13 7l2 2"],
  text: ["M5 6V4h14v2", "M12 4v16", "M9 20h6"],
};

export default function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[name] ?? PATHS.spark).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
