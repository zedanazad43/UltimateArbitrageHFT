// Cloudflare Worker: minimal edge wrapper
/* global WORKER_BACKEND */
const API_BASE = (typeof WORKER_BACKEND !== 'undefined' && WORKER_BACKEND) || 'http://localhost:3001';
addEventListener('fetch', event => { event.respondWith(handleRequest(event.request)); });
async function handleRequest(req) {
  const url = new URL(req.url);
  if (url.pathname === '/' || url.pathname === '/api/agent') {
    const payload = { name: 'Hero Super Agent (Edge)', description: 'Edge wrapper', features:['proxy','metadata'] };
    return new Response(JSON.stringify({ success:true, payload }), { headers: {'Content-Type':'application/json'} });
  }
  const proxied = new Request(API_BASE + url.pathname + url.search, { method: req.method, headers: req.headers, body: req.body });
  const resp = await fetch(proxied);
  return resp;
}
