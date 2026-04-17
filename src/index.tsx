import { startOpenTuiApp } from "./renderers/opentui/start";

startOpenTuiApp().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
