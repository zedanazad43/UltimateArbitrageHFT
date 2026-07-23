// ===== COLO-NODE: lightweight colocation + binary wire protocol =====
import { encode, decode } from '@msgpack/msgpack';

function toStr(v) { return String(v ?? ''); }
function toNum(v) { return typeof v === 'number' ? v : Number(v || 0); }
function sideCode(side) { return side === 'SELL' ? 1 : 0; }

function normalizeFrame(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return {
    type: toStr(obj.t),
    symbol: toStr(obj.s).toUpperCase(),
    exchange: toStr(obj.x).toLowerCase(),
    side: obj.sd === 1 ? 'SELL' : 'BUY',
    qty: toNum(obj.q),
    price: toNum(obj.p),
    ts: toNum(obj.ts) || Date.now(),
    version: typeof obj.v === 'number' ? obj.v : 0,
  };
}

export function encodeTradeIntent(msg) {
  if (!msg || typeof msg !== 'object') return encode({ t: 'ping' });
  return encode({
    t: msg.type || 'trade_intent',
    s: toStr(msg.symbol).toUpperCase(),
    x: toStr(msg.exchange).toLowerCase(),
    sd: sideCode(msg.side),
    q: toNum(msg.qty),
    p: toNum(msg.price),
    ts: toNum(msg.ts) || Date.now(),
    v: 1
  });
}

export function decodeWireFrame(buffer) {
  try {
    return normalizeFrame(decode(buffer));
  } catch {
    return null;
  }
}

export { normalizeFrame };

export function makeFrameLatencyMs(ts) {
  if (!ts) return undefined;
  return Math.max(0, Date.now() - ts);
}
