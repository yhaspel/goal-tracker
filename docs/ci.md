# GitHub CI and Cloudflare deployment

This project currently has no Git repository or remote. A first push does **not** by itself redeploy the existing Cloudflare Workers. The checked-in [GitHub Actions workflow](../.github/workflows/ci.yml) runs lint, typecheck, Workers-runtime tests, a dependency audit, and a production bundle dry run on every push and pull request. It does not need a Cloudflare credential for those checks.

The workflow can deploy the **test** Worker after the checks pass on the repository's default branch. That job is disabled until the repository is created and its Cloudflare credentials are stored as GitHub Actions secrets. It cannot run from a pull request. Stage 2–6 work uses this isolated test environment and disposable identities; production remains on the Stage 1 shell until the Stage 7 release, backup, and restore gate is met. Add a separate production release workflow only at that point.

After the first push to GitHub:

1. Confirm the **CI and test deployment** workflow appears under the repository's Actions tab and its `checks` job passes. The `deploy-test` job should show as skipped initially.
2. In Cloudflare, create a dedicated API token from the **Edit Cloudflare Workers** template, scoped to the account containing `family-board-test`. Use the [Cloudflare GitHub Actions guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) for the current permissions. Do not use an interactive Wrangler OAuth token in CI.
3. In the GitHub repository, set Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under **Settings → Secrets and variables → Actions**. Do not put either value in source, workflow YAML, build logs, or an issue.
4. Set the repository Actions variable `CLOUDFLARE_TEST_DEPLOY_ENABLED` to `true`. Then run the workflow manually on the default branch (or push another commit). A passing `checks` job will be followed by `deploy-test` and a live routing/health check. Review the Cloudflare test Worker version and GitHub job result.

Keep a single deploy pipeline for each Worker. Do not also connect `family-board-test` to Cloudflare Workers Builds while GitHub Actions deploys it, or one push may trigger two independent deployments. The existing `wrangler.jsonc` has separate `production`, `test`, and `restore` bindings; use `npm run deploy:test` for the test job and keep restore unexposed. A passing CI job means the checked commit passed its tests; only a successful `deploy-test` job proves that commit reached the test hostname.
