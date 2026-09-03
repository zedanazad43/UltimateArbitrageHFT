// ─── UltimateArbitrageHFT — Go Engine Container wrapper Worker ─────────────
// Routes every incoming request to the HFT engine container (API on :8080).
// The container boots with safe paper-trading defaults; exchange credentials
// and ENGINE_SECRET are passed via envVars below when live trading is enabled.

import { Container, getContainer } from "@cloudflare/containers";

export class HftEngine extends Container {
  defaultPort = 8080;
  // Health-check the container against the engine API's /health during startup.
  pingEndpoint = "localhost/health";
  // Keep the engine warm: 6h idle timeout (continuous WS feeds keep it busy).
  sleepAfter = "21600s";
  enableInternet = true;
  envVars = {
    // Safe defaults — paper trading only until credentials are provided.
    PAPER_TRADING: "true",
    TRADING_ENABLED: "false",
    SCAN_INTERVAL_MS: "500",
    API_ADDR: ":8080",
    METRICS_ADDR: ":9090",
    MIN_NET_PROFIT_PCT: "0.05",
    MAX_SPREAD_PCT: "5.0",
    INITIAL_CAPITAL_USD: "1000",
    MAX_DAILY_LOSS_USD: "25",
    MIN_SECONDS_BETWEEN_TX: "30",
    WIN_RATE: "0.55",
    RISK_REWARD_RATIO: "2.0",
    MAX_GAS_COST_PCT: "0.30",
  };
}

export default {
  async fetch(request, env) {
    return getContainer(env.HFT_ENGINE, "engine").fetch(request);
  },
};