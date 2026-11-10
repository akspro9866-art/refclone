# Cavalry 2.7 / 2.8 Sharp Edges & API Gotchas (`motion-graphics/sharp_edges.md`)

## 1. Attribute Naming Traps
- **Fill Color**: Use `material.materialColor` (e.g., `api.set(id, { "material.materialColor": "#6366F1" })`), **never** `fill.color` or `color`.
- **Fill Opacity vs. Layer Opacity**: Layer-wide opacity is `opacity` (`0..1` or `0..100` depending on node; in `_mg`, normalized `0..1` or `0..100` is handled safely). Material alpha is `material.alpha`.
- **Text Attributes**: Set `fontSize`, `letterSpacing`, `wordSpacing`, `lineSpacing`, `horizontalAlignment`, and `font` directly on the `textShape` root—**never** `text.fontSize` or `generator.fontSize`.
- **Layer Name Readback**: `api.getName(id)` **does not exist** in Cavalry. Always call `api.getNiceName(id)`.

## 2. Coordinate System Traps (`Comp Space` vs. `Raster Space`)
- **Cavalry Comp Space**: Origin `(0, 0)` is the **center** of the composition; `+X` is right, **`+Y` is UP**.
- **Video / DOM Raster Space**: Origin `(0, 0)` is the **top-left** corner; `+X` is right, **`+Y` is DOWN**.
- Always convert raster coordinates using `_mg.fromRaster(x, y, compWidth, compHeight)` (`x_comp = x_raster - compWidth / 2`, `y_comp = compHeight / 2 - y_raster`).

## 3. Connection Directionality (`api.connect`)
- Signature: `api.connect(srcId, srcAttr, dstId, dstAttr, force?)`.
- Data flows **from `srcId.srcAttr` into `dstId.dstAttr`**.
- When attaching a deformer to a shape: `api.connect(deformerId, "id", shapeId, "deformers")`.
- Always verify critical connections with `api.getInConnection(dstId, dstAttr)` (returns non-empty string `"srcId.srcAttr"` when alive, `""` when dead).

## 4. Execution Context Boundaries
- Cavalry has **8 distinct execution contexts**: `script`, `plugin`, `render`, `shape`, `utility`, `deformer`, `emitter`, `modifier`.
- Calling `api.create()` or `api.set()` inside a `javaScriptShape` (`shape` context) or `javaScriptDeformer` (`deformer` context) throws a `ReferenceError: api is not defined` written to `js_log.txt`.
- Inside `javaScriptShape`, construct and return a `new cavalry.Path()`. Inside `javaScriptDeformer`, manipulate `def.getPoints()` / `def.setPoints()` or `def.getRootMesh()` / `def.setRootMesh()`.
