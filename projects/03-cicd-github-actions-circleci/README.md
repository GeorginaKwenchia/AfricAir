# Project 3 — CI/CD with GitHub Actions **and** CircleCI

> **Domains assessed:** pipeline design · caching & parallelism · test reporting · OIDC to AWS (no static keys) · image build/scan/push · environment promotion & approvals · scheduled automation · GitHub Actions vs CircleCI
> **Suggested duration:** 1–1.5 weeks · **Team size:** 2 · **Builds on:** Project 1 (S3/CloudFront publish) and Project 2 (Dockerfile, ECR)

## Scenario

Deployments are still run from laptops. Leadership wants every change to AfricAir to be **tested, scanned, built once, and promoted** automatically, with a human approval before production.

The company has not decided between GitHub Actions and CircleCI. You will implement the **same pipeline on both**, then write a recommendation.

## Know the application

| Step | Command | Notes |
|---|---|---|
| Setup | `corepack enable && pnpm install --frozen-lockfile` | Cache the pnpm store, keyed on `pnpm-lock.yaml` |
| Types | `pnpm check` | Fast. Run first. |
| Unit + API tests | `pnpm test` | Vitest. Add `--reporter=junit --outputFile=test-results/unit.xml` for CI reports. The API's **database tests run only when `TEST_DATABASE_URL` is set**, so CI must provide a PostgreSQL service. |
| API build | `pnpm build:api` | Output: `server/dist/` |
| Build | `pnpm build` | Output: `dist/` |
| E2E | `BASE_URL=<url> pnpm test:e2e` | Playwright 1.64. With `CI=true` it writes `playwright-report/` and `test-results/junit.xml`, retries once, and records traces on failure. Supports `--shard=1/2` and `--project=desktop\|mobile`. |
| Browsers | `npx playwright install --with-deps chromium` | Or use the `mcr.microsoft.com/playwright:v1.64.0-noble` image |
| Images | Your Project 2 `Dockerfile.web` and `Dockerfile.api` | Two images, built and promoted together |
| Static publish | Your Project 1 `publish-s3.sh` | |

## Required pipeline (implement it on both platforms)

```text
 PR opened/updated ─► verify ─┬─► unit + API tests (Node 20 & 22 matrix) with a PostgreSQL service container
                              ├─► build ─► e2e (2 shards × desktop/mobile) against the Compose stack or `vite preview`
                              └─► docker build web + api, Trivy scan (no push)

 push to main ─────► verify ─► images: build, scan, push BOTH to ECR as :<sha>
                              └─► deploy staging (EC2 from Project 1, or S3/CloudFront for static mode) ─► smoke e2e

 tag v*.*.* ───────► promote: re-tag the SAME :<sha> images as :vX.Y.Z (no rebuild)
                              └─► ⏸ manual approval ─► deploy production ─► smoke test ─► GitHub Release
```

### Functional requirements

1. **Fail fast.** `pnpm check` runs before anything expensive. A type error must stop the pipeline in under 2 minutes.
2. **Caching.** Cache the pnpm store (keyed on the lockfile hash) and the Playwright browsers. Show a cold run and a warm run with their timings.
3. **Matrix.** Unit tests run on Node 20 **and** 22.
3b. **Service containers.** The API database tests must really run in CI:
   - GitHub Actions: a `services: postgres` container with a health check, and `TEST_DATABASE_URL` pointing at it;
   - CircleCI: a secondary `cimg/postgres` image in the executor.

   Show the test log proving the PostgreSQL suite **ran**, not skipped.
4. **Parallel e2e.** Split the Playwright suite across at least 2 parallel jobs (`--shard`) and merge or collect the reports.
5. **Test reporting.**
   - GitHub: upload `playwright-report/` as an artifact and publish JUnit results as a check or job summary.
   - CircleCI: `store_test_results` and `store_artifacts`.
6. **Build once, promote.** Both images are built **once**, on `main`. Production deploys re-tag them by digest. Prove it: the digests in prod equal the digests built on `main`.
6b. **Version stamping.** The build passes `APP_VERSION` / `GIT_SHA` so the deployed API reports them. The environment banner and `/#/status` must show the exact commit that CI built.
7. **No long-lived AWS keys.** Both platforms authenticate to AWS with **OIDC**:
   - GitHub: `permissions: id-token: write` plus `aws-actions/configure-aws-credentials` with `role-to-assume`. The IAM trust policy restricts the `sub` claim to your repo, and production to tags only.
   - CircleCI: an OIDC token (`$CIRCLE_OIDC_TOKEN_V2`) and an IAM OIDC provider for `oidc.circleci.com/org/<org-id>`. Restrict the trust policy to your project ID.
   - Commit both trust policies to `deploy/iam/`.
8. **Security gates.** The pipeline fails on:
   - `pnpm audit --audit-level=high`, or justify each exception;
   - Trivy `CRITICAL` findings in the image;
   - `hadolint` errors.
9. **Environments and approval.**
   - GitHub: `environment: production` with **required reviewers** and a deployment URL.
   - CircleCI: a `type: approval` job and a **restricted context** for production secrets.
10. **Concurrency.** New pushes to a PR cancel the previous run, and two production deploys can never run at the same time.
11. **Reuse.** Remove duplication:
    - GitHub: a **composite action** (`.github/actions/setup`) or a **reusable workflow**;
    - CircleCI: `executors`, `commands`, and at least one **orb** (e.g. `circleci/aws-cli`, `circleci/aws-ecr`).
12. **Branch protection.** `main` requires the verify checks from **both** systems and one review. Include a screenshot.
13. **Scheduled data refresh.** A weekly GitHub Actions workflow runs `pnpm data:airports`, `pnpm test` and `pnpm build`. If `src/data/airports.json` changed, it **opens a pull request** (`peter-evans/create-pull-request`, or `gh pr create` with the right `permissions`). If nothing changed, it exits cleanly.

### Files to create

```text
.github/
  actions/setup/action.yml        # composite: corepack, pnpm cache, install
  workflows/ci.yml                # PR + main
  workflows/release.yml           # tags → approval → production
  workflows/refresh-airports.yml  # weekly schedule + workflow_dispatch
.circleci/config.yml              # equivalent pipeline using workflows, filters, approval
deploy/iam/github-oidc-trust.json
deploy/iam/circleci-oidc-trust.json
deploy/iam/ci-deployer-policy.json
docs/ci-comparison.md
```

## Failure drills (record a run URL for each)

| # | Inject | Expected result |
|---|---|---|
| 1 | A TypeScript error in `src/lib/flights.ts` | Fails at `check` in under 2 minutes; nothing is built |
| 2 | Change a price assertion in `src/lib/flights.test.ts` | Unit job fails; JUnit report shows the failing test by name |
| 3 | Rename the "Confirm booking" button | E2E fails; the Playwright trace for the failure is downloadable |
| 4 | Change the base image to an old, vulnerable tag (e.g. a years-old nginx) | Trivy gate fails; no image is pushed |
| 4b | Break the SQL in `server/migrations/001_init.sql` | API tests fail against the CI PostgreSQL service |
| 5 | Push a tag from a fork or a non-protected branch | OIDC role assumption is **denied** by the trust policy |
| 6 | Two tags pushed 10 seconds apart | Second production deploy waits (or is cancelled); it never runs in parallel |

## Acceptance checks (the instructor will run these)

- Open a PR with a trivial change: both GitHub and CircleCI checks appear and pass, and PR runs push no image.
- Merge it: images `africair-web:<sha>` and `africair-api:<sha>` appear in ECR. Staging `/version.json` and `/api/config` (`.commit`) both show that SHA, and the smoke e2e is green.
- Tag `v1.0.0`: an approval is requested, and after approval production `/version.json` shows the same SHA. `aws ecr describe-images` shows `v1.0.0` and `<sha>` on **the same digest**.
- `git grep -nE 'AKIA|aws_secret_access_key'` finds nothing, and no AWS keys are stored in either platform's settings.
- Re-run the pipeline without changes: the warm cache cuts install time by more than 50%.

## `docs/ci-comparison.md` — your recommendation

Compare the two platforms on:

- syntax and reuse (composite actions or reusable workflows vs orbs, commands and executors);
- caching;
- parallelism and test splitting;
- secrets and contexts;
- OIDC setup;
- approvals and environments;
- self-hosted runners;
- pricing model for **~300 builds/month** at your measured average duration;
- developer experience.

End with a clear recommendation and its trade-offs, in one page.

## Knowledge check (`ANSWERS.md`)

1. Why is OIDC safer than storing `AWS_ACCESS_KEY_ID` as a secret? What exactly does the trust policy validate?
2. Why should production deploy an existing image digest instead of rebuilding from the tag?
3. `pull_request` vs `pull_request_target`: which is dangerous with secrets, and why?
4. How does your cache key avoid serving stale dependencies after a lockfile change?
5. What is a flaky test? How do retries hide or reveal flakiness, and what should the pipeline report?
6. In CircleCI, what is the difference between a workspace, a cache and an artifact?

## Grading rubric (100 pts)

| Area | Points |
|---|---|
| GitHub Actions pipeline complete and correct | 20 |
| CircleCI pipeline complete and correct | 20 |
| OIDC on both platforms with tight trust policies | 15 |
| Build-once/promote-by-digest with approval gate | 15 |
| Caching, matrix, sharding, reporting | 10 |
| Security gates and failure drills | 10 |
| Scheduled data-refresh PR workflow | 5 |
| Comparison and recommendation | 5 |

## Cost and cleanup

GitHub Actions minutes are free for public repos. CircleCI's free plan is enough for this project. The AWS resources reuse Projects 1 and 2. Remove the IAM OIDC providers and roles when the bootcamp ends.
