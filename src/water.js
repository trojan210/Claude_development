// Shared underwater optics: uniforms, GLSL helpers and a material patcher that makes
// every lit surface respond physically to depth (spectral sunlight absorption,
// caustics, torch attenuation over the water path).
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uSunDirW: { value: new THREE.Vector3(0.2, 0.95, 0.15).normalize() }, // toward sun, refracted into water
  uSunDirAir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uSunColor: { value: new THREE.Color(3.2, 3.05, 2.8) },
  uSkyColor: { value: new THREE.Color(0.55, 0.75, 1.0) },
  uKd: { value: new THREE.Vector3(0.36, 0.075, 0.04) }, // diffuse attenuation of downwelling light (1/m)
  uAbs: { value: new THREE.Vector3(0.38, 0.06, 0.028) }, // absorption a (1/m), R G B
  uScat: { value: new THREE.Vector3(0.045, 0.05, 0.055) }, // scattering b (1/m)
  uCaustic: { value: null },
  uCausticScale: { value: 7.0 },
  uCausticStrength: { value: 1.0 },
  uTorchOn: { value: 0 },
  uTorchPos: { value: new THREE.Vector3() },
  uTorchDir: { value: new THREE.Vector3(0, 0, -1) },
  uTorchColor: { value: new THREE.Color(1.0, 0.97, 0.9) },
  uTorchPower: { value: 9.0 },
  uCurrent: { value: new THREE.Vector2(0.06, 0.02) },
};

/** Configure water optical properties for a dive site. */
export function setWaterProfile(p) {
  U.uAbs.value.set(...p.absorb);
  U.uScat.value.set(...p.scatter);
  U.uKd.value.set(
    p.absorb[0] + p.scatter[0] * 0.35,
    p.absorb[1] + p.scatter[1] * 0.35,
    p.absorb[2] + p.scatter[2] * 0.35,
  );
}

/** Snell refraction of the sun direction from air into water. */
export function setSun(elevationDeg, azimuthDeg) {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const air = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  U.uSunDirAir.value.copy(air);
  const sinT = Math.cos(el) / 1.333; // horizontal component shrinks
  const cosT = Math.sqrt(1 - sinT * sinT);
  U.uSunDirW.value.set(Math.sin(az) * sinT, cosT, Math.cos(az) * sinT).normalize();
}

// GLSL shared by materials and post-processing
export const UW_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uKd;
uniform vec3 uAbs;
uniform vec3 uScat;
uniform sampler2D uCaustic;
uniform float uCausticScale;
uniform float uCausticStrength;
uniform float uTorchOn;
uniform vec3 uTorchPos;
uniform vec3 uTorchDir;
uniform vec3 uTorchColor;
uniform float uTorchPower;

// Downwelling sunlight transmittance to a point at world height y (<0 underwater)
vec3 uwSunTrans(float y) {
  float d = max(-y, 0.0);
  return exp(-uKd * d / max(uSunDirW.y, 0.2));
}
vec3 uwDiffTrans(float y) {
  return exp(-uKd * max(-y, 0.0));
}
#ifndef UW_NO_CAUSTICS
// Surface-wave caustics projected along the refracted sun ray. Returns a multiplier (mean ~1).
vec3 uwCaustics(vec3 wp, float blurBias) {
  float d = max(-wp.y, 0.0);
  vec2 p = wp.xz - uSunDirW.xz * (wp.y / uSunDirW.y);
  vec2 uv = p / uCausticScale;
  // caustic lines widen and lose contrast with depth (focal spread)
  float spread = 0.0015 + d * 0.00035;
  vec3 c;
  c.r = texture2D(uCaustic, uv + vec2(spread, 0.0), blurBias).r;
  c.g = texture2D(uCaustic, uv, blurBias).r;
  c.b = texture2D(uCaustic, uv - vec2(spread, spread * 0.5), blurBias).r;
  vec2 uv2 = uv * 0.43 + vec2(0.31, 0.77);
  float big = texture2D(uCaustic, uv2, blurBias + 1.0).r;
  c = mix(c, vec3(big), smoothstep(4.0, 22.0, d) * 0.6);
  float contrast = uCausticStrength * (0.18 + 1.25 * exp(-d / 11.0));
  return max(vec3(1.0) + (c - 0.32) * contrast * 2.6, vec3(0.15));
}
// world-space triplanar normal perturbation (whiteout blend); returns perturbed world normal
vec3 uwTriplanarNormal(sampler2D tex, vec3 wp, vec3 n, float scale, float strength) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 tx = texture2D(tex, wp.zy * scale).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(tex, wp.xz * scale).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(tex, wp.xy * scale).xyz * 2.0 - 1.0;
  tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
  vec3 nx = vec3(tx.xy + n.zy, abs(tx.z) * n.x).zyx;
  vec3 ny = vec3(ty.xy + n.xz, abs(ty.z) * n.y).xzy;
  vec3 nz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(nx * w.x + ny * w.y + nz * w.z);
}
float uwTriplanarScalar(sampler2D tex, vec3 wp, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(tex, wp.zy * scale).r * w.x + texture2D(tex, wp.xz * scale).r * w.y + texture2D(tex, wp.xy * scale).r * w.z;
}
#endif
// Downwelling diffuse (sky) irradiance for a world normal at height y
vec3 uwAmbient(vec3 nW, float y) {
  float up = nW.y * 0.5 + 0.5;
  vec3 down = uSkyColor * mix(0.07, 1.0, up * up);
  // upwelling light from the sand and water column is distinctly blue-green
  down += vec3(0.02, 0.07, 0.10) * (1.0 - up);
  return down * 2.0 * uwDiffTrans(y);
}
`;

/**
 * Patch a built-in lit material so it is lit like it's underwater.
 * opts.vertex: { pars, begin } GLSL snippets injected in the vertex shader
 */
export function patchUW(mat, opts = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    for (const k of ['uTime', 'uSunDirW', 'uSunColor', 'uSkyColor', 'uKd', 'uAbs', 'uScat', 'uCaustic',
      'uCausticScale', 'uCausticStrength', 'uTorchOn', 'uTorchPos', 'uTorchDir', 'uTorchColor', 'uTorchPower']) {
      shader.uniforms[k] = U[k];
    }
    if (opts.uniforms) Object.assign(shader.uniforms, opts.uniforms);

    if (opts.vertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\n${opts.vertex.pars || ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertex.begin || ''}`);
      if (opts.vertex.normal) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${opts.vertex.normal}`);
      }
    }

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>\n${UW_COMMON}\n${opts.fragPars || ''}`);
    if (opts.fragColor) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${opts.fragColor}`);
    if (opts.fragNormal) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${opts.fragNormal}`);
    const causticLine = opts.noCaustics ? '' : 'directLight.color *= uwCaustics(uwWorldPos, 0.0);';
    fs = fs.replace('#include <lights_fragment_begin>', `
      vec3 uwWorldPos = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz + cameraPosition;
      ${THREE.ShaderChunk.lights_fragment_begin
        .replace('getDirectionalLightInfo( directionalLight, directLight );',
          `getDirectionalLightInfo( directionalLight, directLight );
           directLight.color *= uwSunTrans(uwWorldPos.y);
           ${causticLine}`)
        .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );',
          `getSpotLightInfo( spotLight, geometryPosition, directLight );
           directLight.color *= exp(-(uAbs + uScat * 0.4) * length(spotLight.position - geometryPosition));`)
        .replace('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
          `vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
           irradiance += uwAmbient(inverseTransformDirection(geometryNormal, viewMatrix), uwWorldPos.y) * ${(opts.ambient ?? 1).toFixed(3)};`)}
    `);
    if (opts.fragEnd) fs = fs.replace('#include <opaque_fragment>', `${opts.fragEnd}\n#include <opaque_fragment>`);
    shader.fragmentShader = fs;
    if (prev) prev(shader, renderer);
  };
  mat.customProgramCacheKey = () => 'uw-' + (opts.key || mat.type) + (opts.noCaustics ? '-nc' : '');
  return mat;
}
