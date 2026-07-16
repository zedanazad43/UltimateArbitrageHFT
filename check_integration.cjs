const fs=require('fs');
const s=fs.readFileSync('index.js','utf8').toString();
console.log('opportunities/recent count:',s.split('/api/opportunities/recent').length-1);
console.log('cache require count:',s.split('require(\x27./src/infra/cache.js\x27)').length-1);
console.log('DB init count:',s.split('initDb()').length-1);
