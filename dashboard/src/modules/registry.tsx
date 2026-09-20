import type { ReactElement } from "react";
import AccountPage from "../pages/AccountPage";
import AnalysisPage from "../pages/AnalysisPage";
import BacktestPage from "../pages/BacktestPage";
import ChartPage from "../pages/ChartPage";
import HelpPage from "../pages/HelpPage";
import JournalPage from "../pages/JournalPage";
import OverviewPage from "../pages/OverviewPage";
import RulesPage from "../pages/RulesPage";
import SettingsPage from "../pages/SettingsPage";

export interface ModuleDef {
  id: string;
  path: string;
  title: string;
  icon: string;
  element: ReactElement;
  /** sidebar section; modules without one (or with footer) sit at the bottom */
  group?: "market" | "trading" | "system";
  footer?: boolean;
}

export const GROUPS: { id: NonNullable<ModuleDef["group"]>; label: string }[] = [
  { id: "market", label: "بازار" },
  { id: "trading", label: "معاملات" },
  { id: "system", label: "سیستم" },
];

/**
 * Every section of the dashboard lives here.
 * To add a new one: create `src/pages/MyPage.tsx`, then add one entry below — the sidebar section, the route and
 * the page title in the top bar all come from this list.
 */
export const MODULES: ModuleDef[] = [
  { id: "overview", path: "/", title: "مرکز فرماندهی", icon: "home", group: "market", element: <OverviewPage /> },
  { id: "chart", path: "/chart", title: "چارت", icon: "chart", group: "market", element: <ChartPage /> },
  { id: "journal", path: "/journal", title: "ژورنال", icon: "notebook", group: "trading", element: <JournalPage /> },
  { id: "analysis", path: "/analysis", title: "آنالیز", icon: "analysis", group: "trading", element: <AnalysisPage /> },
  { id: "backtest", path: "/backtest", title: "بک‌تست", icon: "flask", group: "trading", element: <BacktestPage /> },
  { id: "rules", path: "/rules", title: "قوانین", icon: "book", group: "system", element: <RulesPage /> },
  { id: "account", path: "/account", title: "اتصال", icon: "plug", group: "system", element: <AccountPage /> },
  { id: "help", path: "/help", title: "راهنما", icon: "help", group: "system", element: <HelpPage /> },
  { id: "settings", path: "/settings", title: "تنظیمات", icon: "sliders", element: <SettingsPage />, footer: true },
];
