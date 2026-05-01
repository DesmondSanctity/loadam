# loadam demo report

A real `report.html` produced by running `loadam test` against the public
[Swagger Petstore](https://petstore3.swagger.io/) using
[fixtures/specs/petstore.openapi.yaml](../../fixtures/specs/petstore.openapi.yaml).

## How it was generated

```bash
loadam test fixtures/specs/petstore.openapi.yaml \
  --target https://petstore3.swagger.io/api/v3 \
  --mode smoke --no-interactive \
  --output examples/demo-out/k6
loadam report latest --root examples/demo-out -o examples/demo/report.html
```

The fixture spec has different routes than the live petstore, so every
operation correctly fails the `2xx-3xx` check — making this a good showcase
of how the report surfaces threshold failures and real `http_req_duration`
metrics. Open [report.html](report.html) in a browser to see the full UI.

The whole file is **7 KB** of inline HTML/CSS — no external dependencies, no
JavaScript bundles, safe to serve as a CI artefact or commit to gh-pages.
