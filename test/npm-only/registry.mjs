// Structural receipt: all five actual npm installs, never source/workspace links.
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const prefix='/home/tester/npm-acceptance-prefix';
if(process.env.HOME!=='/home/tester'||process.cwd()!=='/home/tester/npm-acceptance')throw Error('Disposable VM required');
const result={registry:'https://registry.npmjs.org',version:'0.1.0-beta.5',noRepoCheckout:!existsSync('/home/tester/src'),packages:[]};
if(!result.noRepoCheckout)throw Error('Source checkout remains');
for(const short of ['shared','gatekeeper-kit','kernel','gatekeeper-fs','cli']){
  const name='@gatekeeper-os/'+short,root=join(prefix,'lib/node_modules',name);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  if(lstatSync(root).isSymbolicLink()||realpathSync(root)!==root||pkg.name!==name||pkg.version!==result.version)throw Error('Registry installation identity mismatch');
  const view=spawnSync('npm',['view',name+'@'+result.version,'version','dist','dist-tags','time','--json','--registry='+result.registry],{encoding:'utf8',timeout:60000});
  if(view.status!==0)throw Error('Registry receipt lookup failed');
  const meta=JSON.parse(view.stdout);
  if(meta.version!==pkg.version||!meta.dist.tarball.startsWith(result.registry+'/'))throw Error('Registry metadata identity mismatch');
  const listingResponse=await fetch(result.registry+'/'+name.replace('/','%2f'));
  if(!listingResponse.ok)throw Error('Registry listing unavailable');
  const listing=await listingResponse.json();
  if(!listing.versions?.[pkg.version]||listing['dist-tags']?.beta!==pkg.version||listing['dist-tags']?.latest!==pkg.version||!listing.time?.[pkg.version])throw Error('Registry listing/tags/time mismatch');
  const archiveResponse=await fetch(meta.dist.tarball);
  if(!archiveResponse.ok)throw Error('Registry archive unavailable');
  const digest=createHash('sha512').update(Buffer.from(await archiveResponse.arrayBuffer())).digest();
  if('sha512-'+digest.toString('base64')!==meta.dist.integrity||listing.versions[pkg.version].dist.integrity!==meta.dist.integrity)throw Error('Registry archive SHA512 mismatch');
  result.packages.push({archiveSHA512:digest.toString('hex'),listingVerified:true,name,version:pkg.version,distTags:meta['dist-tags'],publishedAt:meta.time[pkg.version],tarball:meta.dist.tarball,integrity:meta.dist.integrity,regularRegistryInstall:true});
}
writeFileSync('/home/tester/npm-acceptance-evidence/registry.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log('PASS five-registry-package-identities-no-checkout');
