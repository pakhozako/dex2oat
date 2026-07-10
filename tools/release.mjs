import {execFileSync} from 'node:child_process';
for(const script of ['tools/integrity.mjs','tools/verify.mjs','tools/build.mjs']){
  execFileSync(process.execPath,[script],{stdio:'inherit'});
}
