const vscode = require('vscode');
const assert = require('node:assert/strict');
const { mkdir, writeFile, mkdtemp, symlink, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Resources, render } = require('../dist/test-api.cjs');
const VIEW = 'adrilasar.staticHtmlPreview';

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(JSON.stringify(vscode.window.tabGroups.all.map(g => ({ column: g.viewColumn, tabs: g.tabs.map(t => ({ active: t.isActive, type: t.input.constructor.name, uri: t.input.uri?.toString(), view: t.input.viewType })) })), null, 2));
  throw new Error('Timed out waiting for the editor');
}
async function waitForPair(uri, groups = 2) {
  await waitFor(() => {
    const left = vscode.window.tabGroups.all.find(g => g.viewColumn === vscode.ViewColumn.One)?.activeTab?.input;
    const right = vscode.window.tabGroups.all.find(g => g.viewColumn === vscode.ViewColumn.Two)?.activeTab?.input;
    return left instanceof vscode.TabInputText && left.uri.toString() === uri.toString() &&
      right instanceof vscode.TabInputCustom && right.viewType === VIEW && right.uri.toString() === uri.toString();
  });
  assert.equal(vscode.window.tabGroups.all.length, groups);
}

exports.run = async function() {
  const results = [];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'html-preview-integration-'));
  const root = vscode.Uri.file(directory);
  const editorConfiguration = vscode.workspace.getConfiguration('workbench.editor');
  const previousDirection = editorConfiguration.get('openSideBySideDirection');
  await editorConfiguration.update('openSideBySideDirection', 'down', vscode.ConfigurationTarget.Global);
  try {
    await mkdir(path.join(directory, 'assets'));
    await writeFile(path.join(directory, 'index.html'), '<link rel="stylesheet" href="assets/theme.css"><h1>Local preview</h1><img src="assets/pixel.svg">');
    await writeFile(path.join(directory, 'assets/theme.css'), 'h1{color:rgb(12,34,56)}');
    await writeFile(path.join(directory, 'assets/pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
    const uri = vscode.Uri.joinPath(root, 'index.html');
    await vscode.commands.executeCommand('vscode.open', uri);
    await waitForPair(uri);
    const layout = await vscode.commands.executeCommand('vscode.getEditorLayout');
    assert.equal(layout.orientation, 0, 'The new groups must be left/right even when beside direction is down.');
    results.push('Local HTML opens source on the left and preview on the right.');

    const secondUri = vscode.Uri.joinPath(root, 'second.htm');
    await writeFile(secondUri.fsPath, '<h1>Second preview</h1>');
    await vscode.commands.executeCommand('vscode.open', secondUri);
    await waitForPair(secondUri);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.One });
    await waitForPair(uri);
    await vscode.commands.executeCommand('vscode.open', uri);
    await waitForPair(uri);
    const previews = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === uri.toString());
    assert.equal(previews.length, 1);
    results.push('Opening another HTML and reopening the first reuses two groups without duplicate previews.');

    const noteUri = vscode.Uri.joinPath(root, 'note.txt');
    await writeFile(noteUri.fsPath, 'Keep this unrelated editor.');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(noteUri), { viewColumn: vscode.ViewColumn.Three, preview: false });
    const thirdUri = vscode.Uri.joinPath(root, 'third.html');
    await writeFile(thirdUri.fsPath, '<h1>Third preview</h1>');
    await vscode.commands.executeCommand('vscode.open', thirdUri, { viewColumn: vscode.ViewColumn.Three });
    await waitForPair(thirdUri, 3);
    const thirdGroup = vscode.window.tabGroups.all.find(g => g.viewColumn === vscode.ViewColumn.Three);
    assert.ok(thirdGroup.tabs.some(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === noteUri.toString()));
    await vscode.window.tabGroups.close(thirdGroup, true);
    await vscode.commands.executeCommand('vscode.open', uri);
    await waitForPair(uri);
    results.push('Opening HTML from a third group preserves unrelated editors and pairs source with preview.');

    const document = await vscode.workspace.openTextDocument(uri);
    const html = await render(document.getText(), uri, new Resources(root));
    assert.match(html, /color:rgb\(12,34,56\)/);
    assert.match(html, /data:image\/svg\+xml;base64/);
    results.push('Real workspace.fs reads relative CSS and SVG images.');

    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString());
    assert.match(vscode.window.activeTextEditor.document.getText(), /Local preview/);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW);
    await waitForPair(uri);
    results.push('Switch to the text editor and back through the editor resolver.');

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), '<h1>Updated preview</h1>');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await document.save());
    await new Promise(r => setTimeout(r, 300));
    assert.match(await render(document.getText(), uri, new Resources(root)), /Updated preview/);
    results.push('Custom and text views share the editable document and save successfully.');

    await symlink(path.join(directory, 'assets'), path.join(directory, 'linked'));
    const resources = new Resources(root);
    assert.equal(await resources.asset('linked/pixel.svg', uri), '');
    assert.ok(resources.warnings.size);
    results.push('The real filesystem provider exposes symlinks and they are rejected.');

    // A real VS Code virtual filesystem, without local disk paths, exercises the
    // same provider-neutral API used with SSH. This is not an actual SSH session.
    const virtualRoot = vscode.Uri.parse('preview-test://remote/project');
    const files = new Map([
      ['/project/index.htm', Buffer.from('<link rel=stylesheet href=theme.css><h1>Virtual preview</h1><img src=pixel.svg>')],
      ['/project/theme.css', Buffer.from('h1{color:blue}')],
      ['/project/pixel.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ]);
    const emitter = new vscode.EventEmitter();
    const registration = vscode.workspace.registerFileSystemProvider('preview-test', {
      onDidChangeFile: emitter.event,
      watch: () => new vscode.Disposable(() => {}),
      stat: async uri => ({ type: files.has(uri.path) ? vscode.FileType.File : vscode.FileType.Directory, size: files.get(uri.path)?.length ?? 0, ctime: 0, mtime: 0 }),
      readFile: async uri => { if (!files.has(uri.path)) throw vscode.FileSystemError.FileNotFound(uri); return files.get(uri.path); },
      readDirectory: async () => [],
      createDirectory: () => { throw vscode.FileSystemError.NoPermissions(); },
      writeFile: () => { throw vscode.FileSystemError.NoPermissions(); },
      delete: () => { throw vscode.FileSystemError.NoPermissions(); },
      rename: () => { throw vscode.FileSystemError.NoPermissions(); },
    }, { isReadonly: true });
    try {
      const remoteUri = vscode.Uri.joinPath(virtualRoot, 'index.htm');
      await vscode.commands.executeCommand('vscode.open', remoteUri);
      await waitForPair(remoteUri);
      const remoteDocument = await vscode.workspace.openTextDocument(remoteUri);
      const remoteHtml = await render(remoteDocument.getText(), remoteUri, new Resources(virtualRoot));
      assert.match(remoteHtml, /color:blue/);
      assert.match(remoteHtml, /data:image\/svg\+xml;base64/);
      await vscode.commands.executeCommand('vscode.openWith', remoteUri, 'default');
      await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === remoteUri.toString());
      results.push('HTML/HTM, relative resources and text switching work through a real virtual filesystem.');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await waitFor(() => vscode.window.tabGroups.all.every(group => group.tabs.length === 0));
      registration.dispose();
      emitter.dispose();
    }
    await writeFile(path.join(__dirname, '../test-output/integration.json'), JSON.stringify({ editorVersion: vscode.version, results }, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await editorConfiguration.update('openSideBySideDirection', previousDirection, vscode.ConfigurationTarget.Global);
    await rm(directory, { recursive: true, force: true });
  }
};
