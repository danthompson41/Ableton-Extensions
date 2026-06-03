# Ableton Live Extensions

A collection of example **Ableton Live extensions** built on the Extension SDK.
Each subdirectory is a self-contained extension with its own `manifest.json`,
build setup, and README.

## Extensions

| Extension          | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| [`mlr/`](mlr/)     | A monome/norns **MLR**-style loop chopper — slices a warped audio clip into N equal segments mapped across the Session View grid. |

## Getting started

Each extension is a standalone npm package. To run one:

1. Enable **Developer Mode** in Live's *Preferences → Extensions*.
2. `cd <extension>` (e.g. `cd mlr`)
3. `npm install`
4. `npm start -- --live "/Applications/Ableton Live Beta.app"`

See the individual extension's README for usage details.

## Layout

```
extensions/
├── mlr/            # MLR — Grid Slicer
│   ├── src/        # extension source (TypeScript + HTML dialogs)
│   ├── build.ts    # esbuild bundling
│   ├── manifest.json
│   └── README.md
└── README.md       # this file
```

The SDK and CLI are consumed as local `.tgz` packages referenced from each
extension's `package.json` (`@ableton-extensions/sdk` and
`@ableton-extensions/cli`).
