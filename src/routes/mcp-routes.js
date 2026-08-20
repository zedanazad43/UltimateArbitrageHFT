// src/routes/mcp-routes.js — MCP endpoint routing
// Mounts the /mcp JSON-RPC 2.0 endpoint.

import { mcpRequestHandler } from '../mcp/server.js';

/**
 * Register MCP routes on a router instance.
 * Compatible with the existing route registration pattern in this codebase.
 *
 * @param {object} router   — itty-router or compatible instance
 * @param {object} env      — Cloudflare Worker env
 */
export function registerMCPRoutes(router, env) {
  // MCP JSON-RPC endpoint
  router.post('/mcp', async (req) => mcpRequestHandler(req, env));

  // Convenience: GET /mcp/tools returns the tool manifest as JSON
  router.get('/mcp/tools', async () => {
    const { listMCPTools } = await import('../mcp/tools.js');
    return new Response(JSON.stringify(listMCPTools(), null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  });
}

/**
 * Direct handler: called from the main Worker fetch handler if no router is used.
 * Returns null if the request does not match MCP paths.
 *
 * @param {Request} req
 * @param {object}  env
 * @returns {Response|null}
 */
export async function handleMCPIfMatch(req, env) {
  const url = new URL(req.url);

  if (url.pathname === '/mcp' && req.method === 'POST') {
    return mcpRequestHandler(req, env);
  }

  if (url.pathname === '/mcp/tools' && req.method === 'GET') {
    const { listMCPTools } = await import('../mcp/tools.js');
    return new Response(JSON.stringify(listMCPTools(), null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return null;
}
