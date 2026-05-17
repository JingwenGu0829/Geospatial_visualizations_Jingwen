# Geospatial Visualizations

Interactive Bluebikes traffic map for DSC 106 Lab 7.

## Local Setup

1. Copy `config.example.js` to `config.js`.
2. Replace the placeholder with your Mapbox public access token.
3. Run a local static server, for example:

```sh
python3 -m http.server 8000
```

4. Open `http://127.0.0.1:8000/`.

`config.js` is ignored by Git because GitHub push protection blocks Mapbox tokens in commits. GitHub Pages creates this file during deployment from the `MAPBOX_ACCESS_TOKEN` repository secret.
