// Trading tools that must be exact — computed in code, never by an AI.
import type { Plugin } from "./types.ts";

/** lots = (balance × risk%) ÷ (SL pips × pip value per 1.00 lot), rounded DOWN to the lot step. */
export function lotSize(balance: number, riskPct: number, slPips: number, pipValue = 10, step = 0.01) {
  const riskMoney = (balance * riskPct) / 100;
  const raw = riskMoney / (slPips * pipValue);
  const lots = Math.floor(raw / step + 1e-9) * step;
  return { riskMoney, raw, lots: Number(lots.toFixed(2)), actualRisk: lots * slPips * pipValue };
}

const USAGE = "استفاده: /lot بالانس درصد‌ریسک SL‌به‌پیپ [ارزش‌پیپ برای ۱ لات، پیش‌فرض 10]\nمثال: /lot 5000 1 25";

export const tradingPlugin: Plugin = {
  name: "trading",
  description: "Exact trading tools: /lot position size",
  setup({ kernel }) {
    kernel.registerCommand({
      name: "lot",
      description: "محاسبه‌ی حجم لات (/lot بالانس ریسک% SL)",
      plugin: "trading",
      run(args) {
        const n = args.replace(/[%$,]/g, " ").trim().split(/\s+/).map(Number);
        const [balance, risk, sl, pv = 10] = n;
        if (n.length < 3 || n.some((x) => !Number.isFinite(x) || x <= 0) || risk! > 100) return USAGE;
        const r = lotSize(balance!, risk!, sl!, pv);
        if (r.lots <= 0) return `⚠️ حجم کمتر از 0.01 می‌شود (${r.raw.toFixed(4)}). SL را کوچک‌تر یا ریسک را بیشتر کن.`;
        return [
          `📐 حجم: ${r.lots.toFixed(2)} لات`,
          `ریسک هدف: ${r.riskMoney.toFixed(2)}$ (${risk}%)`,
          `ریسک واقعی با این حجم: ${r.actualRisk.toFixed(2)}$`,
          `SL: ${sl} پیپ · ارزش پیپ: ${pv}$ برای ۱ لات${pv === 10 ? " (جفت‌های …USD)" : ""}`,
        ].join("\n");
      },
    });
  },
};
