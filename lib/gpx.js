'use strict';

/**
 * Extrait les points d'un fichier GPX (traces <trkpt>, sinon routes <rtept>).
 * Retourne [{lat, lon, ele}].
 */
function parseGpx(text) {
  const trk = extract(text, 'trkpt');
  return trk.length ? trk : extract(text, 'rtept');
}

function extract(text, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const pts = [];
  let m;
  while ((m = re.exec(text))) {
    const lat = parseFloat(attr(m[1], 'lat'));
    const lon = parseFloat(attr(m[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleMatch = m[2] && m[2].match(/<ele>\s*([^<]+?)\s*<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : null;
    pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return pts;
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? m[1] : undefined;
}

module.exports = { parseGpx };
