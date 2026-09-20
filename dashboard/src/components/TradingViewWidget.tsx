import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  interval: string;
}

/** TradingView's own embeddable chart (full drawing toolbar + indicators). Data comes from TradingView, not from MT5. */
export default function TradingViewWidget({ symbol, interval }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current!;
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#0a0d13",
      gridColor: "rgba(255,255,255,0.04)",
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      details: false,
      calendar: false,
      save_image: true,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(s);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol, interval]);

  return <div ref={box} className="tradingview-widget-container tvbox" dir="ltr" />;
}
