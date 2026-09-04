import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./App.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found — check index.html");
}
const root = createRoot(container);
root.render(<App />);