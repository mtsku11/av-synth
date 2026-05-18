# Reference Videos

Committed `.webm` captures live here for the stable `audit-*` matrix.

- Default convention: `qa/references/<recording filename>.webm`
- `qa/analyze.js` uses that convention automatically when a case does not set `referenceVideo` explicitly.
- Refresh them from the latest green audit run with:

```bash
npm run qa:references:sync
```

Treat these as the visual regression baseline for `video-quality-mcp`. Refresh
them only after an intentional visual-output change has been reviewed and
accepted.
