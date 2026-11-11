/** Rectangles must be measured in final screen pixels, after camera transforms. */
export function inspectGeometry(data) {
  const issues = [];
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const rect = (r) => r && ['x', 'y', 'width', 'height'].every((k) => finite(r[k])) && r.width > 0 && r.height > 0;
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  if (!data || !finite(data.width) || !finite(data.height) || data.width <= 0 || data.height <= 0 || !Array.isArray(data.samples) || !data.samples.length) {
    return { checkedObjects: 0, issues: ['Geometry requires a positive viewport and non-empty samples.'] };
  }
  let checkedObjects = 0;
  for (const sample of data.samples) {
    if (!Number.isInteger(sample.frame) || sample.frame < 0 || !Array.isArray(sample.objects) || !sample.objects.length) {
      issues.push('Each geometry sample requires a non-negative integer frame and non-empty objects.');
      continue;
    }
    if (sample.subtitleRect != null && !rect(sample.subtitleRect)) issues.push(`Frame ${sample.frame}: invalid subtitle rectangle.`);
    if (rect(sample.subtitleRect) && (sample.subtitleRect.x < 0 || sample.subtitleRect.y < 0 || sample.subtitleRect.x + sample.subtitleRect.width > data.width || sample.subtitleRect.y + sample.subtitleRect.height > data.height)) issues.push(`Frame ${sample.frame}: subtitle outside viewport.`);
    for (const object of sample.objects) {
      if (!object.id || !rect(object)) { issues.push(`Frame ${sample.frame}: invalid object rectangle.`); continue; }
      if (object.required === false) continue; // Explicitly decorative/offscreen transition elements.
      checkedObjects++;
      const label = `Frame ${sample.frame}, ${object.id}`;
      if (object.x < 0 || object.y < 0 || object.x + object.width > data.width || object.y + object.height > data.height) issues.push(`${label}: outside viewport.`);
      if (rect(sample.subtitleRect) && intersects(object, sample.subtitleRect)) issues.push(`${label}: overlaps subtitle.`);
    }
  }
  if (!checkedObjects) issues.push('No required objects were measured.');
  return { checkedObjects, issues };
}
