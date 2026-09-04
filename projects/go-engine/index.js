// ─── UltimateArbitrageHFT — Go Engine Container wrapper Worker ─────────────
// Routes every incoming request to the HFT engine container (API on :8080).
// The container boots with safe paper-trading defaults; exchange credentials
// and ENGINE_SECRET are passed via envVars below when live trading is enabled.

import { env } from "cloudflare:workers";
import { Container, getContainer } from "@cloudflare/containers";

export class HftEngine extends Container {
  defaultPort = 8080;
  // Health-check the container against the engine API's /api/health during startup.
  pingEndpoint = "localhost/api/health";
  // Keep the engine warm: 6h idle timeout (continuous WS feeds keep it busy).
  sleepAfter = "21600s";
  enableInternet = true;
  envVars = {
    // Safe defaults — paper trading only until credentials are provided.
    // ENGINE_REQUIRE_AUTH=true fails closed: until HFT_ENGINE_SECRET is set
    // (bound as a Worker secret, uploaded by deploy-engine.yml) the engine
    // refuses scan/execute with 401 instead of running unauthenticated.
    ENGINE_REQUIRE_AUTH: "true",
    // Secret flows from the Worker binding (undefined -> "" until configured).
    HFT_ENGINE_SECRET: env.HFT_ENGINE_SECRET ?? "",
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