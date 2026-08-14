# Paidiasophia

Local static rebuild of the Paidiasophia research wiki.

Live site: https://coldnightwarmth.github.io/paidia/

## Workflow

1. Fetch public Notion content into `data/notion-raw/`.
2. Normalize that data into `data/site.json`.
3. Open `index.html` in a local server and review the current migration state.

## Commands

```bash
npm run fetch:notion
npm run build:data
python3 -m http.server 4173
```

The fetch step depends on public Notion access and is designed to be rerun as the migration expands.
