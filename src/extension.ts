import * as vscode from 'vscode';
import { Resources } from './resources';
import { CSP, escapeHtml, render } from './render';

export const VIEW_TYPE = 'adrilasar.staticHtmlPreview';

class HtmlPreviewProvider implements vscode.CustomTextEditorProvider {
  readonly previews = new Map<string, vscode.WebviewPanel>();

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    // No webview filesystem access, scripts, forms, commands or message bridge.
    panel.webview.options = { enableScripts: false, enableForms: false, enableCommandUris: false, localResourceRoots: [] };
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.joinPath(document.uri, '..');
    let dependencies = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let disposed = false;
    let rendering = false;
    let requested = false;

    const update = async () => {
      requested = true;
      if (rendering) { return; }
      rendering = true;
      try {
        while (requested && !disposed) {
          requested = false;
          const current = revision;
          const resources = new Resources(root);
          let html: string;
          try { html = await render(document.getText(), document.uri, resources); }
          catch (error) {
            html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><p>${escapeHtml(error instanceof Error ? error.message : 'Cannot render this HTML.')}</p></body></html>`;
          }
          if (!disposed && current === revision) {
            dependencies = resources.dependencies;
            panel.webview.html = html;
          }
        }
      } finally { rendering = false; }
    };
    const schedule = () => {
      // Invalidate in-flight renders immediately, before the debounce elapses.
      revision++;
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(() => { void update(); }, 150);
    };
    const matches = (uri: vscode.Uri) => uri.toString() === document.uri.toString() || dependencies.has(uri.toString());
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    const subscriptions = [
      watcher,
      vscode.workspace.onDidChangeTextDocument(e => { if (e.document === document) { schedule(); } }),
      vscode.workspace.onDidSaveTextDocument(d => { if (matches(d.uri)) { schedule(); } }),
      watcher.onDidChange(uri => { if (matches(uri)) { schedule(); } }),
      watcher.onDidCreate(uri => { if (matches(uri)) { schedule(); } }),
      watcher.onDidDelete(uri => { if (matches(uri)) { schedule(); } }),
    ];
    panel.onDidDispose(() => {
      disposed = true;
      if (this.previews.get(document.uri.toString()) === panel) { this.previews.delete(document.uri.toString()); }
      revision++;
      if (timer) { clearTimeout(timer); }
      for (const subscription of subscriptions) { subscription.dispose(); }
    });
    // Reuse the first two groups instead of creating another split for every HTML.
    // Create a right-hand group explicitly, even if the user's beside direction is down.
    // Keep source in the left group before moving preview, so that group stays open.
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    if (!vscode.window.tabGroups.all.some(group => group.viewColumn === vscode.ViewColumn.Two)) {
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
    }
    if (disposed) { return; }
    if (panel.viewColumn !== vscode.ViewColumn.Two) {
      panel.reveal(panel.viewColumn ?? vscode.ViewColumn.One, false);
      await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'group', value: 2 });
    }
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    if (disposed) { return; }
    this.previews.set(document.uri.toString(), panel);
    subscriptions.push(panel.onDidChangeViewState(() => {
      const source = vscode.window.tabGroups.all.find(group => group.viewColumn === vscode.ViewColumn.One)?.activeTab?.input;
      if (!disposed && panel.active && panel.viewColumn === vscode.ViewColumn.Two &&
          source instanceof vscode.TabInputText && source.uri.toString() !== document.uri.toString()) {
        // The tab or filesystem provider may close while activation is pending.
        void vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: true, preview: false }).then(undefined, () => {});
      }
    }));
    await update();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HtmlPreviewProvider();
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
    supportsMultipleEditorsPerDocument: false,
  }), vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor?.viewColumn !== vscode.ViewColumn.One) { return; }
    const panel = provider.previews.get(editor.document.uri.toString());
    if (panel?.viewColumn === vscode.ViewColumn.Two) { panel.reveal(vscode.ViewColumn.Two, true); }
  }));
}
