# Running the tests after a product deployment

The product repository{{PRODUCT_REPO}} can start this suite when it deploys. GitHub only allows one repository to start a
workflow in another with a token, so this part is manual: only you can create the token. Nothing here needs the QA
credentials in the product repository, and the token cannot read them.

## Recommended: start the workflow directly (least privilege)

1. Create a **fine-grained personal access token** (or a GitHub App) limited to **this automation repository only** with a
   single repository permission: **Actions: Read and write** (Metadata: read is added automatically). Nothing else:
   it can start workflows here but cannot read or change code, secrets or settings.
2. Save it as the secret `QA_DISPATCH_TOKEN` in the PRODUCT repository (an environment secret on the production
   environment is better: only deploys to that environment can use it).
3. Add a step at the end of the product deploy workflow, after a successful deploy:

```yaml
      - name: Run the QA suite
        env:
          GH_TOKEN: ${{ secrets.QA_DISPATCH_TOKEN }}
        run: |
          changed=$(git diff --name-only ${{ github.event.before }} ${{ github.sha }} | paste -sd, -)
          gh workflow run regression.yml -R <owner>/<this-automation-repo> -f changed_paths="$changed"
          gh workflow run smoke.yml -R <owner>/<this-automation-repo> -f changed_paths="$changed"
```

## Alternative: `repository_dispatch`

The workflows also accept the event `product-deployed`. GitHub requires **Contents: Read and write** on this repository
for that event, which also allows pushing code here. Prefer the recommended option unless you cannot use it.

```yaml
          gh api repos/<owner>/<this-automation-repo>/dispatches \
            --input - <<< "{\"event_type\":\"product-deployed\",\"client_payload\":{\"changed_paths\":$(git diff --name-only ${{ github.event.before }} ${{ github.sha }} | jq -R . | jq -sc .)}}"
```

## Risk selection

Fill `risk.map.json` here: which product paths affect which catalog **areas**. Paths the map does not cover, an
empty change list or any doubt run the whole suite. Check what a change would run with:
`QA_CHANGED_PATHS=src/pages/a.ts npm run qa -- select --suite tests/regression`.

## Safety

- The changed paths are data, never code: they are only matched against the globs in `risk.map.json` and reach the job as
  an environment variable, never inside a shell command.
- Runs started this way execute the default branch of this repository, with its secrets. They never run code from a pull
  request or from the product repository.
- Rotate the token on a schedule you can keep (fine-grained tokens expire; set the shortest period you can live with).
