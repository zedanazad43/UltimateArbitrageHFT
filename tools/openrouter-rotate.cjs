const fs=require('fs');
const keyFile='C:/Users/azadz/.openrouter_key';
function current(){try{return fs.readFileSync(keyFile,'utf8').trim()}catch{return null}}
async function checkCredits(key){
  const r=await fetch('https://openrouter.ai/api/v1/credits',{headers:{'Authorization':'Bearer '+key}});
  if(!r.ok) return -1;
  const j=await r.json();
  return (j.data?.total_credits||0)-(j.data?.total_usage||0);
}
(async()=>{
  const cur=current();
  console.log('Current key:',cur?cur.slice(0,8)+'...':'MISSING');
  if(cur){
    const credits=await checkCredits(cur);
    console.log('Credits:',credits);
    if(credits<0) console.log('WARNING: credits negative - regenerate at openrouter.ai/keys');
  }
})();
