import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const VERCEL_ALIAS_HOST = "visitecrm.vercel.app";
const CANONICAL_HOST = "visitecrm.com";

if (window.location.hostname === VERCEL_ALIAS_HOST) {
  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.protocol = "https:";
  canonicalUrl.hostname = CANONICAL_HOST;
  canonicalUrl.port = "";
  window.location.replace(canonicalUrl.toString());
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
