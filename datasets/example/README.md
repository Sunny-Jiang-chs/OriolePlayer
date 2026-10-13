# Author Example

This is an independently authored package. Its two PNG illustrations and two
WAV sounds are generated locally; they contain no game assets.

## Preview

Open the studio and load `datasets/example/package.json`. The four-page story
includes a shared visual across two pages, music that continues across pages,
one sound effect, two branch destinations, and an explicit music stop.

## Rebuild

From the project directory:

```powershell
python datasets/example/build_example.py
```

The generator uses only the Python standard library and writes only inside this
dataset directory. It recreates `package.json` and `media/` in place.

## Adapt

Replace the assets in `media/` and update their `uri` entries. Pages reference
stable IDs through `visual.assetId` and `audioEvents[].assetId`, so media paths
do not appear in story pages. Keep IDs unique within each asset table.

Edit `text.speaker` and `text.body` for each page. An empty `audioEvents` array
continues the current sound state; `play` on `bgm` starts music and `stop` on
`bgm` ends it. Audio playback still requires a browser user gesture.

Choices point to `targetSceneId` and `targetPageId`. This example keeps the two
endings in separate scenes so selecting either branch does not fall through to
the other ending. It omits `audioState` to demonstrate sequential event state.

The data contract is `schema/cgscene-package.schema.json`, version `1.0.0`.
