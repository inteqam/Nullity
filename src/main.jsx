import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import NullityApp from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NullityApp />
  </React.StrictMode>
);
