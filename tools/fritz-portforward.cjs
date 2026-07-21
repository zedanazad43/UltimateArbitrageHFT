#!/usr/bin/env node
/**
 * fritz-portforward.cjs — FRITZ!Box port-forward via TR-064 (Digest auth).
 * Forwards 192.168.178.68:8080 (this PC) → public IP :8080 TCP.
 * Enables the Worker to reach the local gateway via the German public IP,
 * so geo-blocked exchanges (Binance/KuCoin/Bitget) work.
 *
 * Run:  node tools/fritz-portforward.cjs
 * Env:  FRITZ_USER, FRITZ_PASS (or files C:\Users\azadz\.fritz_user / .fritz_pass)
 *       FRITZ_BOX=192.168.178.1, LAN_IP=192.168.178.68, EXT_PORT=8080, INT_PORT=8080
 */
const http = require('http');
const fs = require('fs');
const _path = require('path');

const BOX = process.env.FRITZ_BOX || '192.168.178.1';
const LAN_IP = process.env.LAN_IP || '192.168.178.68';
const EXT_PORT = process.env.EXT_PORT || '8080';
const INT_PORT = process.env.INT_PORT || '8080';
const USER = process.env.FRITZ_USER || (fs.existsSync('C:/Users/azadz/.fritz_user') ? fs.readFileSync('C:/Users/azadz/.fritz_user', 'utf8').trim() : '');
const PASS = process.env.FRITZ_PASS || (fs.existsSync('C:/Users/azadz/.fritz_pass') ? fs.readFileSync('C:/Users/azadz/.fritz_pass', 'utf8').trim() : '');

if (!USER || !PASS) { console.error('[fritz] missing FRITZ_USER/FRITZ_PASS'); process.exit(1); }

const SOAP = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:AddPortMapping xmlns:u="urn:dslforum-org:service:WANIPConnection:1"><NewRemoteHost></NewRemoteHost><NewExternalPort>${EXT_PORT}</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>${INT_PORT}</NewInternalPort><NewInternalClient>${LAN_IP}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>Hermes-Gateway</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>`;

function digestAuth(path, body, _creds, _realmNonce) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: BOX, port: 49000, path, method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'urn:dslforum-org:service:WANIPConnection:1#AddPortMapping',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode === 401 && res.headers['www-authenticate']) {
          // Parse Digest challenge
          const auth = res.headers['www-authenticate'];
          const realm = (auth.match(/realm="([^"]+)"/) || [])[1];
          const nonce = (auth.match(/nonce="([^"]+)"/) || [])[1];
          const opaque = (auth.match(/opaque="([^"]+)"/) || [])[1] || '';
          const ha1 = md5(`${USER}:${realm}:${PASS}`);
          const ha2 = md5(`POST:${path}`);
          const response = md5(`${ha1}:${nonce}:${ha2}`);
          const authHeader = `Digest username="${USER}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
          const req2 = http.request({
            host: BOX, port: 49000, path, method: 'POST',
            headers: {
              'Content-Type': 'text/xml',
              'SOAPAction': 'urn:dslforum-org:service:WANIPConnection:1#AddPortMapping',
              'Content-Length': Buffer.byteLength(body),
              'Authorization': authHeader,
            },
          }, (res2) => {
            let d2 = '';
            res2.on('data', (c) => (d2 += c));
            res2.on('end', () => {
              if (d2.includes('AddPortMappingResponse') || d2.includes('errorCode>0')) resolve(d2);
              else if (d2.includes('errorCode')) reject(new Error('FRITZ error: ' + d2.match(/errorDescription>([^<]+)/)?.[1]));
              else resolve(d2);
            });
          });
          req2.write(body);
          req2.end();
        } else if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function md5(s) {
  // minimal md5 for Digest (use crypto if available)
  try { return require('crypto').createHash('md5').update(s).digest('hex'); }
  catch { const c = require('child_process').execSync(`echo -n "${s}" | md5sum`).toString().split(' ')[0]; return c; }
}

console.log(`[fritz] forwarding ${LAN_IP}:${INT_PORT} → public:${EXT_PORT} on ${BOX}`);
digestAuth('/upnp/control/wanipconnection1', SOAP)
  .then((r) => { console.log('[fritz] SUCCESS:', r.includes('AddPortMappingResponse') ? 'port mapped' : r.slice(0, 120)); process.exit(0); })
  .catch((e) => { console.error('[fritz] FAILED:', e.message); process.exit(1); });
