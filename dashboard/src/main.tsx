import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, getTheme } from "./lib/prefs";
import { startTranslator } from "./lib/i18n/runtime";

applyTheme(getTheme()); // before the first paint, so there is no flash of the wrong theme
startTranslator(); // site language (English / Persian): translates the page as React renders it

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
