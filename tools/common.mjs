import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const toBash=p=>{const n=p.replaceAll('\\','/');return /^[A-Za-z]:/.test(n)?'/'+n[0].toLowerCase()+n.slice(2):n};
export const read=p=>fs.readFileSync(path.join(root,p),'utf8');
export const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
export const normalizedModuleProp=()=>read('module.prop').replace(/\r/g,'').split('\n').filter(line=>!line.startsWith('description=')).join('\n').replace(/\n+$/,'')+'\n';
export const releaseHash=p=>p==='module.prop'?crypto.createHash('sha256').update(normalizedModuleProp()).digest('hex'):sha(p);
export const moduleMeta=()=>Object.fromEntries(read('module.prop').trim().split(/\r?\n/).map(x=>x.split(/=(.*)/s).slice(0,2)));
export const releaseEntries=()=>read('build/release-files.txt').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
export function walk(rel){const p=path.join(root,rel);const s=fs.statSync(p);if(s.isFile())return [rel.replaceAll('\\','/')];return fs.readdirSync(p).sort().flatMap(n=>walk(path.join(rel,n)));}
export function releaseFiles(){return releaseEntries().flatMap(walk).filter(x=>!x.endsWith('.md')&&!x.endsWith('.zip'));}
export function sevenZip(){for(const p of [process.env.SEVEN_ZIP,'D:/7-Zip/7z.exe','7z']){if(!p)continue;try{execFileSync(p,['-h'],{stdio:'ignore'});return p}catch{}}throw new Error('未找到 7-Zip');}
export {fs,path,crypto,execFileSync};
