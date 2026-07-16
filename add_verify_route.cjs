const fs=require('fs');
const code=fs.readFileSync('index.js','utf8');
const route=`\napp.get('/rocket-verify', async (c) => {\n  return ok(c, {\n    name: 'Rocket HFT',\n    version: '3.0.0',\n    status: 'operational',\n    timestamp: new Date().toISOString(),\n    features: ['proxy-token-guard','admin-timestamp','rate-limit','opportunity-cache','rocket-dashboard']\n  });\n});\n`;
const marker='initDb();';
const idx=code.lastIndexOf(marker);
if(idx===-1){console.log('MARKER_NOT_FOUND');process.exit(1);}
const newCode=code.slice(0,idx+marker.length)+route+'\n'+code.slice(idx+marker.length);
fs.writeFileSync('index.js',newCode);
console.log('VERIFY_ROUTE_ADDED');
