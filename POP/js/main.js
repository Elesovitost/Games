import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { Terrain } from "./terrain.js";
import { Water } from "./water.js";
import { Sky, createSun, placeCamera } from "./sky.js";
import { SPAWNS } from "./maps.js";
import { getPlanetViewAxis, configureShadowFrustum, updateSunShadow } from "./visibility.js";
import { tmp } from "./utils.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("c");
    this.keys = Object.create(null);
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x5a8fc8);
    this.scene.fog = new THREE.Fog(0x7aabdb, 55, 195);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 800);

    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);
    this.scene.add(new THREE.HemisphereLight(0x9ec8f5, 0x6a5030, 0.28));
    this.scene.add(new THREE.AmbientLight(0xffe8c8, 0.09));

    this.sun = createSun(this.planetGroup);
    configureShadowFrustum(this.sun);

    this.terrain = new Terrain(this.planetGroup);
    this.water = new Water(this.planetGroup, this.terrain);
    this.sky = new Sky(this.planetGroup);

    placeCamera(this.camera, SPAWNS[0]);

    this.camRight = new THREE.Vector3();
    this.camUp = new THREE.Vector3();

    this.#applyRendererSize();
    this.#bindInput();
    window.addEventListener("resize", () => this.#applyRendererSize());
    this.#hideLoader();
    this.#loop();
  }

  #pixelRatio() {
    const base = Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioMax);
    return Math.max(0.75, base * CONFIG.resolutionScale);
  }

  #applyRendererSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.#pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #hideLoader() {
    const el = document.getElementById("loader");
    if (!el) return;
    el.classList.add("hidden");
    setTimeout(() => el.remove(), 450);
  }

  #bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.code.startsWith("Arrow")) {
        this.keys[e.code] = true;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code.startsWith("Arrow")) {
        this.keys[e.code] = false;
        e.preventDefault();
      }
    });
  }

  #loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const rs = CONFIG.rotSpeed * dt;
    if (this.keys.ArrowLeft) this.planetGroup.rotateOnWorldAxis(this.camUp, rs);
    if (this.keys.ArrowRight) this.planetGroup.rotateOnWorldAxis(this.camUp, -rs);
    if (this.keys.ArrowUp) this.planetGroup.rotateOnWorldAxis(this.camRight, rs);
    if (this.keys.ArrowDown) this.planetGroup.rotateOnWorldAxis(this.camRight, -rs);

    this.water.update(dt);

    const viewAxis = getPlanetViewAxis(this.camera, this.planetGroup, tmp.v);
    this.terrain.setViewAxis(viewAxis);
    this.water.setViewAxis(viewAxis);

    updateSunShadow(this.sun, this.planetGroup);
    this.sky.setSunDirection(this.sun);
    this.renderer.shadowMap.autoUpdate = true;

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.#loop());
  }
}

new Game();
