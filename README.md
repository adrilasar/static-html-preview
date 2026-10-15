# Static HTML Preview

[![Available on Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-Install-0078D4?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=adrilasar.static-html-preview)
[![Available on Open VSX](https://img.shields.io/badge/Open_VSX-Install-A60EE5?style=for-the-badge)](https://open-vsx.org/extension/adrilasar/static-html-preview)

Preview static HTML while you edit. Open an `.html` or
`.htm` file to see its source on the left and a live preview on the right.

## Features

- Inline styles and relative stylesheets, images and fonts.
- Local files and SSH workspaces.
- Live HTML updates as you type; resource updates when saved.
- No HTTP server, telemetry or Internet resource loading.

## Getting started

Open an HTML file from the Explorer. If it opens as text, use **Reopen Editor
With…** to select **Static HTML Preview** and configure it as the default editor.
Close the preview whenever you want to work with source only.

For SSH workspaces, install the extension on the remote host.

## Limitations

Designed for static HTML/CSS. JavaScript and navigation are disabled. Forms,
inline SVG, embedded pages, `srcset` and absolute resource URLs are unsupported.
SVG image files are supported.

Resources must stay inside the workspace folder, or the HTML file's directory
when no folder is open. Symbolic links are blocked; size limits apply.

[Report an issue](https://github.com/adrilasar/static-html-preview/issues) · [MIT license](LICENSE)
