"use client";
import { useEffect, useState } from "react";
import { usePoll, type Overview } from "./api";

const TZ = "Europe/Vienna";

function greeting(h: number) {
  return h < 5 ? "شب بخیر" : h < 12 ? "صبح بخیر" : h < 17 ? "روز بخیر" : h < 21 ? "عصر بخیر" : "شب بخیر";
}

export function Topbar() {
  const { data, down } = usePoll<Overview>("/api/overview", 10000);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const alive = !down && !!data?.heartbeat && Date.now() - new Date(data.heartbeat).getTime() < 90_000;
  const hour = now ? Number(now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" })) : 12;
  const active = data?.schedules.filter((s) => s.enabled).length ?? 0;
  return (
    <header className="topbar">
      <div className="hello">
        <b>{greeting(hour)}، الیاس 👋</b>
        <small>{alive ? "تیم هوش مصنوعی‌ات آنلاین و آماده است." : "Elias OS در دسترس نیست."}</small>
      </div>
      <div className="tb-right">
        <span className="clock" dir="ltr" suppressHydrationWarning>
          ◷ {now ? now.toLocaleTimeString("en-GB", { timeZone: TZ }) : "--:--:--"}
          <small>{now ? now.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" }) : ""}</small>
        </span>
        <span className={`autopilot${alive && active ? " on" : ""}`} title={`${active} کار زمان‌بندی‌شده`} dir="ltr">
          AUTOPILOT <i />
        </span>
      </div>
    </header>
  );
}
