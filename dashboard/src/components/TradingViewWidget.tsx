import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  interval: string;
}

/**
 * TradingView's own embeddable chart (full drawing toolbar + indicators). Data comes from TradingView, not from MT5.
 *
 * Deliberately never clears or reuses its container. TradingView's embed script keeps mutating it
 * asynchronously (fetching sub-resources, finishing setup, ...) well after it is inserted; tearing the
 * container down ourselves (the old code did `el.innerHTML = ""` on cleanup) removes the <script> tag from
 * the document while that work is still in flight, which nulls the script's `.parentElement` and crashes
 * inside TradingView's own code with "Cannot read properties of null (reading 'querySelector')" - reproduces
 * every time you switch away from the TradingView tab (or change symbol/interval) shortly after opening it.
 * Callers remount a fresh instance instead - give this component a `key` that changes with symbol/interval -
 * so a real unmount removes the whole subtree in one piece, which leaves every descendant's `.parentElement`
 * intact for any pending callback.
 */
export default function TradingViewWidget({ symbol, interval }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current!;
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.cssText = "height:100%;width:100%";
    el.appendChild(widget);
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
    // deliberately no cleanup - see the comment above
  }, [symbol, interval]);

  return <div ref={box} className="tradingview-widget-container tvbox" dir="ltr" />;
}
