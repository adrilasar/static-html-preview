# Static HTML Preview

Edit HTML on the left and see its rendered preview on the right in VSCodium.
Works with local files and projects opened over SSH.

## Usage

Install the VSIX using **Extensions: Install from VSIX…**. For SSH projects,
install it in the remote extension host too.

Open an `.html` or `.htm` file. The extension opens both views and keeps the
preview updated as you edit. Relative CSS, images and fonts are supported;
changes to those files appear after saving.

Use **Reopen Editor With… → Static HTML Preview** if another editor is selected.
Close the preview to keep working with source only.

## Static and offline

No telemetry or HTTP server. JavaScript, navigation and Internet resources are
blocked. Resources must stay within the containing workspace folder (or the
HTML's directory when no workspace is open); symbolic links are blocked.

Forms, inline SVG, embedded pages, `srcset` and absolute resource URLs are omitted.
Large documents and resources have limits. This is a preview of static HTML/CSS.

[Source and issues](https://github.com/adrilasar/html-preview-codium) · [MIT license](LICENSE)
