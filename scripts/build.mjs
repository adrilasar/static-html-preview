import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js',
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  external: ['vscode'], minify: false,
});
// Keep the bundled parsers' licenses alongside the single runtime file.
const packages = ['parse5', 'entities', 'css-tree', 'source-map-js'];
const notices = await Promise.all(packages.map(async name => {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  const license = await readFile(`node_modules/${name}/LICENSE`, 'utf8');
  return `${name} ${pkg.version}\n${license}`;
}));
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
