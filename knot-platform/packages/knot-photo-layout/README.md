# @knot/photo-layout

How a set of images is laid out: first cut them into several equal-height rows by real aspect ratio, then assign a height to each row.

The card (`web/src/components/PhotoGallery.vue`) and the share poster (`backend/src/sharePoster.js`) use the same
`planPhotoRows`, so the layout you see on the share poster is the layout on the card. The two differ only in "budget":
the card caps row height at 125% of content width (too tall would fill a whole screen), the share poster goes to 300%, because that image is meant to be viewed vertically.

- `photoAspect(photo)`: the aspect ratio of one image; 4:3 when dimensions are missing.
- `planPhotoRows(aspects, rules)`: exhaustive cut (`2^(n-1)` ways), pick the one with the lowest cost, return each row's height and crop direction.
- `planPhotoLayout(photos)`: used by the card; the row-cut result goes straight to CSS variables.
- `planPhotoBoxes(photos, { width, gap, rules })`: used by the share poster; multiply row heights into pixel boxes and hand them to sharp for cropping and compositing.
- `rowShares(aspects, cells)`: how much width each cell of a row takes; normalized to sum to 1 (using ratios directly as `flex-grow` won't fill the row).
- `LAYOUT_RULES`: target row height, row height bounds, total height cap, narrowest cell, crop penalty. To tune layout taste, change only this.

The design notes are at the top of `src/index.js`: why not to measure the DOM, why "too-tall images" need no special case, and what each term of the cost function penalizes.
