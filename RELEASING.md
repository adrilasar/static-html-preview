# Publishing a release

1. Update `CHANGELOG.md` and run `npm version patch --no-git-tag-version`
   (or `minor`/`major`). Merge the changes into `main` after CI passes.
2. Publish a stable GitHub release from `main`, with a new tag matching
   `package.json`, such as `v0.2.1`.
3. Wait for **Publish extension** to pass. It tests on Linux and Windows,
   attaches the verified VSIX to the release and publishes it to Open VSX.
4. Download that VSIX and upload it to the existing extension in the
   [Microsoft publisher portal](https://marketplace.visualstudio.com/manage).

Open VSX uses trusted publishing, already configured for this repository's
`publish.yml` workflow and `publish` environment (restricted to `v*` tags).
No access token is needed.

Microsoft publishing remains manual while native trusted publishing is
[unavailable](https://github.com/microsoft/vsmarketplace/issues/1422).
The optional Microsoft job requires the repository variable `PUBLISH_MICROSOFT`
set to `true` and a `VSCE_PAT` secret in the `publish` environment.

**Run workflow** only validates and packages. Prereleases are ignored.
Retry failed jobs if necessary; never reuse a published version for changed code.
