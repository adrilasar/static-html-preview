import * as vscode from 'vscode';
import { Resources } from './resources';
import { CSP, escapeHtml, render } from './render';

export const VIEW_TYPE = 'adrian.staticHtmlPreview';

class HtmlPreviewProvider implements vscode.CustomTextEditorProvider {
  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    // No webview filesystem access, scripts, forms, commands or message bridge.
    panel.webview.options = { enableScripts: false, enableForms: false, enableCommandUris: false, localResourceRoots: [] };
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.joinPath(document.uri, '..');
    let dependencies = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let disposed = false;

    const update = async () => {
      const current = ++revision;
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
      revision++;
      if (timer) { clearTimeout(timer); }
      for (const subscription of subscriptions) { subscription.dispose(); }
    });
    await update();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, new HtmlPreviewProvider(), {
    supportsMultipleEditorsPerDocument: true,
  }));
}
