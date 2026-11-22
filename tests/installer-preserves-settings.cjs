'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const source=fs.readFileSync('install.sh','utf8');
const begin=source.indexOf('backup_data_dir() {');
const end=source.indexOf('\ninstall_service() {',begin);
assert(begin>0&&end>begin,'backup function not found');
const fn=source.slice(begin,end);
for(const field of ['state.json','state.json.bak','config.yaml'])
  assert(source.includes(field),'missing saved settings field '+field);
assert(fn.includes('tar -tzf'),'snapshot must be verified');
assert(fn.includes('restart_panel_service'),'upgrade must restart old service on backup failure');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const payload={outbounds:[{kind:'group',name:'Russia',type:'url-test',timeout:8000,tolerance:100}],
  outboundSubscriptions:[{id:'sub1',name:'Provider',filterKeep:'🇵🇱',filterExclude:'🇷🇺',intervalMinutes:1440}],
  routingRules:[{id:'rule1',type:'MATCH',target:'Russia'}],mihomoBasics:{mode:'rule'}};
function scenario(breakArchive){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mui-settings-backup-'));
 try{
  const data=path.join(dir,'data'),backup=path.join(data,'backups'),marker=path.join(dir,'restarted');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data,'state.json'),JSON.stringify(payload));
  fs.writeFileSync(path.join(data,'state.json.bak'),JSON.stringify(payload));
  fs.writeFileSync(path.join(data,'config.yaml'),'proxy-groups: []\n');
  const lines=[
    'set -Eeuo pipefail',
    'DATA_DIR='+quote(data),
    'BACKUP_DIR='+quote(backup),
    'NO_BACKUP=0; BACKUP_KEEP=3',
    'BACKUP_FILES=(state.json state.json.bak config.yaml)',
    'info(){ :; }',
    'warn(){ :; }',
    'restart_panel_service(){ echo restored >> '+quote(marker)+'; }',
    'die(){ echo FAIL_CLOSED >&2; exit 77; }',
    'prune_backups(){ :; }',
    fn
  ];
  if(breakArchive)lines.push('tar(){ if [[ "$1" == "-czf" ]]; then echo truncated > "$2"; return 42; fi; command tar "$@"; }');
  lines.push('backup_data_dir');
  const result=cp.spawnSync('bash',['-c',lines.join('\n')],{encoding:'utf8',timeout:15000});
  const copies=fs.existsSync(backup)?fs.readdirSync(backup).filter(x=>x.endsWith('.tar.gz')):[];
  if(breakArchive){
   assert.equal(result.status,77,result.stderr);
   assert.match(result.stderr,/FAIL_CLOSED/);
   assert(fs.existsSync(marker),'old panel must restart after failed snapshot');
   assert.equal(copies.length,0,'broken snapshot must not pass as verified');
  }else{
   assert.equal(result.status,0,result.stderr);
   assert.equal(copies.length,1,'one verified snapshot expected');
   assert(!fs.existsSync(marker),'successful snapshot does not restart old panel');
   const archived=cp.execFileSync('tar',['-xOzf',path.join(backup,copies[0]),'state.json']);
   assert.deepEqual(JSON.parse(archived.toString()),payload);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8')),payload);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
scenario(false);
scenario(true);
console.log('PASS: successful snapshot preserves subscriptions/balancers/filters; failed backup aborts update and restores panel');
