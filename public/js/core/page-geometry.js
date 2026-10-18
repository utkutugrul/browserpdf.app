// PDF.js viewports account for rotation, CropBox origins and UserUnit.
// CSS dimensions are separate from render-pixel dimensions on HiDPI screens.
function size(viewport, cssSize = {}) {
  const width = cssSize.width ?? viewport.width;
  const height = cssSize.height ?? viewport.height;
  if (!(width > 0 && height > 0)) throw new RangeError('Preview dimensions must be positive.');
  return { width, height };
}

export function viewportPointToPdf(viewport, x, y, cssSize) {
  const { width, height } = size(viewport, cssSize);
  return viewport.convertToPdfPoint(x * viewport.width / width, y * viewport.height / height);
}

export function pdfPointToViewport(viewport, x, y, cssSize) {
  const { width, height } = size(viewport, cssSize);
  const point = viewport.convertToViewportPoint(x, y);
  return [point[0] * width / viewport.width, point[1] * height / viewport.height];
}

export function viewportRectToPdf(viewport, rect, cssSize) {
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
    .map(([x, y]) => viewportPointToPdf(viewport, x, y, cssSize));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, points };
}

export function visualTransform(viewport, cssSize) {
  // Matrix from a bottom-left, y-up visual surface to unrotated PDF units.
  const { width, height } = size(viewport, cssSize);
  const origin = viewportPointToPdf(viewport, 0, height, cssSize);
  const right = viewportPointToPdf(viewport, 1, height, cssSize);
  const up = viewportPointToPdf(viewport, 0, height - 1, cssSize);
  return [right[0] - origin[0], right[1] - origin[1], up[0] - origin[0], up[1] - origin[1], ...origin];
}
