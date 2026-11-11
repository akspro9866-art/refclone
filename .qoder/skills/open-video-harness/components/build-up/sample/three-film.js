// build-up's three painter in canvas-film's Three.js layer: a tower of eight floors grows a floor at a time under an HDRI
// while the camera rises with it. A film's src/50-shots.js as it stands; tools/ci.sh draws it at 160 x 90 in software
// WebGL with a test sky written on the spot. With the network, to see it:
//   bin/vh new short tower --engine canvas-film --three          (then p is the new project's folder)
//   bin/vh components add $p build-up && bin/vh hdri get $p studio_small_09
//   cp components/build-up/sample/three-film.js $p/src/50-shots.js && bin/vh frames $p --strip 0:6 --fps 2
const TOWER = { pieces: [], order: "height", bucket: 1, start: 0.4, stagger: 0.55, jitter: 0.12, dur: 0.55, appear: "drop", lift: 1.2, seed: 3 };
for (let f = 0; f < 8; f++) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
  if (i === 1 && k === 1 && f % 3 !== 2) continue;   // hollow, but for every third floor's middle
  TOWER.pieces.push({ x: (i - 1) * 1.04, y: f * 1.02 + 0.5, z: (k - 1) * 1.04, w: 1, h: 1, d: 1, color: f % 2 ? "#c8643c" : "#dc8a5e" });
}
let BUILD = null, MESH = null;   // the component and the tower's InstancedMesh, made once in build()

Object.assign(FILM, {
  timeline: false, duration: 6, grain: 0, fadeOut: 0, images: {},
  three: {
    env: "assets/hdri/studio_small_09/studio_small_09_2k.hdr", background: "env", backgroundBlur: 0.25,
    lights: [{ type: "sun", intensity: 1.6, pos: [6, 12, 7], at: [0, 3, 0], shadow: true, shadowArea: 16 }],
    shadows: true,
    camera: { pos: [8, 2.2, 10], at: [0, 2, 0], lens: 32 },
    async build({ THREE, scene }) {
      BUILD = await import(new URL("components/build-up/component.js", document.baseURI).href);
      MESH = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6 }), TOWER.pieces.length);
      MESH.castShadow = MESH.receiveShadow = true;
      BUILD.setup(MESH, TOWER, THREE);   // its colours, once: there when ready compiles the shaders
      const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: "#77736b", roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(MESH, ground);
    },
  },
});

const SHOTS = [
  { id: "S01", at: 0, see: "a tower grows a floor at a time; the camera rises with it",
    three: {
      cam: { from: { pos: [8, 2.2, 10], at: [0, 2, 0] }, to: { pos: [9, 7.5, 9], at: [0, 4.5, 0] }, ease: "inOut" },
      pose(t) { BUILD.three(MESH, BUILD.state(TOWER, t), TOWER, THREE); },
    },
    draw() {} },
];
