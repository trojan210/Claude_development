// Post-processing: physically based underwater participating medium.
//  - per-wavelength extinction along the view ray (reds vanish first)
//  - analytic single-scattering in-scatter with depth-dependent sunlight
//  - ray-marched volumetric sun shafts (driven by the same caustic field)
//  - volumetric dive-torch cone, bloom, ACES tone mapping, mask/lens effects
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { U, UW_COMMON } from './water.js';

const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function mediumShader(steps) {
  return {
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uFrame: { value: 0 },
      uShaft: { value: 1.0 },
      uDebug: { value: 0 },
      ...U,
    },
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define STEPS ${steps}
      ${UW_COMMON}
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform mat4 uProjInv;
      uniform mat4 uCamWorld;
      uniform vec3 uCamPos;
      uniform float uFrame;
      uniform float uShaft;
      uniform float uDebug;
      varying vec2 vUv;

      float hgPhase(float cosT, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-4), 1.5));
      }
      vec3 integ(vec3 q, float D) {
        q = max(q, vec3(0.003));
        return (1.0 - exp(-q * D)) / q;
      }
      float ign(vec2 p) { // interleaved gradient noise
        return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
      }

      void main() {
        float depth = texture2D(tDepth, vUv).x;
        vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 vp4 = uProjInv * clip;
        vec3 vp = vp4.xyz / vp4.w;
        vec3 dir = normalize((uCamWorld * vec4(normalize(vp), 0.0)).xyz);
        bool bg = depth >= 0.99999;
        float D = bg ? 600.0 : length(vp);
        if (dir.y > 0.0) D = min(D, max(-uCamPos.y, 0.0) / dir.y + 0.5);

        vec3 scene = texture2D(tColor, vUv).rgb;
        if (bg) scene = vec3(0.0);
        vec3 ext = uAbs + uScat;
        vec3 T = exp(-ext * D);

        float y0 = min(uCamPos.y, 0.0);
        float mu = max(uSunDirW.y, 0.2);
        float cosSun = dot(dir, uSunDirW);
        float phSun = mix(hgPhase(cosSun, 0.86), 0.0796, 0.25);

        // analytic single scattering (sun beam + diffuse sky light, multiple scattering approximated)
        vec3 qs = ext - uKd * dir.y / mu;
        vec3 qd = ext - uKd * dir.y;
        vec3 sunIn = uSunColor * phSun * exp(uKd * y0 / mu) * integ(qs, D);
        vec3 difIn = uSkyColor * 0.0796 * 1.5 * exp(uKd * y0) * integ(qd, D);

        // ray-marched shafts and torch cone
        float Dm = min(D, 48.0);
        float jitter = ign(gl_FragCoord.xy + uFrame * 5.588238);
        vec3 shaftAcc = vec3(0.0);
        vec3 torchAcc = vec3(0.0);
        float prevS = 0.0;
        for (int i = 0; i < STEPS; i++) {
          float t = (float(i) + jitter) / float(STEPS);
          float s = Dm * t * t;
          float ds = Dm * 2.0 * t / float(STEPS);
          vec3 p = uCamPos + dir * s;
          float dpt = max(-p.y, 0.0);
          vec3 att = exp(-ext * s);
          // shafts: caustic focusing seen volumetrically
          vec2 proj = p.xz - uSunDirW.xz * (p.y / uSunDirW.y);
          float pat = texture2D(uCaustic, proj / (uCausticScale * 2.2), 2.5).r;
          pat += texture2D(uCaustic, proj / (uCausticScale * 0.9) + 0.37, 1.5).r * 0.5;
          float shaft = (pat - 0.45) * 2.0 * exp(-dpt / 22.0);
          shaftAcc += shaft * exp(-uKd * dpt / mu) * att * ds;
          // torch
          if (uTorchOn > 0.5) {
            vec3 v = p - uTorchPos;
            float dl = length(v) + 1e-3;
            vec3 vd = v / dl;
            float cone = smoothstep(0.88, 0.975, dot(vd, uTorchDir));
            float ph = mix(hgPhase(dot(vd, -dir), 0.8), 0.0796, 0.6);
            torchAcc += uTorchColor * uTorchPower * cone * ph * exp(-ext * dl) / (dl * dl + 0.35) * att * ds;
          }
        }
        sunIn += uSunColor * phSun * shaftAcc * uShaft;

        vec3 inscatter = uScat * (max(sunIn, vec3(0.0)) + difIn + torchAcc);
        vec3 col = scene * T + inscatter;
        if (uDebug > 0.5 && uDebug < 1.5) col = texture2D(tColor, vUv).rgb;
        if (uDebug > 1.5 && uDebug < 2.5) col = vec3(D / 60.0);
        if (uDebug > 2.5) col = inscatter;
        gl_FragColor = vec4(col, 1.0);
      }`,
  };
}

const finalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uTime: U.uTime,
    uRes: { value: new THREE.Vector2(1, 1) },
    uMask: { value: 1.0 },
    uFlash: { value: 0.0 },
    uWB: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uMask;
    uniform float uFlash;
    uniform vec3 uWB;
    varying vec2 vUv;
    vec3 aces(vec3 x) {
      const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      vec3 v = m1 * x;
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return clamp(m2 * (a / b), 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float aspect = uRes.x / uRes.y;
      float r = length(c * vec2(aspect, 1.0));
      // flat mask port: slight pincushion + lateral chromatic aberration toward the edges
      vec2 dirc = c * (1.0 + 0.04 * r * r);
      float ca = 0.0035 * r * r;
      vec3 col;
      col.r = texture2D(tDiffuse, 0.5 + dirc * (1.0 + ca)).r;
      col.g = texture2D(tDiffuse, 0.5 + dirc).g;
      col.b = texture2D(tDiffuse, 0.5 + dirc * (1.0 - ca)).b;
      col *= uExposure * uWB;
      col = aces(col);
      // gentle S-curve for the punchy contrast of clear tropical water
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
      col = toSRGB(col);
      // mask frame vignette
      float vig = smoothstep(1.05, 0.35, r);
      col *= mix(1.0, vig, 0.4 * uMask);
      vec2 m = abs(c) * 2.0;
      float frame = smoothstep(1.0, 0.93, pow(pow(m.x, 6.0) + pow(m.y * 1.05, 6.0), 1.0 / 6.0));
      col *= mix(1.0, frame, uMask * 0.7);
      // sensor-like grain and dithering against banding
      float g = hash(vUv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
      col += g * 0.028;
      col = mix(col, vec3(1.0), uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
    // pass ShaderMaterials (not plain objects) so shared uniforms are not cloned
    this.medium = new ShaderPass(new THREE.ShaderMaterial(mediumShader(quality.shaftSteps)), 'tUnused');
    this.medium.uniforms.tColor.value = this.sceneRT.texture;
    this.medium.uniforms.tDepth.value = this.sceneRT.depthTexture;
    this.composer.addPass(this.medium);
    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 1.6);
      this.composer.addPass(this.bloom);
    }
    this.final = new ShaderPass(new THREE.ShaderMaterial(finalShader));
    this.composer.addPass(this.final);
    this.setSize(size.x, size.y);
  }

  setSize(w, h) {
    this.sceneRT.setSize(w, h);
    this.composer.setSize(w / this.renderer.getPixelRatio(), h / this.renderer.getPixelRatio());
    this.final.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera, frame) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    const u = this.medium.uniforms;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.copy(camera.position);
    u.uFrame.value = frame % 64;
    this.composer.render();
  }
}
