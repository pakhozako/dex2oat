import {fs,path,root,releaseFiles,releaseHash} from './common.mjs';

const baseline='core/integrity-baseline.prop';
const mutable=new Set(['system.prop','skip_mount',baseline]);
const files=releaseFiles().filter(file=>!mutable.has(file)).sort();
const lines=[
  'meta.baseline_version=1',
  'meta.format=path|sha256|critical',
  'meta.generated_by=tools/integrity.mjs',
  '# Files are critical by default. If a future file is designed to modify itself at runtime, mark it mutable explicitly instead of relying on the critical default.',
  ...files.map(file=>`${file}|${releaseHash(file)}|critical`)
];

fs.writeFileSync(path.join(root,baseline),lines.join('\n')+'\n');
console.log(JSON.stringify({baseline,files:files.length,status:'updated'},null,2));
