const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const { URI, Utils } = require('vscode-uri');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');

buildSync({ stdin: { contents: "export * from './src/render'; export * from './src/resources'; export * from './src/extension';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: 'dist/test-api.cjs' });
const files = new Map();
const links = new Set();
const reads = [];
const changes = [];
const saves = [];
const watchers = [];
const shownDocuments = [];
const revealedColumns = [];
let provider;
const subscribe = (list, callback) => {
  list.push(callback);
  return { dispose: () => list.splice(list.indexOf(callback), 1) };
};
const mock = {
  Uri: { parse: URI.parse, file: URI.file, joinPath: Utils.joinPath },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  ViewColumn: { One: 1, Two: 2 },
  commands: { executeCommand: async (id, args) => {
    if (id === 'workbench.action.newGroupRight') { mock.window.tabGroups.all.push({ viewColumn: 2 }); }
    else { assert.equal(id, 'moveActiveEditor'); assert.deepEqual(args, { to: 'position', by: 'group', value: 2 }); revealedColumns.push(2); }
  } },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  workspace: {
    fs: {
      stat: async uri => {
        if (links.has(uri.toString())) { return { type: 66, size: 0, ctime: 0, mtime: 0 }; }
        if (files.has(uri.toString())) { return { type: 1, size: files.get(uri.toString()).length, ctime: 0, mtime: 0 }; }
        if ([...files.keys()].some(k => k.startsWith(uri.toString().replace(/\/$/, '') + '/'))) { return { type: 2, size: 0, ctime: 0, mtime: 0 }; }
        throw new Error('Missing');
      },
      readFile: async uri => { reads.push(uri.toString()); if (!files.has(uri.toString())) throw new Error('Missing'); return files.get(uri.toString()); },
    },
    getWorkspaceFolder: () => undefined,
    onDidChangeTextDocument: callback => subscribe(changes, callback),
    onDidSaveTextDocument: callback => subscribe(saves, callback),
    createFileSystemWatcher: () => {
      const events = { change: [], create: [], delete: [] };
      const watcher = {
        onDidChange: cb => subscribe(events.change, cb), onDidCreate: cb => subscribe(events.create, cb), onDidDelete: cb => subscribe(events.delete, cb),
        dispose() { this.disposed = true; }, events,
      };
      watchers.push(watcher);
      return watcher;
    },
  },
  window: {
    tabGroups: { all: [{ viewColumn: 1 }] },
    showTextDocument: async (document, options) => { shownDocuments.push({ document, options }); },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    registerCustomEditorProvider: (id, p) => { assert.equal(id, 'adrilasar.staticHtmlPreview'); provider = p; return { dispose() {} }; },
  },
};
const load = Module._load;
Module._load = function(id, ...args) { return id === 'vscode' ? mock : load.call(this, id, ...args); };
const { Resources, render, CSP, activate } = require('../dist/test-api.cjs');
Module._load = load;
const put = (base, path, contents) => files.set(Utils.joinPath(base, path).toString(), Buffer.from(contents));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const setup = (scheme = 'file') => {
  files.clear(); links.clear(); reads.length = 0;
  const root = URI.parse(scheme === 'file' ? 'file:///project' : `${scheme}://ssh-remote+ubuntu/home/adrian/project`);
  const uri = Utils.joinPath(root, 'pages/index.html');
  put(root, 'pages/index.html', '<h1>Preview</h1>');
  put(root, 'assets/image.png', png);
  return { root, uri, resources: new Resources(root) };
};

for (const scheme of ['file', 'vscode-remote']) {
  test(`${scheme}: relative HTML, CSS, imports, image and font resources`, async () => {
    const { root, uri, resources } = setup(scheme);
    put(root, 'styles/main.css', '@import "nested/theme.css" screen; h1{color:rgb(12,34,56);background:url(../assets/image.png)} @font-face{font-family:Test;src:url(../assets/font.woff2)}');
    put(root, 'styles/nested/theme.css', 'p{border:1px solid red}');
    put(root, 'assets/font.woff2', 'test font');
    const html = await render('<link rel="stylesheet" href="../styles/main.css"><h1>Preview</h1><p style="background:url(../assets/image.png)">CSS</p><img src="../assets/image.png">', uri, resources);
    assert.match(html, /color:rgb\(12,34,56\)/);
    assert.match(html, /@media screen\{p\{border:1px solid red\}\}/);
    assert.match(html, /data:image\/png;base64/);
    assert.match(html, /data:font\/woff2;base64/);
    assert.ok(reads.every(k => k.startsWith(root.toString() + '/')));
    assert.equal(resources.warnings.size, 0);
  });
}

test('Windows URI and percent-encoded filenames preserve the correct filesystem', async () => {
  files.clear(); links.clear();
  const root = URI.parse('file:///c:/Users/Adrian/project');
  const uri = Utils.joinPath(root, 'index.htm');
  put(root, 'index.htm', ''); put(root, 'my image.png', png);
  const html = await render('<img src="my%20image.png">', uri, new Resources(root));
  assert.match(html, /data:image\/png/);
});

test('Traversal, schemes, authorities, absolute paths and encoded separators fail closed', async () => {
  const { uri, resources } = setup();
  const references = ['../../secret.png', '%2e%2e/%2e%2e/secret.png', '%252e%252e/secret.png', 'https://evil.test/image.png', '//evil.test/image.png', '/etc/secret.png', 'file:///etc/secret.png', 'vscode-remote://another/etc/secret.png', 'C:\\secret.png', '..%5c..%5csecret.png', '%00image.png', '%0aimage.png', 'data:image/svg+xml,evil', 'command:workbench.action'];
  for (const ref of references) assert.equal(resources.resolve(ref, uri), undefined, ref);
  assert.equal(await resources.read(URI.parse('file:///secret.png')), undefined);
  assert.equal(reads.length, 0);
});

test('Symlink components, including ancestors of the project, are not read', async () => {
  const { root, uri, resources } = setup();
  links.add(Utils.joinPath(root, 'assets').toString());
  assert.equal(await resources.asset('../assets/image.png', uri), '');
  assert.equal(reads.length, 0);
  links.clear(); links.add(root.toString());
  assert.equal(await new Resources(root).asset('../assets/image.png', uri), '');
  assert.equal(reads.length, 0);
});

test('HTML navigation, scripts, events, forms, base, meta, embeds and foreign namespaces are removed', async () => {
  const { uri, resources } = setup();
  const html = await render(`<meta http-equiv="refresh" content="0;url=https://evil.test"><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://evil.test"><script>globalThis.pwned=1</script><iframe srcdoc="<script>evil()</script>"></iframe><object data="https://evil.test"></object><form action="https://evil.test"><input autofocus></form><a href="command:evil" ping="https://evil.test" target="_blank">Link</a><img src="https://evil.test" onerror="evil()" srcset="https://evil.test 2x"><svg><script>evil()</script></svg><math><annotation-xml encoding="text/html"><script>evil()</script></annotation-xml></math><h1 onclick="evil()">Safe</h1>`, uri, resources);
  assert.match(html, /<h1>Safe<\/h1>/);
  assert.doesNotMatch(html, /<script|<iframe|<object|<form|<input|<base|<svg|<math|onerror|onclick|srcset|href=|ping=|https:\/\/evil/);
  assert.equal((html.match(/Content-Security-Policy/g) || []).length, 1);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<style'));
  assert.match(CSP, /script-src 'none'/);
});

test('Malformed HTML, namespace switching and style end tags cannot introduce executable markup', async () => {
  const { uri, resources } = setup();
  for (const source of [
    '<noscript><img src=x onerror=evil()></noscript><h1>ok</h1>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=evil()>">',
    '<style>a{content:"</style><script>evil()</script>"}</style>',
    '<div style="color:red&quot; onclick=&quot;evil()">ok</div>',
  ]) {
    const html = await render(source, uri, resources);
    assert.doesNotMatch(html, /<script|<img[^>]*onerror|<div[^>]* onclick="/);
  }
});

test('CSS escapes, custom properties and repeated URLs are handled without unsafe URL copying', async () => {
  const { uri, resources } = setup();
  const html = await render(String.raw`<style>h1{--image:url(../assets/im\61 ge.png);background:var(--image)}p{background:url(https://evil.test)}b{background:u\72l(https://evil.test)}i{background:image-set("https://evil.test" 1x)}</style><h1>Hello</h1>`, uri, resources);
  assert.match(html, /--image:url\(data:image\/png/);
  assert.doesNotMatch(html, /evil\.test/);
});

test('CSS import cycles terminate and local resource bytes are cached within each render', async () => {
  const { root, uri, resources } = setup();
  put(root, 'styles/a.css', '@import "b.css";a{color:red}');
  put(root, 'styles/b.css', '@import "a.css";b{color:blue}');
  const html = await render('<link rel=stylesheet href=../styles/a.css><img src=../assets/image.png><img src=../assets/image.png>', uri, resources);
  assert.match(html, /color:red/);
  assert.equal(reads.filter(k => k.endsWith('/image.png')).length, 1);
  assert.equal(reads.filter(k => k.endsWith('.css')).length, 2);
});

test('Linked and inline styles retain media conditions', async () => {
  const { root, uri, resources } = setup();
  put(root, 'styles/print.css', 'h1{color:red}');
  const html = await render('<link rel=stylesheet href=../styles/print.css media=print><style media="(max-width:600px)">h1{color:blue}</style><h1>Media</h1>', uri, resources);
  assert.match(html, /<style media="print">h1\{color:red\}/);
  assert.match(html, /<style media="\(max-width:600px\)">h1\{color:blue\}/);
});

test('Limits reject oversized files, oversized HTML and deeply nested HTML', async () => {
  const { root, uri, resources } = setup();
  put(root, 'assets/large.png', Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.equal(await resources.asset('../assets/large.png', uri), '');
  assert.equal(reads.length, 0);
  await assert.rejects(render('x'.repeat(1024 * 1024 + 1), uri, resources), /1 MiB/);
  await assert.rejects(render('<div>'.repeat(300), uri, resources), /nesting/);
});

test('Missing referenced files stay tracked so creation can refresh the preview', async () => {
  const { root, uri, resources } = setup();
  await render('<img src=../assets/missing.png>', uri, resources);
  assert.ok(resources.dependencies.has(Utils.joinPath(root, 'assets/missing.png').toString()));
  assert.ok(resources.warnings.size);
  assert.ok([...resources.warnings].some(w => w.includes('assets/missing.png') && w.includes('missing or unreadable')));
});

test('Repeated embedding of a cached resource cannot expand the preview without a limit', async () => {
  const { root, uri, resources } = setup();
  put(root, 'assets/large.png', Buffer.alloc(2 * 1024 * 1024));
  await assert.rejects(render('<img src=../assets/large.png>'.repeat(20), uri, resources), /rendering budget/);
  assert.equal(reads.filter(k => k.endsWith('/large.png')).length, 1);
});

test('Provider registers, disables webview access, refreshes HTML/CSS and disposes subscriptions', async () => {
  const { root, uri } = setup();
  put(root, 'pages/theme.css', 'h1{color:red}');
  let source = '<link rel=stylesheet href=theme.css><h1>First</h1>';
  const document = { uri, getText: () => source };
  let dispose;
  const panel = { webview: { html: '', options: {} }, onDidDispose: cb => { dispose = cb; }, onDidChangeViewState: () => ({ dispose() {} }), reveal: column => revealedColumns.push(column) };
  activate({ subscriptions: [] });
  await provider.resolveCustomTextEditor(document, panel);
  assert.deepEqual(panel.webview.options, { enableScripts: false, enableForms: false, enableCommandUris: false, localResourceRoots: [] });
  assert.match(panel.webview.html, /First/);
  assert.equal(mock.window.tabGroups.all.length, 2);
  assert.equal(revealedColumns.at(-1), 2);
  assert.equal(shownDocuments.at(-1).options.viewColumn, 1);
  source = '<link rel=stylesheet href=theme.css><h1>Changed</h1>';
  changes[0]({ document });
  await new Promise(r => setTimeout(r, 200));
  assert.match(panel.webview.html, /Changed/);
  put(root, 'pages/theme.css', 'h1{color:blue}');
  saves[0]({ uri: Utils.joinPath(root, 'pages/theme.css') });
  await new Promise(r => setTimeout(r, 200));
  assert.match(panel.webview.html, /color:blue/);
  dispose();
  assert.equal(changes.length, 0); assert.equal(saves.length, 0); assert.ok(watchers.at(-1).disposed);
});

test('Manifest provides HTML/HTM custom editor and workspace extension host', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(manifest.extensionKind[0], 'workspace');
  assert.equal(manifest.contributes.customEditors[0].priority, 'default');
  assert.equal(manifest.contributes.customEditors[0].viewType, 'adrilasar.staticHtmlPreview');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.publisher, 'adrilasar');
});

test('Slow resource reads serialize updates and publish only the latest HTML', async () => {
  const { root, uri } = setup();
  put(root, 'pages/theme.css', 'h1{color:red}');
  let source = '<link rel=stylesheet href=theme.css><h1>Initial</h1>';
  const document = { uri, getText: () => source };
  let dispose;
  const panel = { webview: { html: '', options: {} }, onDidDispose: cb => { dispose = cb; }, onDidChangeViewState: () => ({ dispose() {} }), reveal() {} };
  await provider.resolveCustomTextEditor(document, panel);
  const originalRead = mock.workspace.fs.readFile;
  let release;
  let started;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let active = 0;
  let maximum = 0;
  let first = true;
  mock.workspace.fs.readFile = async resource => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      if (first) { first = false; started(); await blocked; }
      return await originalRead(resource);
    } finally { active--; }
  };
  try {
    source = '<link rel=stylesheet href=theme.css><h1>Outdated</h1>';
    changes[0]({ document });
    await entered;
    source = '<link rel=stylesheet href=theme.css><h1>Latest</h1>';
    changes[0]({ document });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(maximum, 1);
    assert.doesNotMatch(panel.webview.html, /Outdated/);
    release();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(panel.webview.html, /Latest/);
    assert.equal(maximum, 1);
  } finally {
    release();
    mock.workspace.fs.readFile = originalRead;
    dispose();
  }
});

test('Produce the exact renderer output for browser validation', async () => {
  const { root, uri, resources } = setup();
  let fontCss = '';
  if (process.env.HTML_PREVIEW_TEST_FONT) {
    put(root, 'assets/test.woff2', readFileSync(process.env.HTML_PREVIEW_TEST_FONT));
    fontCss = '@font-face{font-family:PreviewTest;src:url(../assets/test.woff2)}h1{font-family:PreviewTest}';
  }
  put(root, 'styles/main.css', fontCss + 'h1{color:rgb(12,34,56)}.tile{background-image:url(../assets/image.png);padding:12px}');
  const html = await render('<link rel=stylesheet href=../styles/main.css><h1>Static HTML Preview</h1><p class=tile style="border:2px solid rgb(22,99,44)">CSS relativo e inline</p><img alt="Imagen local" src=../assets/image.png><script>globalThis.pwned=1</script><a href="https://example.com">Enlace desactivado</a>', uri, resources);
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/browser.html', html);
});
