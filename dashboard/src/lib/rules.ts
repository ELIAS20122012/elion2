export type RuleStatus = "waiting" | "teaching" | "approved";

export interface Rule {
  id: string;
  title: string;
  hint: string;
  status: RuleStatus;
  /** true once the rule can draw on the chart (gets a layer switch) */
  ready: boolean;
}

/**
 * The rules Elias teaches one by one, in teaching order.
 * Move a rule to "teaching" while it's being defined and to "approved" once Elias confirms it on the chart.
 */
export const RULES: Rule[] = [
  { id: "trades", title: "معاملات", hint: "ورود و خروج و حد ضرر روی چارت", status: "approved", ready: true },
  { id: "swings", title: "سوینگ‌ها و فرکتال", hint: "قله و دره‌ها", status: "waiting", ready: false },
  { id: "trendline", title: "خط روند", hint: "حداقل ۲ لمس", status: "waiting", ready: false },
  { id: "macd", title: "MACD اصلی و کوچک", hint: "۱۲/۲۶/۹ و ۳/۶/۲", status: "waiting", ready: false },
  { id: "divergence", title: "دایورجنس", hint: "معمولی و پنهان", status: "waiting", ready: false },
  { id: "level", title: "ساختار لول", hint: "High1 → Low → High2", status: "waiting", ready: false },
  { id: "setups", title: "ستاپ الف / ب", hint: "ورود، حد ضرر، هدف", status: "waiting", ready: false },
];

export const STATUS_LABEL: Record<RuleStatus, string> = {
  waiting: "منتظر آموزش",
  teaching: "در حال آموزش",
  approved: "تأیید شده",
};
