const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const name of fs.readdirSync(path.join(root,'public/js'))){
  if(name.endsWith('.js'))cp.execFileSync(process.execPath,['--check',path.join(root,'public/js',name)],{stdio:'inherit'});
}
for(const name of ['index.html','privacy.html']){
  const html=fs.readFileSync(path.join(root,'public',name),'utf8');
  for(const [,url] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(/^(?:https?:|#|\/)/.test(url))continue;
    if(!fs.existsSync(path.join(root,'public',url)))throw Error(`${name}: missing asset ${url}`);
  }
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  if(new Set(ids).size!==ids.length)throw Error(`${name}: duplicate element IDs`);
}
console.log('JavaScript syntax and local HTML asset references passed.');
