// Build reviewed first-party runtime artifacts, with workspace libraries bundled and only public SDK imports external.
import { build } from 'tsup';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const destination = join(root, 'packages/clawos-cli/templates/plugins');
const typeboxLicense = readFileSync(join(root, 'packages/gatekeeper-fs/node_modules/typebox/license'), 'utf8');

for (const [dir, id] of [['clawos-kernel', 'clawos-kernel'], ['gatekeeper-fs', 'gatekeeper-fs']]) {
  const source = join(root, 'packages', dir), target = join(destination, id);
  mkdirSync(target, {recursive:true});

  await build({
    entry:[join(source, 'src/index.ts')],
    outDir:join(target, 'dist'),
    format:['esm'],
    target:'node22',
    splitting:false,
    sourcemap:false,
    noExternal:[/@clawkeepers\//, /^typebox/],
    external:['openclaw', 'openclaw/*'],
    clean:true,
    silent:true,
  });

  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  if (pkg.license !== 'MIT') throw new Error(`${dir}: expected reviewed MIT license metadata`);
  const license = pkg.license;
  writeFileSync(
    join(target, 'package.json'),
    JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      type: 'module',
      main: './dist/index.js',
      license,
      openclaw: pkg.openclaw,
    })
  );
  copyFileSync(join(source, 'openclaw.plugin.json'), join(target, 'openclaw.plugin.json'));
  for (const file of ['LICENSE', 'NOTICE']) {
    copyFileSync(join(source, file), join(target, file));
  }
  if (existsSync(join(source, 'config.schema.json'))) copyFileSync(join(source, 'config.schema.json'), join(target, 'config.schema.json'));
  writeFileSync(join(target, 'THIRD-PARTY-NOTICES'), typeboxLicense);
}

// Static metadata only: these two modules cannot start the gatekeeper or import upstream.
const metadata = join(destination, 'metadata');
await build({
  entry:{
    tools:join(root, 'packages/gatekeeper-fs/src/tools.ts'),
    resources:join(root, 'packages/gatekeeper-fs/src/resources.ts'),
  },
  outDir:metadata,
  format:['esm'],
  splitting:false,
  noExternal:[/@clawkeepers\//,/^typebox/],
  silent:true,
});

const {fsTools} = await import(pathToFileURL(join(metadata, 'tools.js')).href);
const {fsResources} = await import(pathToFileURL(join(metadata, 'resources.js')).href);
writeFileSync(join(destination, 'catalog.json'), JSON.stringify({
  version: 1,
  gatekeepers: [{pluginId: 'gatekeeper-fs', vendor: 'fs', apiVersion: 1, tools: fsTools, resources: fsResources}],
}));
rmSync(metadata, {recursive:true});

// Independent executable payload: no dependency on npm's potentially group-writable installation tree.
await build({
  entry:{'install-policy':join(root, 'packages/clawos-cli/src/policy-entry.ts')},
  outDir:destination,
  format:['esm'],
  outExtension:()=>({js:'.mjs'}),
  target:'node22',
  splitting:false,
  noExternal:[/@clawkeepers\//,/^typebox/],
  silent:true,
});
copyFileSync(join(root, 'packages/gatekeeper-fs/node_modules/typebox/license'), join(destination, 'THIRD-PARTY-NOTICES'));
