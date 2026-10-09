import { useEffect, type ReactElement } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import { MODULES } from "./modules/registry";
import { AppProvider } from "./state/AppContext";
import { JournalProvider } from "./state/JournalContext";
import { ToastProvider } from "./components/Toast";
import ElionPage from "./pages/ElionPage";
import ElionJournalPage from "./pages/ElionJournalPage";
import ElionAnalyticsPage from "./pages/ElionAnalyticsPage";
import ElionTradePage from "./pages/ElionTradePage";
import ElionRulesPage from "./pages/ElionRulesPage";
import ElionBacktestPage from "./pages/ElionBacktestPage";
import ElionAiLabPage from "./pages/ElionAiLabPage";
import ElionSettingsPage from "./pages/ElionSettingsPage";
import ElionConnectionPage from "./pages/ElionConnectionPage";
import ElionToolsPage from "./pages/ElionToolsPage";
import ElionGlobalEffects from "./components/ElionGlobalEffects";
import ElionMirrorBanner from "./components/ElionMirrorBanner";
import ElionWelcomePage from "./pages/ElionWelcomePage";
import { logout, useAuth } from "./lib/session";
import { LANDING_ROUTES, useSettings } from "./lib/elionSettings";

let landed = false;
/**
 * "/" is the front door. Until you sign in it is the welcome screen; after that it sends you to the
 * page picked as Default Landing Page in Settings, once per app load.
 */
function Landing() {
  const [s] = useSettings();
  const { user, setup, loading } = useAuth();
  if (loading) return <Booting />;
  // `setup` = the server has no accounts yet and is still answering everyone. Demanding a sign-in
  // nobody can pass would lock the owner out of their own dashboard.
  if (!user && !setup) return <ElionWelcomePage />;
  if (!landed) {
    landed = true;
    const to = LANDING_ROUTES[s.landing];
    if (to && to !== "/elion") return <Navigate to={to} replace />;
  }
  return <ElionPage />;
}

/**
 * Every page except the welcome screen sits behind this: no session, no dashboard. Without it only "/"
 * was guarded, so a bookmark or typed link like /#/elion opened the dashboard straight away.
 */
function Guard({ children }: { children: ReactElement }) {
  const { user, setup, loading } = useAuth();
  if (loading) return <Booting />;
  return user || setup ? children : <Navigate to="/" replace />;
}

/** The blank moment before the server has said who you are - deliberately empty, not a spinner. */
function Booting() {
  return <div style={{ position: "fixed", inset: 0, background: "#05090b" }} />;
}

/** Signs out and drops back to the welcome screen. */
function SignOut() {
  useEffect(() => {
    landed = false;
    void logout();
  }, []);
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AppProvider>
      <JournalProvider>
      <ToastProvider>
      <ElionGlobalEffects />
      <HashRouter>
        <ElionMirrorBanner />
        <Routes>
          {/* standalone, own chrome (design/elion/*.dc.html reference) — not nested under Shell.
              These are the site's front door: "/" is the Elion dashboard. The older Shell pages
              are still here, one path down (/overview, /chart, /journal, ...). */}
          <Route path="/" element={<Landing />} />
          <Route path="/welcome" element={<ElionWelcomePage />} />
          <Route path="/logout" element={<SignOut />} />
          <Route path="/elion" element={<Guard><ElionPage /></Guard>} />
          <Route path="/journal" element={<Guard><ElionJournalPage /></Guard>} />
          <Route path="/analysis" element={<Guard><ElionAnalyticsPage /></Guard>} />
          <Route path="/chart" element={<Guard><ElionTradePage /></Guard>} />
          <Route path="/rules" element={<Guard><ElionRulesPage /></Guard>} />
          <Route path="/backtest" element={<Guard><ElionBacktestPage /></Guard>} />
          <Route path="/ai-lab" element={<Guard><ElionAiLabPage /></Guard>} />
          <Route path="/settings" element={<Guard><ElionSettingsPage /></Guard>} />
          <Route path="/account" element={<Guard><ElionConnectionPage /></Guard>} />
          <Route path="/tools" element={<Guard><ElionToolsPage /></Guard>} />
          <Route path="/elion/journal" element={<Guard><ElionJournalPage /></Guard>} />
          <Route element={<Guard><Shell /></Guard>}>
            {MODULES.map((m) => (
              <Route key={m.id} path={m.path} element={m.element} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
      </ToastProvider>
      </JournalProvider>
    </AppProvider>
  );
}
