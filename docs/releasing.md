# Releasing

`@nuvraxis-org/agenttsm` is versioned with [Changesets](https://github.com/changesets/changesets) and
published from GitHub Actions with an npm granular access token, stored as the `NPM_TOKEN` secret
of the `npm` environment. Releases still carry npm provenance: the job's OIDC token signs the
provenance statement, while `NPM_TOKEN` authenticates the publish.

## Day to day

1. In a PR that changes the published package, run `pnpm changeset`, pick the bump, and write one
   line for the changelog. Commit the generated `.changeset/*.md` with the PR.
2. When it merges to `main`, `release.yaml` opens or updates a **Version Packages** PR. That PR
   bumps `packages/core/package.json`, writes `packages/core/CHANGELOG.md`, and deletes the
   consumed changesets.
3. Merging the Version Packages PR runs `release.yaml` again. With no changesets left, the
   `publish` job:
   1. skips everything if that version is already on npm;
   2. builds the package and packs it with `pnpm pack`, which rewrites `catalog:` specifiers;
   3. runs `npm publish <tarball> --provenance --access public`, authenticated with `NPM_TOKEN`;
   4. creates the GitHub Release `vX.Y.Z`, using that version's section of the changelog as the
      notes.

`release.yaml` runs only for pushes to `main` that change `packages/**` or `.changeset/**`. Merges
that touch only examples, docs, CI or dependencies of the examples don't start it.

Examples are private workspace packages. Changesets neither versions nor tags them
(`privatePackages` in `.changeset/config.json`).

## One-time setup

Do these once, in this order, before the first release.

### 1. Create the npm token

On npmjs.com, sign in with an account that has publish rights on the `@nuvraxis-org` scope, then
open **Access Tokens → Generate New Token → Granular Access Token**:

| Field                            | Value                                              |
| -------------------------------- | -------------------------------------------------- |
| Token name                       | `agenttsm-release`                                 |
| Bypass two-factor authentication | Enabled; the workflow cannot answer a 2FA prompt   |
| Packages and scopes              | Read and write, only for the `@nuvraxis-org` scope |
| Organizations                    | No access                                          |
| Expiration                       | The longest npm allows for a write token           |

The package does not need to exist on npm first. The token covers the whole scope, so the first
run of the `publish` job creates `@nuvraxis-org/agenttsm`.

After that first publish, leave the package's **Settings → Publishing access** on an option that
still accepts granular tokens. "Disallow tokens" would block the workflow.

### 2. Create the `npm` environment on GitHub

**Settings → Environments → New environment** named `npm`:
- Under **Deployment branches and tags**, allow only `main`.
- Under **Environment secrets**, add `NPM_TOKEN` with the token from step 1.

The `publish` job runs in this environment, so only workflow runs on `main` can read the token.
Don't add it as a repository secret as well.

### 3. Protect `main`

**Settings → Rules → Rulesets → New branch ruleset** targeting `main`:
- Require a pull request before merging, with at least one approval.
- Require these status checks to pass: `Biome`, `Typecheck, test, build`, `Conformance`,
  `Examples smoke`.
- Block force pushes, and restrict deletions.

### 4. Let Actions open the Version Packages PR

**Settings → Actions → General → Workflow permissions**: enable **Allow GitHub Actions to create
and approve pull requests**. The `version` job uses only `GITHUB_TOKEN`.

A PR opened with `GITHUB_TOKEN` does not trigger other workflows, so `ci.yaml` won't run on the
Version Packages PR by itself. That PR changes only versions and changelogs. To run CI on it
anyway, close and reopen it, or push an empty commit to its branch.

## Rotating the token

Write tokens expire. Before `NPM_TOKEN` does:
1. Generate a new granular token with the same settings as in step 1.
2. Replace the `NPM_TOKEN` secret in the `npm` environment.
3. Revoke the old token on npmjs.com.

Do the same straight away if the token may have leaked.

## Pinned actions and Dependabot

Every action in `.github/` is pinned to a full commit SHA with the release tag in a comment.
Dependabot (`.github/dependabot.yml`) proposes weekly updates for actions and npm packages, after a
cooldown, and updates the SHA and the comment together. npm packages also wait out the one-day
`minimumReleaseAge` in `pnpm-workspace.yaml` before pnpm will install them.

## If a release fails

- **Publish failed:** re-run the `publish` job. It checks npm first, so a version that did get
  published is not published twice.
- **`E401`, `E403` or `ENEEDAUTH` on publish:** `NPM_TOKEN` has expired, been revoked, or lacks
  write access to `@nuvraxis-org`. Rotate it (see above) and re-run the `publish` job.
- **Release missing:** if npm has the version but GitHub has no `vX.Y.Z` release, create it with
  `gh release create vX.Y.Z --target <merge commit> --notes-file <changelog section>`.
- **Wrong version published:** npm versions are immutable. Deprecate it with
  `npm deprecate @nuvraxis-org/agenttsm@X.Y.Z "<reason>"` and release a fix through a new changeset.
