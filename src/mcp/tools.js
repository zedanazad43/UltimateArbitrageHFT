// src/mcp/tools.js — MCP (Model Context Protocol) tool definitions
// Exposes quantlib_call, backtest, screen as MCP tools.
// Compatible with the MCP JSON-RPC 2.0 protocol.

import { quantlibCall } from '../quantlib/index.js';
import { runBacktest } from '../backtest.js';
import { getFundamentals } from '../data/fundamentals.js';
import { getETFHoldings, etfLookThrough } from '../data/etf.js';
import { getInstitutionalHoldings } from '../data/institutions.js';

// ── Tool manifest ─────────────────────────────────────────────────────────────

export const MCP_TOOL_MANIFEST = [
  {
    name: 'quantlib_call',
    description: 'Call any quantlib financial math function by name. Available functions: bsPrice, bsGreeks, impliedVol, bondPrice, ytm, macaulayDuration, modifiedDuration, convexity, dv01, varHistorical, cvarHistorical, varParametric, sharpe, sortino, calmar, maxDrawdown, brinsonAttribution, factorDecomposition, styleAnalysis, mean, variance, stdDev, covariance, correlation, beta, alpha, linearRegression, rollingStats, kalmanFilter, xirr, moic, dpi, tvpi, twr, npv, irr.',
    inputSchema: {
      type: 'object',
      properties: {
        fn:   { type: 'string', description: 'Function name (e.g. "bsPrice")' },
        args: { type: 'array',  description: 'Positional arguments as a JSON array' }
      },
      required: ['fn']
    }
  },
  {
    name: 'run_backtest',
    description: 'Run a backtest on stored trade history. Supports atomic rebalancing, multi-currency, Monte Carlo simulation, and parameter sweep.',
    inputSchema: {
      type: 'object',
      properties: {
        from_ms:             { type: 'number',  description: 'Start timestamp (ms). Default: 30 days ago.' },
        to_ms:               { type: 'number',  description: 'End timestamp (ms). Default: now.' },
        initial_capital:     { type: 'number',  description: 'Starting capital (default: 1000).' },
        base_currency:       { type: 'string',  description: 'Base reporting currency (default: USD).' },
        min_net_pct:         { type: 'number',  description: 'Min net profit % filter (default: 0).' },
        position_frac:       { type: 'number',  description: 'Position size fraction (default: 0.10).' },
        position_adjustment: { type: 'string',  enum: ['default', 'rebalance'], description: 'Atomic rebalancing mode.' },
        strategies:          { type: 'array',   items: { type: 'string' }, description: 'Strategy filter list.' },
        run_monte_carlo:     { type: 'boolean', description: 'Run Monte Carlo (default: true).' },
        run_param_sweep:     { type: 'boolean', description: 'Run parameter sweep (default: false).' },
        emit_fill_evidence:  { type: 'boolean', description: 'Hash all fills (default: false).' }
      }
    }
  },
  {
    name: 'screen_fundamentals',
    description: 'Screen a ticker for fundamental data (income statement, balance sheet) from SEC EDGAR.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol (e.g. "AAPL")' },
        period: { type: 'string', enum: ['annual', 'quarterly'], description: 'Reporting period (default: annual).' }
      },
      required: ['ticker']
    }
  },
  {
    name: 'get_etf_holdings',
    description: 'Get ETF holdings / look-through for one or more ETF symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols:     { type: 'array',   items: { type: 'string' }, description: 'One or more ETF symbols.' },
        look_through: { type: 'boolean', description: 'Merge constituents across ETFs (default: false).' }
      },
      required: ['symbols']
    }
  },
  {
    name: 'get_institutional_holdings',
    description: 'Get SEC 13F institutional holdings with quarter-over-quarter position diffs.',
    inputSchema: {
      type: 'object',
      properties: {
        manager_cik: { type: 'string', description: 'CIK of the institutional manager (e.g. "0001067983" for Berkshire).' }
      },
      required: ['manager_cik']
    }
  }
];

// ── Tool dispatcher ───────────────────────────────────────────────────────────

/**
 * Dispatches an MCP tool call.
 * @param {string} toolName
 * @param {object} args
 * @param {object} env        — Cloudflare Worker env (for DB-backed tools)
 * @returns {Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>}
 */
export async function dispatchMCPTool(toolName, args, env = {}) {
  // Hard limits to prevent abuse
  const LIMITS = {
    quantlib_args_max: 20,
    backtest_monte_carlo_max: 1000,
    screen_ticker_max_len: 12,
    etf_symbols_max: 10
  };

  try {
    let result;

    switch (toolName) {

      case 'quantlib_call': {
        const { fn, args: fnArgs = [] } = args;
        if (!fn) throw new Error('fn is required');
        if (!Array.isArray(fnArgs) || fnArgs.length > LIMITS.quantlib_args_max) {
          throw new Error(`args must be an array with at most ${LIMITS.quantlib_args_max} items`);
        }
        result = await quantlibCall(fn, fnArgs);
        break;
      }

      case 'run_backtest': {
        const config = { ...args };
        // Enforce monte carlo simulation cap
        if (config.simulations > LIMITS.backtest_monte_carlo_max) {
          config.simulations = LIMITS.backtest_monte_carlo_max;
        }
        result = await runBacktest(env, config);
        break;
      }

      case 'screen_fundamentals': {
        const { ticker, period = 'annual' } = args;
        if (!ticker || typeof ticker !== 'string' || ticker.length > LIMITS.screen_ticker_max_len) {
          throw new Error('ticker must be a valid symbol string');
        }
        result = await getFundamentals(ticker.trim().toUpperCase(), period);
        break;
      }

      case 'get_etf_holdings': {
        const { symbols, look_through = false } = args;
        if (!Array.isArray(symbols) || symbols.length === 0) {
          throw new Error('symbols must be a non-empty array');
        }
        const capped = symbols.slice(0, LIMITS.etf_symbols_max);
        if (look_through) {
          result = await etfLookThrough(capped);
        } else {
          result = await Promise.all(capped.map(s => getETFHoldings(s)));
        }
        break;
      }

      case 'get_institutional_holdings': {
        const { manager_cik } = args;
        if (!manager_cik) throw new Error('manager_cik is required');
        result = await getInstitutionalHoldings(manager_cik);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}. Available: ${MCP_TOOL_MANIFEST.map(t => t.name).join(', ')}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };

  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
}

/**
 * Returns the list of available tools (MCP list_tools response).
 */
export function listMCPTools() {
  return { tools: MCP_TOOL_MANIFEST };
}
