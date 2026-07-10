import {fs,path,root,toBash,releaseFiles,moduleMeta,read,releaseHash,execFileSync} from './common.mjs';

const meta=moduleMeta();
if(meta.version!=='v6.0'||meta.versionCode!=='600')throw new Error('module.prop version must be v6.0/600');

const files=releaseFiles();
if(files.some(f=>f.endsWith('.md')))throw new Error('release file list contains Markdown');
for(const f of files)if(!fs.existsSync(path.join(root,f)))throw new Error('missing release file: '+f);

const update=read('META-INF/com/google/android/update-binary');
for(const p of ['/data/adb/dex2oat-lock','/data/adb/modules/dex2oat-lock'])if(!update.includes(p))throw new Error('missing preinstall cleanup path: '+p);

const baselinePath=path.join(root,'core/integrity-baseline.prop');
const baselineLines=fs.readFileSync(baselinePath,'utf8').trim().split(/\r?\n/);
if(!baselineLines.includes('meta.baseline_version=1'))throw new Error('invalid integrity baseline version');
if(!baselineLines.includes('meta.format=path|sha256|critical'))throw new Error('invalid integrity baseline format');
const baseline=new Map();
for(const line of baselineLines){
  if(!line||line.startsWith('meta.')||line.startsWith('#'))continue;
  const [file,hash,flag]=line.split('|');
  if(!file||!hash||!['critical','mutable'].includes(flag))throw new Error('invalid baseline row: '+line);
  baseline.set(file,hash);
}
const mutable=new Set(['system.prop','skip_mount','core/integrity-baseline.prop']);
for(const f of files.filter(file=>!mutable.has(file))){
  if(!baseline.has(f))throw new Error('baseline missing critical file: '+f);
  const actual=releaseHash(f);
  if(baseline.get(f)!==actual)throw new Error('baseline drift: '+f);
}

const bash=process.env.BASH_PATH||(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash');
if(!fs.existsSync(bash))throw new Error('Bash is required for shell tests: '+bash);
const bashRoot=toBash(root);
const q=s=>`'${s.replaceAll(`'`,`'\\''`)}'`;
const shell=files.filter(f=>f.endsWith('.sh')||f.endsWith('update-binary'));
for(const f of shell)execFileSync(bash,['-lc',`cd ${q(bashRoot)} && sh -n ${q(f)}`],{stdio:'inherit'});
for(const t of fs.readdirSync(path.join(root,'tests')).filter(x=>x.endsWith('.sh')).sort()){
  execFileSync(bash,['-lc',`cd ${q(bashRoot)} && DEX2OAT_SKIP_SYNC=1 sh ${q('tests/'+t)} ${q(bashRoot)}`],{stdio:'inherit'});
}

const forbiddenMarkers=['TO'+'DO','FIX'+'ME'];
for(const token of forbiddenMarkers)for(const f of files){
  const p=path.join(root,f);
  if(fs.statSync(p).size<1048576&&fs.readFileSync(p,'utf8').includes(token))throw new Error(`${token} marker remains in ${f}`);
}

console.log(JSON.stringify({version:meta.version,files:files.length,status:'ok'},null,2));
