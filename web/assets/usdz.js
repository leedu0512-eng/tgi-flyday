// A three.js scene as a USDZ file, for the iPhone's AR Quick Look (Janno 28.11.2026: "a file type I can
// open on iPhone to see objects in AR"). Our own small writer, no library: meshes with their colours,
// opacity and canvas textures (the number plates); lines become thin bars, since Quick Look draws no
// lines; sprites are left out. A USDZ is a zip with nothing compressed, the .usda first and every
// file's data starting on a 64-byte boundary.
//
// THREE is the global from three.min.js. Everything is written in the scene's own metres, y up.

const f = (n) => (Math.abs(n) < 1e-7 ? '0' : String(Math.round(n * 1e5) / 1e5));
const v3 = (x, y, z) => `(${f(x)}, ${f(y)}, ${f(z)})`;

/** Bytes of a .usdz holding everything visible under root. */
export async function sceneToUsdz(root) {
  root.updateMatrixWorld(true);
  const meshes = [], mats = new Map(), textures = new Map();
  const bar = (a, b, t, mat) => { // a line segment as a thin box from a to b (world points)
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < 1e-4) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, len), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.lookAt(b);
    m.updateMatrixWorld(true);
    meshes.push(m);
  };
  root.traverseVisible((o) => {
    if (o.isSprite) return;
    if (o.isLineSegments || o.isLine) {
      const p = o.geometry.attributes.position, pts = [];
      for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
      const mat = new THREE.MeshBasicMaterial({ color: o.material.color });
      const step = o.isLineSegments ? 2 : 1;
      for (let i = 0; i + 1 < pts.length; i += step) bar(pts[i], pts[i + 1], 0.02, mat);
      if (o.isLineLoop && pts.length > 2) bar(pts[pts.length - 1], pts[0], 0.02, mat);
      return;
    }
    if (o.isMesh && o.geometry?.attributes?.position) {
      if (o.material && (o.material.opacity === 0 || o.material.visible === false)) return;   // hit boxes and the like
      meshes.push(o);
    }
  });
  const matName = (m) => {
    const mm = Array.isArray(m) ? m[0] : m;
    if (!mats.has(mm)) mats.set(mm, 'M' + mats.size);
    if (mm.map && mm.map.image && !textures.has(mm.map)) textures.set(mm.map, 'textures/T' + textures.size + '.png');
    return mats.get(mm);
  };
  let body = '';
  meshes.forEach((o, k) => {
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
    if (idx.length < 3) return;
    const e = o.matrixWorld.elements;
    const P = [], N = [], T = [];
    for (let i = 0; i < pos.count; i++) P.push(v3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    if (nor) for (let i = 0; i < nor.count; i++) N.push(v3(nor.getX(i), nor.getY(i), nor.getZ(i)));
    if (uv) for (let i = 0; i < uv.count; i++) T.push(`(${f(uv.getX(i))}, ${f(uv.getY(i))})`);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    body += `
    def Mesh "G${k}" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        matrix4d xformOp:transform = ( (${f(e[0])}, ${f(e[1])}, ${f(e[2])}, ${f(e[3])}), (${f(e[4])}, ${f(e[5])}, ${f(e[6])}, ${f(e[7])}), (${f(e[8])}, ${f(e[9])}, ${f(e[10])}, ${f(e[11])}), (${f(e[12])}, ${f(e[13])}, ${f(e[14])}, ${f(e[15])}) )
        uniform token[] xformOpOrder = ["xformOp:transform"]
        int[] faceVertexCounts = [${Array(idx.length / 3).fill(3).join(', ')}]
        int[] faceVertexIndices = [${idx.join(', ')}]
        point3f[] points = [${P.join(', ')}]${N.length ? `
        normal3f[] normals = [${N.join(', ')}] (
            interpolation = "vertex"
        )` : ''}${T.length ? `
        texCoord2f[] primvars:st = [${T.join(', ')}] (
            interpolation = "vertex"
        )` : ''}
        uniform token subdivisionScheme = "none"
        uniform bool doubleSided = ${mat && mat.side === THREE.DoubleSide ? 1 : 0}
        rel material:binding = </Root/Materials/${matName(o.material)}>
    }
`;
  });
  let matText = '';
  for (const [m, name] of mats) {
    const c = m.color || new THREE.Color(1, 1, 1), tex = m.map && textures.get(m.map);
    const op = m.transparent ? m.opacity : 1;
    const basic = !!m.isMeshBasicMaterial;
    const P = `/Root/Materials/${name}`;
    matText += `
        def Material "${name}"
        {
            token outputs:surface.connect = <${P}/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                ${tex ? `color3f inputs:diffuseColor.connect = <${P}/Tex.outputs:rgb>` : `color3f inputs:diffuseColor = ${v3(c.r, c.g, c.b)}`}
                ${basic ? (tex ? `color3f inputs:emissiveColor.connect = <${P}/Tex.outputs:rgb>` : `color3f inputs:emissiveColor = ${v3(c.r * 0.6, c.g * 0.6, c.b * 0.6)}`) : ''}
                float inputs:opacity = ${f(op)}
                float inputs:roughness = 0.7
                float inputs:metallic = 0
                token outputs:surface
            }${tex ? `
            def Shader "St"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                token inputs:varname = "st"
                float2 outputs:result
            }
            def Shader "Tex"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @${tex}@
                float2 inputs:st.connect = <${P}/St.outputs:result>
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "clamp"
                float3 outputs:rgb
            }` : ''}
        }
`;
  }
  const usda = `#usda 1.0
(
    defaultPrim = "Root"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Root" (
    assetInfo = {
        string name = "Root"
    }
    kind = "component"
)
{${body}
    def Scope "Materials"
    {${matText}
    }
}
`;
  const files = [['model.usda', new TextEncoder().encode(usda)]];
  for (const [t, path] of textures) files.push([path, await pngOf(t.image)]);
  return zipStored(files);
}

async function pngOf(img) {
  const c = img instanceof HTMLCanvasElement ? img : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  if (c !== img) c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- a zip with nothing compressed, each file's data on a 64-byte boundary (USDZ's rule) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStored(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = new TextEncoder().encode(name), crc = crc32(data);
    const head = 30 + nb.length;
    let pad = (64 - ((off + head + 4) % 64)) % 64;   // an extra field (4-byte header + padding) moves the data onto a 64-byte boundary
    const extra = 4 + pad;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, extra, true);
    const ex = new Uint8Array(extra); new DataView(ex.buffer).setUint16(0, 0x1986, true); new DataView(ex.buffer).setUint16(2, pad, true);
    parts.push(new Uint8Array(lh.buffer), nb, ex, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += head + extra + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
