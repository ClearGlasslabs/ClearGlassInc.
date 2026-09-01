# ClearGlassInc Reference Homepage Recovery — Forensic Baseline

## Scope

Recovery branch created from `main` without rewriting history.

- Repository: `ClearGlasslabs/ClearGlassInc.`
- Source branch: `main`
- Source HEAD: `074fa5b8f0774291fb8f93dcdb7ab19bfb547051`
- Recovery branch: `restore/reference-homepage`

## Current architecture evidence

The production root is a static HTML site:

- `index.html`
- `assets/site.css`
- `assets/site.js`
- static HTML routes and assets
- GitHub Actions workflows
- security headers in `_headers`

No root `package.json` was identified during the initial homepage forensics.

## Homepage history examined

Relevant commits identified:

- `32e5d648d365a189ee7e408710dc0eefb84795b8` — Build cinematic Artemis homepage narrative
- `d0ae171de26e6cf2bf7358f31bda8f2fe6bccad5` — Merge immersive homepage narrative
- `a58b79ceef500d62de3198355b6a43adf27515ad` — Responsive homepage layout refinement
- `d0ae759f8d71cf16607b50e2e85c1dee4959ade8` — Add HELIX to homepage
- `e555b4e69b7dc26d27d18cdc0c3085100feb8f57` — Publish Ledger of Ashes feature directly on homepage

The current `main` homepage is materially reduced relative to the verified cinematic Artemis revision and currently places HELIX and Ledger content ahead of simplified Artemis/NEXUS sections.

## Reference-image evidence gap

The initial repository and default-branch code search did not locate verified source text for:

- "See clearly."
- "Operate securely."

The exact reference-image composition, including the requested eagle/shield emblem treatment and Ontario/Toronto visual panel, has not yet been proven to exist in the inspected default-branch source or the examined homepage commits.

No replacement image or invented copy has been introduced.

## CG Loader

Initial default-branch search for "CG Loader" and "loader" returned no verified implementation.

Status: BLOCKED — additional historical/branch evidence required before restoration.

## AES

Initial default-branch search for "AES" returned no verified repository implementation or definition tied to the production homepage.

Status: BLOCKED — INSUFFICIENT REPOSITORY EVIDENCE.

No cryptographic code or configuration has been invented.

## Security and CI observations

Existing repository controls include:

- environment/key exclusions in `.gitignore`
- production headers in `_headers`
- `security.yml` secret-pattern and dependency scanning
- static site SEO files including `robots.txt` and `sitemap.xml`

The current visual-regression workflow contains `continue-on-error: true` for its npm visual-test steps. This means the workflow is not currently a strict visual acceptance gate and must not be represented as a passing blocking validation.

## Recovery rule

Do not replace the homepage with an approximation.

The next restoration step requires locating verified historical assets/source matching the attached reference image. Until that evidence is found, preserve the recovery branch and report the evidence gap rather than fabricating the requested visual design.
