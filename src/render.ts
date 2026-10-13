import * as vscode from 'vscode';
import { parse, serialize, defaultTreeAdapter, html as parse5Html, type DefaultTreeAdapterMap } from 'parse5';
import type { Url, Atrule, List, ListItem, CssNode } from 'css-tree';
import { Resources, PreviewLimitError } from './resources';

// Import only parsing/traversal/serialization; omit the large CSS syntax database.
const css: Pick<typeof import('css-tree'), 'parse' | 'walk' | 'generate'> = {
  parse: require('css-tree/parser'), walk: require('css-tree/walker'), generate: require('css-tree/generator'),
};

export const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'";
const HTML_NS = parse5Html.NS.HTML;
const TAGS = new Set(('html head body title style a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark menu nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td th thead time tr u ul var wbr').split(' '));
const ATTRS = new Set(('id class title lang dir hidden role width height alt colspan rowspan scope span datetime open start reversed type value align valign bgcolor border cellpadding cellspacing media').split(' '));
type Element = DefaultTreeAdapterMap['element'];
type Parent = DefaultTreeAdapterMap['parentNode'];

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function stylesheet(source: string, base: vscode.Uri, resources: Resources, inline = false, chain: string[] = []): Promise<string> {
  try {
    resources.consume(Buffer.byteLength(source, 'utf8'));
    const ast = css.parse(source, { context: inline ? 'declarationList' : 'stylesheet', parseCustomProperty: true });
    const urls: Url[] = [];
    const imports: { node: Atrule; list: List<CssNode>; item: ListItem<CssNode> }[] = [];
    css.walk(ast, function(node, item, list) {
      if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && item && list) {
        imports.push({ node, item, list });
        return css.walk.skip;
      }
      // Raw/unparsed CSS is dropped. Strings in image-set() can be URLs without
      // url(); dropping that function prevents unvalidated embedded data SVGs.
      if (node.type === 'Raw' || (node.type === 'Function' && /^(?:-webkit-)?image-set$/i.test(node.name))) {
        if (node.type === 'Raw') { node.value = ''; }
        if (item && list) { list.remove(item); }
        return css.walk.skip;
      }
      if (node.type === 'Url') { urls.push(node); }
    });
    for (const { node, list, item } of imports) {
      const first = node.prelude?.type === 'AtrulePrelude' ? node.prelude.children.first : null;
      const reference = first?.type === 'Url' || first?.type === 'String' ? first.value : '';
      const uri = resources.resolve(reference, base);
      let imported = '';
      if (uri && chain.length < 16 && !chain.includes(uri.toString())) {
        const bytes = await resources.read(uri);
        if (bytes) {
          imported = await stylesheet(Buffer.from(bytes).toString('utf8'), uri, resources, false, [...chain, uri.toString()]);
        }
      }
      // Only ordinary imports and media-qualified imports are supported.
      const rest = node.prelude?.type === 'AtrulePrelude'
        ? node.prelude.children.toArray().slice(1) : [];
      if (rest.length && !rest.every(n => n.type === 'MediaQueryList')) { imported = ''; }
      if (imported && rest.length) { imported = `@media ${rest.map(n => css.generate(n)).join(' ')}{${imported}}`; }
      if (imported) {
        const replacement = css.parse(imported);
        if (replacement.type === 'StyleSheet') { list.insertList(replacement.children, item); }
      }
      list.remove(item);
    }
    for (const url of urls) {
      url.value = url.value.startsWith('#') ? url.value : await resources.asset(url.value, base);
    }
    // HTML raw-text style elements cannot contain an unescaped closing tag.
    const result = css.generate(ast).replace(/</g, '\\3c ');
    resources.consume(Buffer.byteLength(result, 'utf8'));
    return result;
  } catch (error) {
    if (error instanceof PreviewLimitError) { throw error; }
    resources.warnings.add('Skipped invalid or unsupported CSS.');
    return '';
  }
}

export async function render(source: string, uri: vscode.Uri, resources: Resources): Promise<string> {
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) { throw new Error('HTML exceeds the 1 MiB preview limit.'); }
  resources.consume(Buffer.byteLength(source, 'utf8'));
  const document = parse(source, { scriptingEnabled: false });
  // Iterative traversal also handles deeply nested, hostile input.
  const parents: { parent: Parent; depth: number }[] = [{ parent: document, depth: 0 }];
  let nodes = 0;
  while (parents.length) {
    const { parent, depth } = parents.pop()!;
    if (depth > 256) { throw new Error('HTML exceeds the 256 level nesting limit.'); }
    const children: typeof parent.childNodes = [];
    for (const node of parent.childNodes) {
      if (++nodes > 20_000) { throw new Error('HTML exceeds the 20,000 node preview limit.'); }
      if (node.nodeName === '#text') { children.push(node); continue; }
      if (!('tagName' in node)) { continue; }
      const element = node as Element;
      if (element.namespaceURI !== HTML_NS) { continue; }
      const attrs = new Map(element.attrs.map(a => [a.name, a.value]));
      if (element.tagName === 'link' && attrs.get('rel')?.toLowerCase() === 'stylesheet') {
        const cssUri = resources.resolve(attrs.get('href') ?? '', uri);
        const bytes = cssUri ? await resources.read(cssUri) : undefined;
        if (bytes && cssUri) {
          const style = defaultTreeAdapter.createElement('style', HTML_NS, attrs.has('media') ? [{ name: 'media', value: attrs.get('media')! }] : []);
          defaultTreeAdapter.insertText(style, await stylesheet(Buffer.from(bytes).toString('utf8'), cssUri, resources));
          style.parentNode = parent;
          children.push(style);
        }
        continue;
      }
      if (!TAGS.has(element.tagName)) { continue; }
      element.attrs = element.attrs.filter(a => !a.namespace && (ATTRS.has(a.name) || /^aria-[a-z-]+$/.test(a.name)));
      if (attrs.has('style')) {
        element.attrs.push({ name: 'style', value: await stylesheet(attrs.get('style')!, uri, resources, true) });
      }
      if (element.tagName === 'img') {
        const src = await resources.asset(attrs.get('src') ?? '', uri);
        if (src) { element.attrs.push({ name: 'src', value: src }); }
      }
      // Navigation is disabled, including fragment URLs: VS Code intercepts
      // webview links and may open an external browser or command URI.
      if (element.tagName === 'style') {
        const text = element.childNodes.filter(n => n.nodeName === '#text').map(n => (n as DefaultTreeAdapterMap['textNode']).value).join('');
        element.childNodes = [];
        defaultTreeAdapter.insertText(element, await stylesheet(text, uri, resources));
      } else { parents.push({ parent: element, depth: depth + 1 }); }
      children.push(element);
    }
    parent.childNodes = children;
  }
  const html = document.childNodes.find(n => 'tagName' in n && n.tagName === 'html') as Element;
  const head = html.childNodes.find(n => 'tagName' in n && n.tagName === 'head') as Element;
  const policy = defaultTreeAdapter.createElement('meta', HTML_NS, [
    { name: 'http-equiv', value: 'Content-Security-Policy' }, { name: 'content', value: CSP },
  ]);
  const defaults = defaultTreeAdapter.createElement('style', HTML_NS, []);
  defaultTreeAdapter.insertText(defaults, 'html{background:#fff;color:#000;color-scheme:light}body{margin:8px;padding:0;font-family:serif;font-size:16px}');
  policy.parentNode = head;
  defaults.parentNode = head;
  head.childNodes.unshift(policy, defaults);
  const charset = defaultTreeAdapter.createElement('meta', HTML_NS, [{ name: 'charset', value: 'utf-8' }]);
  charset.parentNode = head;
  head.childNodes.unshift(charset);
  if (resources.warnings.size) {
    const note = defaultTreeAdapter.createElement('aside', HTML_NS, [{ name: 'role', value: 'note' }]);
    defaultTreeAdapter.insertText(note, 'Static HTML Preview: ' + [...resources.warnings].join(' '));
    const body = html.childNodes.find(n => 'tagName' in n && n.tagName === 'body') as Element;
    defaultTreeAdapter.appendChild(body, note);
  }
  return '<!DOCTYPE html>\n' + serialize(document);
}
