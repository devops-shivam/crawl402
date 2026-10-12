# Releasing

Releases are automatic. Merging a pull request that changes `version` in `package.json` publishes that version to npm and creates a matching `vX.Y.Z` tag and GitHub Release. Merges that don't change the version publish nothing.

## Cutting a release

1. Create a branch and bump the version:
   ```bash
   npm version patch --no-git-tag-version   # 0.1.0 → 0.1.1 (fixes)
   npm version minor --no-git-tag-version   # 0.1.0 → 0.2.0 (features; may break before 1.0)
   npm version prerelease --preid beta --no-git-tag-version   # 0.2.0-beta.0 → published under the "next" tag
   ```
2. Add a section to `CHANGELOG.md` with the new version as its heading, for example `## 0.1.1`. Its text becomes the GitHub Release notes. CI fails if the section is missing.
3. Open a pull request and merge it once CI is green.

The **Release** workflow then runs the tests, publishes to npm with provenance, and creates the tag and release. Follow it in the repository's **Actions** tab.

Pre-release versions (anything with a `-`, like `0.2.0-beta.1`) are published under the `next` dist-tag, so `npm install crawl402` keeps installing the latest stable version. Install a pre-release with `npm install crawl402@next`.

## One-time setup

npm publishing uses [trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived OIDC token, so no npm token is stored in the repository. npm configures this per package, so the very first version is published by hand.

1. **Publish the first version from your computer** (Node.js 22.14+ and npm 11.5.1+):
   ```bash
   git clone https://github.com/devops-shivam/crawl402.git && cd crawl402
   npm install
   npm login            # opens the browser; 2FA required
   npm publish --access public   # runs the tests first
   ```
2. **Connect the package to GitHub Actions.** On npmjs.com open the package → **Settings** → **Trusted publishing** → **GitHub Actions**, and enter:
   - Organization or user: `devops-shivam`
   - Repository: `crawl402`
   - Workflow filename: `release.yml`
   - Environment: leave empty
   - Allow `npm publish` if npm asks which actions this publisher may perform.
3. **Lock it down (recommended).** In the same settings page, under **Publishing access**, choose to require two-factor authentication and disallow tokens. From then on, only this workflow (or you, with 2FA) can publish.

After step 1, the next run of the Release workflow sees that `0.1.0` is on npm and only creates the `v0.1.0` tag and GitHub Release.

## Troubleshooting

- **`npm error 404` or `ENEEDAUTH` on publish:** the trusted publisher isn't set up, or a field doesn't match exactly (the workflow filename must be `release.yml`, and `repository.url` in `package.json` must point at this repository).
- **Nothing was published:** the version in `package.json` is already on npm. Bump it.
- **Release notes check failed:** add a `## x.y.z` section to `CHANGELOG.md` for the new version.
