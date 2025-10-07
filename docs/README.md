# CNStra Docs

Local development:

```bash
cd docs
npm ci
npm run start
```

Build and preview:

```bash
npm run build
npm run serve
```

Deployment is handled by GitHub Actions on pushes to `master` that modify `docs/`.
