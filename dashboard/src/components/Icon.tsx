const PATHS: Record<string, string[]> = {
  chart: ["M3 3v18h18", "M7 15l4-4 3 3 5-6"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  plug: ["M12 2v6", "M8 2v6", "M16 2v6", "M6 8h12v4a6 6 0 0 1-12 0z", "M12 18v4"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  menu: ["M3 6h18", "M3 12h18", "M3 18h18"],
  notebook: ["M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6z", "M9 7h6", "M9 11h6", "M9 15h4"],
  analysis: ["M3 3v18h18", "M8 17v-6", "M13 17V7", "M18 17v-3"],
  flask: ["M9 3h6", "M10 3v6L4.5 19a1 1 0 0 0 .9 1.5h13.2a1 1 0 0 0 .9-1.5L14 9V3", "M7 15h10"],
  spark: ["M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"],
};

export default function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[name] ?? PATHS.spark).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
