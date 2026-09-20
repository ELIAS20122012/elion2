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
 * The rule book. It is EMPTY on purpose: nothing about the setup is assumed.
 * Rules are added here only as Elias defines them, in the order he teaches them, with status
 * "teaching" while being defined and "approved" once he confirms them on the chart.
 */
export const RULES: Rule[] = [];

/** Things the chart can show that are not setup rules. */
export const LAYERS = [{ id: "trades", title: "معاملات", hint: "ورود و خروج و حد ضرر روی چارت" }];

export const STATUS_LABEL: Record<RuleStatus, string> = {
  waiting: "منتظر آموزش",
  teaching: "در حال آموزش",
  approved: "تأیید شده",
};
