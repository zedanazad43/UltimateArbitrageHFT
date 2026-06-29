// Entry-point shim – re-exports the canonical HFT worker so that
// `wrangler deploy` works whether main is set to "src/worker.js" or
// directly to "../ArbitrageBots/ultimate-arbitrage-hft/index.js".
export { default, MarketStreamer } from '../ArbitrageBots/ultimate-arbitrage-hft/index.js';
