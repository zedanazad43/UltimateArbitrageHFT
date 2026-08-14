// src/mcp/server.js — MCP JSON-RPC 2.0 server handler
// Handles MCP protocol requests: initialize, tools/list, tools/call.
// Integrates with the existing Cloudflare Worker routing layer.

import { listMCPTools, dispatchMCPTool } from './tools.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name:    'UltimateArbitrageHFT-MCP',
  version: '1.0.0'
};

/**
 * Handles a single MCP JSON-RPC 2.0 request.
 * @param {object} request  — parsed JSON-RPC request body
 * @param {object} env      — Cloudflare Worker env
 * @returns {object} JSON-RPC response
 */
export async function handleMCPRequest(request, env) {
  const { jsonrpc, id, method, params } = request;

  if (jsonrpc !== '2.0') {
    return mcpError(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
  }

  try {
    switch (method) {
      case 'initialize':
        return mcpOK(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        });

      case 'tools/list':
        return mcpOK(id, listMCPTools());

      case 'tools/call': {
        const { name, arguments: toolArgs = {} } = params ?? {};
        if (!name) return mcpError(id, -32602, 'Invalid params: name is required');
        const result = await dispatchMCPTool(name, toolArgs, env);
        return mcpOK(id, result);
      }

      case 'ping':
        return mcpOK(id, { pong: true });

      default:
        return mcpError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return mcpError(id, -32603, `Internal error: ${err.message}`);
  }
}

/**
 * Cloudflare Worker Request handler for the /mcp endpoint.
 * Accepts POST requests with JSON-RPC 2.0 bodies.
 *
 * @param {Request} req
 * @param {object}  env
 * @returns {Response}
 */
export async function mcpRequestHandler(req, env) {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(mcpError(null, -32700, 'Parse error'), 400);
  }

  // Handle batch requests (array)
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(req => handleMCPRequest(req, env)));
    return jsonResponse(responses);
  }

  const response = await handleMCPRequest(body, env);
  return jsonResponse(response);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mcpOK(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function mcpError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
