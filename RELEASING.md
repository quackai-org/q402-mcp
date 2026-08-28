# Releasing

## Normal release flow

All releases go through GitHub Actions using **[npm Trusted Publishing (OIDC)](https://docs.npmjs.com/generating-provenance-statements)** — no long-lived npm tokens are stored anywhere.

### 1. Bump the version (in a PR)

Update the version string to the same value in **all four locations**:

| File | Field path |
|---|---|
| `package.json` | `.version` |
| `server.json` | `.version` (top-level) |
| `server.json` | `.packages[0].version` |
| `.codex-plugin/plugin.json` | `.version` |

Merge the version-bump PR into `main`.

### 2. Trigger the publish workflow

1. Go to **Actions → Publish to npm → Run workflow**.
2. Enter the version number (must match `package.json` exactly, e.g. `0.11.25`).
3. Click **Run workflow**.

The workflow will:
- Verify the input version matches `package.json`
- Verify all four publishing-surface version fields are identical
- Run `npm ci`, `npm run build`, `npm run lint`, `npm test` — any failure aborts
- Publish to npm using GitHub OIDC (no manual token required)
- Create and push the `v<version>` git tag

---

## Emergency fallback (break-glass only)

> Use only when the GitHub Actions pipeline is unavailable.

npm recovery codes can be used locally with `npm publish --otp <recovery-code>`.
Treat recovery codes as break-glass credentials. Normal releases **must** use the
workflow above.

---

## One-time setup (after this PR is merged)

An npmjs.com admin must register this repository as a **Trusted Publisher** so that
the OIDC exchange works. Steps:

1. Sign in to [npmjs.com](https://www.npmjs.com/) and open the `@quackai/q402-mcp` package page.
2. Go to **Settings → Publishing → Trusted Publishers**.
3. Click **Add a Trusted Publisher** and select **GitHub Actions**.
4. Fill in the form:
   - **Owner:** `quackai-org`
   - **Repository:** `q402-mcp`
   - **Workflow filename:** `publish.yml`
   - **Environment name:** *(leave blank)*
5. Click **Add publisher**.

Once saved, the `npm publish` step in the workflow will authenticate via the GitHub
OIDC token automatically — no `NPM_TOKEN` or other secret is needed.
