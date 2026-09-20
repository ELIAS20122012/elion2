import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import { MODULES } from "./modules/registry";
import { AppProvider } from "./state/AppContext";
import { JournalProvider } from "./state/JournalContext";
import { ToastProvider } from "./components/Toast";

export default function App() {
  return (
    <AppProvider>
      <JournalProvider>
      <ToastProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
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
