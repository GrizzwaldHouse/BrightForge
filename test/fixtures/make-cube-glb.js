/**
 * make-cube-glb.js - Generate test/fixtures/cube.glb, a minimal valid
 * glTF 2.0 binary: one unit cube (24 vertices, 12 triangles) with
 * POSITION, NORMAL and TEXCOORD_0 attributes and one material.
 *
 * Deterministic: running it twice produces byte-identical output.
 * Run: node test/fixtures/make-cube-glb.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildCubeGlb() {
  const faces = [
    { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
    { n: [0, 0, 1], v: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
    { n: [0, 0, -1], v: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] }
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  faces.forEach((face, f) => {
    face.v.forEach((p, i) => {
      positions.push(...p.map((c) => c * 0.5));
      normals.push(...face.n);
      uvs.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
    });
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });

  const pos = Buffer.from(new Float32Array(positions).buffer);
  const nrm = Buffer.from(new Float32Array(normals).buffer);
  const uv = Buffer.from(new Float32Array(uvs).buffer);
  const idx = Buffer.from(new Uint16Array(indices).buffer);
  const bin = Buffer.concat([pos, nrm, uv, idx]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);

  const gltf = {
    asset: { version: '2.0', generator: 'brightforge-test-fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Cube' }],
    meshes: [{ name: 'Cube', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'Grey', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.65, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: binPadded.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length, byteLength: nrm.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nrm.length, byteLength: uv.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nrm.length + uv.length, byteLength: idx.length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' }
    ]
  };

  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return Buffer.concat([header, jsonHeader, json, binHeader, binPadded]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(__dirname, 'cube.glb');
  const glb = buildCubeGlb();
  writeFileSync(out, glb);
  console.log(`[FIXTURE] Wrote ${out} (${glb.length} bytes)`);
}
