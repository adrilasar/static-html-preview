# Publishing releases

Publishing a stable GitHub release runs `.github/workflows/publish.yml`. It calls
the existing Linux/Windows CI, compares their bundles and icons, and sends one
verified VSIX to Visual Studio Marketplace and Open VSX. The same VSIX and
`SHA256SUMS` are attached to the GitHub release. Package versions and tags must
match, and the tagged commit must belong to `main`.

## One-time configuration

Use the GitHub environment **publish**, restricted to tags matching `v*`, with
no required reviewers if releases should publish automatically.

### Open VSX

In [Trusted Publishers](https://open-vsx.org/user-settings/trusted-publishers),
register `adrilasar.static-html-preview` with these GitHub Actions settings:

- Organization or user: `adrilasar`
- Repository: `static-html-preview`
- Workflow filename: `publish.yml`
- Environment: `publish`

The namespace owner must register it. No Open VSX token is needed. See the
[official instructions](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing).

### Visual Studio Marketplace

Create an Azure DevOps PAT for the Microsoft account that owns publisher
`adrilasar`, with **Marketplace → Manage** and **All accessible organizations**,
following [Microsoft's instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).
Store it as the **VSCE_PAT** secret in the GitHub **publish** environment.
Never put the PAT in a file, issue, PR or chat. Renew it before expiry.
An Azure DevOps organization can be created for free if the account does not
already have one; this does not require an Azure subscription or payment card.

This is an interim authentication method: Microsoft announces retirement of
global Azure DevOps PATs on **December 1, 2026**. Direct Marketplace trusted
publishing is not operational yet, despite the client README advertising it
([tracking issue](https://github.com/microsoft/vsmarketplace/issues/1422)).
Review this setup before that deadline; use native trusted publishing when
available, or Microsoft's documented Entra ID authentication route.

The official `ovsx` client shares our pinned `@vscode/vsce` through an npm
override, avoiding its older duplicate and vulnerable transitive dependencies.
Both are development tools, excluded from the VSIX.

## Publish a new version

1. Update `CHANGELOG.md` and run `npm version patch --no-git-tag-version`
   (or `minor`/`major`). Commit the version and lockfile changes through a PR.
2. Once merged and CI passes, create a GitHub release targeting `main`, with a
   new tag matching `package.json`, for example `v0.2.1`. Publish the release
   without uploading a VSIX manually; the workflow attaches it.
3. Check all jobs in **Publish extension**, then the listings in both registries.

A manual **Run workflow** only runs verification and produces the VSIX artifact;
it never uploads to either registry or changes a GitHub release. Prereleases are
ignored. Existing releases are not republished when this workflow is merged.

If one registry fails, rerun the failed job after fixing its authentication or
service issue. Already published versions are skipped. A rerun that rebuilds the
package reuses the original release VSIX if its file contents match, preserving
the checksum; a changed payload or incorrect checksum fails instead of replacing
an existing version. Never retag or reuse a published version for changed code.
