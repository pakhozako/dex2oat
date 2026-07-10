import {fs,path,root,releaseEntries,moduleMeta,sevenZip,execFileSync,crypto} from './common.mjs';
const meta=moduleMeta();const version=meta.version.replace(/^v/,'');const output=path.join(root,'dex2oat-lock-v'+version+'.zip');const seven=sevenZip();
try{fs.unlinkSync(output)}catch{}
execFileSync(seven,['a','-tzip','-mx=9',output,...releaseEntries()],{cwd:root,stdio:'inherit'});
const list=execFileSync(seven,['l','-ba',output],{encoding:'utf8'});if(/\.md\b/i.test(list)||/\.zip\s*$/im.test(list))throw new Error('ZIP 包含禁止内容');
const hash=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex').toUpperCase();fs.writeFileSync(output+'.sha256',hash+'  '+path.basename(output)+'\n');console.log(JSON.stringify({path:output,size:fs.statSync(output).size,sha256:hash},null,2));
