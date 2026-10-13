import { runTests } from '@vscode/test-electron';
import { resolve } from 'node:path';

await runTests({
  ...(process.env.HTML_PREVIEW_EDITOR ? { vscodeExecutablePath: process.env.HTML_PREVIEW_EDITOR } : {}),
  extensionDevelopmentPath: resolve('.'),
  extensionTestsPath: resolve('test/integration.cjs'),
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--no-sandbox'],
});
