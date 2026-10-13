import * as vscode from 'vscode';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 128;
const MAX_RENDER_BYTES = 32 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

export class PreviewLimitError extends Error {}

export class Resources {
  readonly dependencies = new Set<string>();
  readonly warnings = new Set<string>();
  private readonly reads = new Map<string, Promise<Uint8Array | undefined>>();
  private readonly stats = new Map<string, Promise<vscode.FileStat>>();
  private totalBytes = 0;
  private renderedBytes = 0;

  constructor(readonly root: vscode.Uri) {}

  consume(bytes: number): void {
    this.renderedBytes += bytes;
    if (this.renderedBytes > MAX_RENDER_BYTES) {
      throw new PreviewLimitError('Preview exceeds the 32 MiB rendering budget.');
    }
  }

  resolve(reference: string, base: vscode.Uri): vscode.Uri | undefined {
    // Decode before checking: encoded traversal/separators must obey the same rules.
    let path: string;
    try { path = decodeURIComponent(reference.trim().split(/[?#]/, 1)[0]); }
    catch { return undefined; }
    if (!path || /[\\:%\x00-\x1f\x7f]/.test(path) || path.startsWith('/')) {
      this.warnings.add('Blocked an absolute, external or unsupported resource URL.');
      return undefined;
    }
    const uri = vscode.Uri.joinPath(base, '..', path);
    const prefix = this.root.path.replace(/\/$/, '') + '/';
    if (uri.scheme !== this.root.scheme || uri.authority !== this.root.authority ||
        !uri.path.startsWith(prefix)) {
      this.warnings.add('Blocked a resource outside the project directory.');
      return undefined;
    }
    return uri;
  }

  private stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const key = uri.toString();
    let result = this.stats.get(key);
    if (!result) {
      result = Promise.resolve(vscode.workspace.fs.stat(uri));
      this.stats.set(key, result);
    }
    return result;
  }

  read(uri: vscode.Uri): Promise<Uint8Array | undefined> {
    const prefix = this.root.path.replace(/\/$/, '') + '/';
    if (uri.scheme !== this.root.scheme || uri.authority !== this.root.authority || !uri.path.startsWith(prefix)) {
      this.warnings.add('Blocked a resource outside the project directory.');
      return Promise.resolve(undefined);
    }
    const key = uri.toString();
    this.dependencies.add(key);
    const cached = this.reads.get(key);
    if (cached) { return cached; }
    if (this.reads.size >= MAX_FILES) {
      this.warnings.add('Resource count limit reached (128 files).');
      return Promise.resolve(undefined);
    }
    const result = this.readChecked(uri);
    this.reads.set(key, result);
    return result;
  }

  private async readChecked(uri: vscode.Uri): Promise<Uint8Array | undefined> {
    try {
      // Inspect each component, including ancestors of the project root. Never
      // follow an advertised symlink, even when it points back inside the project.
      const segments = uri.path.split('/').filter(Boolean);
      for (let i = 1; i <= segments.length; i++) {
        const part = uri.with({ path: '/' + segments.slice(0, i).join('/'), query: '', fragment: '' });
        const stat = await this.stat(part);
        if (stat.type & vscode.FileType.SymbolicLink) { throw new Error('Symbolic link'); }
        if (i < segments.length && !(stat.type & vscode.FileType.Directory)) { throw new Error('Not a directory'); }
        if (i === segments.length && (!(stat.type & vscode.FileType.File) || stat.size > MAX_FILE_BYTES)) {
          throw new Error('Not a regular file or too large');
        }
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.totalBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_FILE_BYTES || this.totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('Resource size limit');
      }
      return bytes;
    } catch {
      this.warnings.add('Some local resources could not be read (missing, symlink or size limit).');
      return undefined;
    }
  }

  async asset(reference: string, base: vscode.Uri): Promise<string> {
    const uri = this.resolve(reference, base);
    if (!uri) { return ''; }
    const extension = uri.path.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME[extension];
    if (!mime) {
      this.warnings.add('Blocked an unsupported image or font format.');
      return '';
    }
    const bytes = await this.read(uri);
    if (!bytes) { return ''; }
    this.consume(Math.ceil(bytes.byteLength / 3) * 4);
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }
}
