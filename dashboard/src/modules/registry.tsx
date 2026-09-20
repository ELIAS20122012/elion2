import type { ReactElement } from "react";
import AccountPage from "../pages/AccountPage";
import AnalysisPage from "../pages/AnalysisPage";
import BacktestPage from "../pages/BacktestPage";
import ChartPage from "../pages/ChartPage";
import JournalPage from "../pages/JournalPage";
import RulesPage from "../pages/RulesPage";
import SettingsPage from "../pages/SettingsPage";

export interface ModuleDef {
  id: string;
  path: string;
  title: string;
  icon: string;
  element: ReactElement;
  /** shown at the bottom of the sidebar */
  footer?: boolean;
}

/**
 * Every section of the dashboard lives here.
 * To add a new one: create `src/pages/MyPage.tsx`, then add one entry below — the sidebar and the route appear automatically.
 */
export const MODULES: ModuleDef[] = [
  { id: "chart", path: "/", title: "چارت", icon: "chart", element: <ChartPage /> },
  { id: "journal", path: "/journal", title: "ژورنال", icon: "notebook", element: <JournalPage /> },
  { id: "analysis", path: "/analysis", title: "آنالیز", icon: "analysis", element: <AnalysisPage /> },
  { id: "backtest", path: "/backtest", title: "بک‌تست", icon: "flask", element: <BacktestPage /> },
  { id: "rules", path: "/rules", title: "قوانین", icon: "book", element: <RulesPage /> },
  { id: "account", path: "/account", title: "اتصال MT", icon: "plug", element: <AccountPage /> },
  { id: "settings", path: "/settings", title: "تنظیمات", icon: "sliders", element: <SettingsPage />, footer: true },
];
