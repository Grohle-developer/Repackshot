// The preview's texture shader (phase M2a): GLSL put into three's MeshPhysicalMaterial with `onBeforeCompile`,
// so the textured parts keep the preview's look (its lights, environment, shadows, outline). Pure string work: no
// three.js here, so a test assembles it against three's own shader sources without a GPU.
//
// It follows core/textures.ts line by line (the contract with the engine, M2b):
//   - coordinates in the part's own space (the `position` and `normal` attributes, millimetres, Z up) and the mesh's
//     UVs (v up; the image is read at row 1 − v, `txFlip`), turned and offset by `txXf` = R·(c ⊙ repeat) + offset;
//   - BOX blends the three axes by |n|⁴ (`txBoxW`), never mirrored on a face (`boxCoords`); CYLINDRICAL and
//     SPHERICAL turn about their axis with u 0.5 at the front, and read the image with the gradients of whichever
//     of two seams is farther (Tarini 2012: no line where the turn wraps);
//   - colour × base colour, roughness × roughness, metal × metal, alpha × opacity (or a cut-out), emission added
//     (tint × image × strength); a tangent-space normal map bends the normal in a frame built from the screen
//     derivatives of the position and the coordinates (Schüler 2013, "Followup: normal mapping without
//     precomputed tangents"); a height map, and the edge of a label, bump it from the derivatives of the height
//     (Mikkelsen 2010, "Bump mapping unparametrized surfaces on the GPU");
//   - labels, in order, laid over the colour, roughness, metal (0: paper) and clear coat by their alpha.
// Every number that can change without a new shape of the material is a uniform; what changes the code (which
// slots, their projection, axis, channel...) is in `ShaderConfig` and its key.

import { PREVIEW_LABELS_MAX, type TextureAxis, type TextureChannel, type TextureProjection, type TextureSlotKey } from '../core/textures';

/** What changes the code of one slot. */
export interface SlotShader {
  key: TextureSlotKey;
  projection: TextureProjection;
  axis: TextureAxis;
  uvSet: 0 | 1;
  channel: TextureChannel;
  /** Normal slot: a height map. */
  height: boolean;
  /** Alpha slot: a hard cut-out. */
  cutout: boolean;
}

export interface ShaderConfig {
  slots: SlotShader[];
  /** How many labels (each one its own sampler). */
  labels: number;
  /** The material emits (EMISSIVE family): the colour slot tints the emission instead of the base colour. */
  emissive: boolean;
}

/** The most labels the preview draws on one material (each is a sampler; the first ones in the list are kept). */
export const MAX_PREVIEW_LABELS = PREVIEW_LABELS_MAX;

/** Height of a label's paper edge at relief 1, mm (the bump of its alpha). */
export const LABEL_RELIEF_MM = 0.15;

/** The key three caches the program by: everything that changes the code. */
export function shaderKey(c: ShaderConfig): string {
  return `tx1|${c.emissive ? 'e' : ''}|${c.labels}|${c.slots.map((s) => `${s.key}:${s.projection}:${s.axis}:${s.uvSet}:${s.channel}:${s.height ? 'h' : ''}${s.cutout ? 'c' : ''}`).join(',')}`;
}

/** The names of the uniforms the code of a configuration reads. */
export function uniformNames(c: ShaderConfig): string[] {
  const out: string[] = [];
  for (const s of c.slots) out.push(`tx_${s.key}_map`, `tx_${s.key}_xf`, `tx_${s.key}_rs`, `tx_${s.key}_k`);
  if (c.slots.some((s) => s.key === 'emission')) out.push('tx_emission_tint');
  for (let i = 0; i < c.labels; i++) out.push(`tx_label${i}_map`, `tx_label${i}_o`, `tx_label${i}_u`, `tx_label${i}_v`, `tx_label${i}_n`, `tx_label${i}_size`, `tx_label${i}_finish`);
  return out;
}

const COMMON = /* glsl */ `
varying vec3 vTxPos;
varying vec3 vTxNrm;
varying vec2 vTxUv0;
varying vec2 vTxUv1;
// R·(c ⊙ repeat) + offset; xf = (repeat, offset), rs = (cos, sin, size across, size up).
vec2 txXf( vec2 c, vec4 xf, vec4 rs ) {
	vec2 x = c * xf.xy;
	return vec2( rs.x * x.x - rs.y * x.y, rs.y * x.x + rs.x * x.y ) + xf.zw;
}
// v up in the model, rows from the top in the image.
vec2 txFlip( vec2 uv ) { return vec2( uv.x, 1.0 - uv.y ); }
vec4 txTex( sampler2D m, vec2 uv ) { return texture( m, txFlip( uv ) ); }
vec4 txTexGrad( sampler2D m, vec2 uv, vec2 dx, vec2 dy ) { return textureGrad( m, txFlip( uv ), vec2( dx.x, - dx.y ), vec2( dy.x, - dy.y ) ); }
// Turns about an axis, -0.5..0.5, 0 facing -T.
float txTurns( float s, float t ) {
	float c = ( atan( t, s ) + 1.5707963267948966 ) / 6.283185307179586;
	return c - floor( c + 0.5 );
}
vec3 txBoxW( vec3 n ) {
	vec3 w = n * n;
	w *= w;
	return w / max( w.x + w.y + w.z, 1e-8 );
}
float txLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// A tangent-space normal (xy already scaled) in the frame of the screen derivatives of pos and uv.
vec3 txPerturb( vec3 n, vec3 pos, vec2 duv1, vec2 duv2, vec3 m ) {
	vec3 dp1 = dFdx( pos );
	vec3 dp2 = dFdy( pos );
	vec3 dp2perp = cross( dp2, n );
	vec3 dp1perp = cross( n, dp1 );
	vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
	vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
	float s = inversesqrt( max( max( dot( t, t ), dot( b, b ) ), 1e-20 ) );
	return normalize( mat3( t * s, b * s, n ) * m );
}
// The normal bumped by a height h (in the units of pos) from its screen derivatives.
vec3 txBump( vec3 n, vec3 pos, float h ) {
	vec3 dpx = dFdx( pos );
	vec3 dpy = dFdy( pos );
	float dhx = dFdx( h );
	float dhy = dFdy( h );
	vec3 r1 = cross( dpy, n );
	vec3 r2 = cross( n, dpx );
	float det = dot( dpx, r1 );
	vec3 grad = sign( det ) * ( dhx * r1 + dhy * r2 );
	return normalize( abs( det ) * n - grad );
}
`;

/** GLSL of the planar coordinates of `p` looking along an axis (core/textures.ts `planarCoords`). */
function planar(axis: TextureAxis, p: string): string {
  return axis === 'Z' ? `${p}.xy` : axis === 'Y' ? `${p}.xz` : `${p}.yz`;
}

/** GLSL of the BOX coordinates for one axis (core/textures.ts `boxCoords`). */
function boxAxis(axis: TextureAxis, p: string, n: string): string {
  if (axis === 'Z') return `vec2( ${n}.z >= 0.0 ? ${p}.x : - ${p}.x, ${p}.y )`;
  if (axis === 'Y') return `vec2( ${n}.y <= 0.0 ? ${p}.x : - ${p}.x, ${p}.z )`;
  return `vec2( ${n}.x >= 0.0 ? ${p}.y : - ${p}.y, ${p}.z )`;
}

/** Indices (into xyz) of the cross-section axes S, T and the axis itself (core/textures.ts `sectionAxes`). */
function section(axis: TextureAxis): [string, string, string] {
  if (axis === 'Z') return ['x', 'y', 'z'];
  if (axis === 'X') return ['y', 'z', 'x'];
  return ['z', 'x', 'y'];
}

function channelOf(c: TextureChannel, v: string): string {
  if (c === 'L') return `txLum( ${v}.rgb )`;
  return `${v}.${c.toLowerCase()}`;
}

/**
 * The function of one slot: `vec4 tx_K_read( vec3 p, vec3 n, out vec2 duv1, out vec2 duv2 )` gives its texel (BOX:
 * the blend of three) and the screen derivatives of its coordinates (the frame of a normal map); the normal slot
 * also gets `vec3 tx_normal_apply( vec3 nv, vec3 pos )`, which bends the view-space normal.
 */
function slotCode(s: SlotShader): string {
  const k = `tx_${s.key}`;
  const decl = `uniform sampler2D ${k}_map;\nuniform vec4 ${k}_xf;\nuniform vec4 ${k}_rs;\nuniform vec4 ${k}_k;\n`;
  const coordOf = (c: string) => `txXf( ${c}, ${k}_xf, ${k}_rs )`;
  let read: string;
  switch (s.projection) {
    case 'UV':
      read = `vec2 uv = ${coordOf(s.uvSet === 1 ? 'vTxUv1' : 'vTxUv0')};\n\tduv1 = dFdx( uv );\n\tduv2 = dFdy( uv );\n\treturn txTex( ${k}_map, uv );`;
      break;
    case 'PLANAR':
      read = `vec2 uv = ${coordOf(`${planar(s.axis, 'p')} / ${k}_rs.zw`)} + 0.5;\n\tduv1 = dFdx( uv );\n\tduv2 = dFdy( uv );\n\treturn txTex( ${k}_map, uv );`;
      break;
    case 'BOX': {
      // Three samples always (a branch would leave the derivatives of the others undefined); the frame is the axis that counts most.
      const parts = (['X', 'Y', 'Z'] as const).map((a, i) => `vec2 uv${i} = ${coordOf(`${boxAxis(a, 'p', 'n')} / ${k}_rs.zw`)} + 0.5;`).join('\n\t');
      read = `${parts}
	vec3 w = txBoxW( n );
	vec2 best = w.x >= w.y && w.x >= w.z ? uv0 : w.y >= w.z ? uv1 : uv2;
	duv1 = dFdx( best );
	duv2 = dFdy( best );
	return w.x * txTex( ${k}_map, uv0 ) + w.y * txTex( ${k}_map, uv1 ) + w.z * txTex( ${k}_map, uv2 );`;
      break;
    }
    case 'CYLINDRICAL':
    case 'SPHERICAL': {
      const [sa, ta, aa] = section(s.axis);
      const v = s.projection === 'CYLINDRICAL' ? `p.${aa} / ${k}_rs.w` : `asin( clamp( p.${aa} / max( length( p ), 1e-12 ), -1.0, 1.0 ) ) / 3.141592653589793`;
      read = `float c = txTurns( p.${sa}, p.${ta} );
	float along = ${v};
	vec2 ua = ${coordOf('vec2( c, along )')} + 0.5;
	vec2 ub = ${coordOf('vec2( c < 0.0 ? c + 1.0 : c, along )')} + 0.5;
	vec2 dxa = dFdx( ua ), dya = dFdy( ua ), dxb = dFdx( ub ), dyb = dFdy( ub );
	bool b = dot( dxa, dxa ) + dot( dya, dya ) > dot( dxb, dxb ) + dot( dyb, dyb );
	duv1 = b ? dxb : dxa;
	duv2 = b ? dyb : dya;
	return txTexGrad( ${k}_map, ua, duv1, duv2 );`;
      break;
    }
  }
  let code = `${decl}vec4 ${k}_read( vec3 p, vec3 n, out vec2 duv1, out vec2 duv2 ) {\n\t${read}\n}\n`;
  if (s.key === 'normal') {
    if (s.height) {
      // A height map: white is `strength` millimetres high (the positions are in millimetres too).
      code += `vec3 tx_normal_apply( vec3 nv, vec3 pos ) {
	vec2 d1, d2;
	vec4 t = tx_normal_read( vTxPos, normalize( vTxNrm ), d1, d2 );
	float h = ${channelOf(s.channel, 't')};
	if ( tx_normal_k.z > 0.5 ) h = 1.0 - h;
	return txBump( nv, pos, h * tx_normal_k.x );
}
`;
    } else if (s.projection === 'BOX') {
      // Each axis bends the normal in its own frame; the bent normals blend by the same weights.
      const axes = (['X', 'Y', 'Z'] as const).map((a, i) => `vec2 uv${i} = ${coordOf(`${boxAxis(a, 'p', 'n')} / ${k}_rs.zw`)} + 0.5;`).join('\n\t');
      code += `vec3 txNormalOf( vec4 t ) { return vec3( ( t.xy * 2.0 - 1.0 ) * tx_normal_k.x, t.z * 2.0 - 1.0 ); }
vec3 tx_normal_apply( vec3 nv, vec3 pos ) {
	vec3 p = vTxPos;
	vec3 n = normalize( vTxNrm );
	${axes}
	vec3 w = txBoxW( n );
	vec3 b0 = txPerturb( nv, pos, dFdx( uv0 ), dFdy( uv0 ), txNormalOf( txTex( ${k}_map, uv0 ) ) );
	vec3 b1 = txPerturb( nv, pos, dFdx( uv1 ), dFdy( uv1 ), txNormalOf( txTex( ${k}_map, uv1 ) ) );
	vec3 b2 = txPerturb( nv, pos, dFdx( uv2 ), dFdy( uv2 ), txNormalOf( txTex( ${k}_map, uv2 ) ) );
	return normalize( w.x * b0 + w.y * b1 + w.z * b2 );
}
`;
    } else {
      code += `vec3 tx_normal_apply( vec3 nv, vec3 pos ) {
	vec2 d1, d2;
	vec4 t = tx_normal_read( vTxPos, normalize( vTxNrm ), d1, d2 );
	vec3 m = vec3( ( t.xy * 2.0 - 1.0 ) * tx_normal_k.x, t.z * 2.0 - 1.0 );
	return txPerturb( nv, pos, d1, d2, m );
}
`;
    }
  }
  return code;
}

function labelCode(i: number): string {
  const k = `tx_label${i}`;
  return `uniform sampler2D ${k}_map;
uniform vec3 ${k}_o;
uniform vec3 ${k}_u;
uniform vec3 ${k}_v;
uniform vec3 ${k}_n;
uniform vec3 ${k}_size;
uniform vec3 ${k}_finish;
vec4 ${k}_read( vec3 p, vec3 n ) {
	vec3 d = p - ${k}_o;
	vec2 st = vec2( dot( d, ${k}_u ) / ${k}_size.x, dot( d, ${k}_v ) / ${k}_size.y ) + 0.5;
	float inside = step( 0.0, st.x ) * step( st.x, 1.0 ) * step( 0.0, st.y ) * step( st.y, 1.0 );
	inside *= step( abs( dot( d, ${k}_n ) ), ${k}_size.z ) * step( 1e-4, dot( n, ${k}_n ) );
	vec4 c = txTex( ${k}_map, st );
	c.a *= inside;
	return c;
}
`;
}

const has = (c: ShaderConfig, key: TextureSlotKey): SlotShader | undefined => c.slots.find((s) => s.key === key);

/** The declarations of the fragment shader (after three's own, before `main`). */
export function fragmentPars(c: ShaderConfig): string {
  return `${COMMON}${c.slots.map(slotCode).join('')}${c.slots.some((s) => s.key === 'emission') ? 'uniform vec3 tx_emission_tint;\n' : ''}${Array.from({ length: c.labels }, (_, i) => labelCode(i)).join('')}`;
}

/** Code after three's `map_fragment`: the colour slot, the alpha slot and the labels (their results stay for the chunks below). */
export function fragmentAfterMap(c: ShaderConfig): string {
  const lines: string[] = ['vec3 txP = vTxPos;', 'vec3 txN = normalize( vTxNrm );', 'vec2 txD1, txD2;', 'vec3 txColourTex = vec3( 1.0 );'];
  const colour = has(c, 'color');
  if (colour) {
    lines.push('vec4 txC = tx_color_read( txP, txN, txD1, txD2 );', 'txColourTex = txC.rgb;');
    if (!c.emissive) lines.push('diffuseColor.rgb *= txC.rgb;');
  }
  const alpha = has(c, 'alpha');
  if (alpha) {
    lines.push('vec4 txA4 = tx_alpha_read( txP, txN, txD1, txD2 );', `float txA = ${channelOf(alpha.channel, 'txA4')};`, 'if ( tx_alpha_k.z > 0.5 ) txA = 1.0 - txA;');
    // A cut-out: below the threshold nothing is drawn (glTF MASK); otherwise a coverage that blends.
    if (alpha.cutout) lines.push('if ( txA < tx_alpha_k.y ) discard;');
    else lines.push('diffuseColor.a *= txA;');
  }
  // Labels, in order, over what is under them.
  lines.push('float txLabelA = 0.0;', 'float txLabelRough = 0.0;', 'float txLabelCoat = 0.0;', 'float txLabelH = 0.0;');
  for (let i = 0; i < c.labels; i++) {
    const k = `tx_label${i}`;
    lines.push(
      `vec4 txL${i} = ${k}_read( txP, txN );`,
      `diffuseColor.rgb = mix( diffuseColor.rgb, txL${i}.rgb, txL${i}.a );`,
      `txLabelRough = mix( txLabelRough, ${k}_finish.x, txL${i}.a );`,
      `txLabelCoat = mix( txLabelCoat, ${k}_finish.y, txL${i}.a );`,
      `txLabelH += txL${i}.a * ${k}_finish.z * ${LABEL_RELIEF_MM.toFixed(4)};`,
      `txLabelA = txLabelA + txL${i}.a * ( 1.0 - txLabelA );`,
    );
  }
  return lines.map((l) => `\t${l}`).join('\n');
}

/** After `roughnessmap_fragment`. */
export function fragmentAfterRoughness(c: ShaderConfig): string {
  const lines: string[] = [];
  const r = has(c, 'roughness');
  if (r) lines.push('vec4 txR4 = tx_roughness_read( txP, txN, txD1, txD2 );', `float txR = ${channelOf(r.channel, 'txR4')};`, 'if ( tx_roughness_k.z > 0.5 ) txR = 1.0 - txR;', 'roughnessFactor *= txR;');
  if (c.labels > 0) lines.push('roughnessFactor = mix( roughnessFactor, txLabelRough / max( txLabelA, 1e-4 ), txLabelA );');
  return lines.map((l) => `\t${l}`).join('\n');
}

/** After `metalnessmap_fragment`. */
export function fragmentAfterMetalness(c: ShaderConfig): string {
  const lines: string[] = [];
  const m = has(c, 'metal');
  if (m) lines.push('vec4 txM4 = tx_metal_read( txP, txN, txD1, txD2 );', `float txM = ${channelOf(m.channel, 'txM4')};`, 'if ( tx_metal_k.z > 0.5 ) txM = 1.0 - txM;', 'metalnessFactor *= txM;');
  // Paper is not metal.
  if (c.labels > 0) lines.push('metalnessFactor *= 1.0 - txLabelA;');
  return lines.map((l) => `\t${l}`).join('\n');
}

/** After `normal_fragment_maps`: the normal slot, then the labels' paper edge. */
export function fragmentAfterNormal(c: ShaderConfig): string {
  const lines: string[] = [];
  if (has(c, 'normal')) lines.push('normal = tx_normal_apply( normal, - vViewPosition );');
  if (c.labels > 0) lines.push('normal = txBump( normal, - vViewPosition, txLabelH );');
  return lines.map((l) => `\t${l}`).join('\n');
}

/** After `emissivemap_fragment`. */
export function fragmentAfterEmissive(c: ShaderConfig): string {
  const lines: string[] = [];
  if (c.emissive && has(c, 'color')) lines.push('totalEmissiveRadiance *= txColourTex;');
  if (has(c, 'emission')) lines.push('vec4 txE = tx_emission_read( txP, txN, txD1, txD2 );', 'totalEmissiveRadiance += tx_emission_tint * txE.rgb * tx_emission_k.x;');
  // A label covers the emission under it (a sticker on a screen).
  if (c.labels > 0) lines.push('totalEmissiveRadiance *= 1.0 - txLabelA;');
  return lines.map((l) => `\t${l}`).join('\n');
}

/** After `lights_physical_fragment`: the labels' clear coat (three only has the coat code when the material has one). */
export function fragmentAfterLights(c: ShaderConfig): string {
  if (c.labels === 0) return '';
  return '\t#ifdef USE_CLEARCOAT\n\t\tmaterial.clearcoat = mix( material.clearcoat, txLabelCoat / max( txLabelA, 1e-4 ), txLabelA );\n\t#endif';
}

/** The vertex shader's part: the part-space position and normal, and both UV sets, for the fragment shader. */
export function vertexPars(): string {
  return 'varying vec3 vTxPos;\nvarying vec3 vTxNrm;\nvarying vec2 vTxUv0;\nvarying vec2 vTxUv1;\n#ifndef USE_UV1\n\tattribute vec2 uv1;\n#endif\n';
}

export function vertexMain(): string {
  return '\tvTxPos = position;\n\tvTxNrm = normal;\n\tvTxUv0 = uv;\n\tvTxUv1 = uv1;';
}

/** Puts `code` after the first `#include <chunk>` of `source`; throws when the chunk is not there (another three.js). */
function after(source: string, chunk: string, code: string): string {
  const tag = `#include <${chunk}>`;
  const at = source.indexOf(tag);
  if (at < 0) throw new Error(`texture shader: three.js has no ${tag} here`);
  if (!code) return source;
  const end = at + tag.length;
  return `${source.slice(0, end)}\n${code}\n${source.slice(end)}`;
}

/** Puts `code` before `void main()`. */
function beforeMain(source: string, code: string): string {
  const at = source.indexOf('void main()');
  if (at < 0) throw new Error('texture shader: no main');
  return `${source.slice(0, at)}${code}\n${source.slice(at)}`;
}

/** Three's physical vertex and fragment shaders with the code of a configuration in them. */
export function patchShaders(vertex: string, fragment: string, c: ShaderConfig): { vertex: string; fragment: string } {
  let v = beforeMain(vertex, vertexPars());
  v = after(v, 'begin_vertex', vertexMain());
  let f = beforeMain(fragment, fragmentPars(c));
  f = after(f, 'map_fragment', fragmentAfterMap(c));
  f = after(f, 'roughnessmap_fragment', fragmentAfterRoughness(c));
  f = after(f, 'metalnessmap_fragment', fragmentAfterMetalness(c));
  f = after(f, 'normal_fragment_maps', fragmentAfterNormal(c));
  f = after(f, 'emissivemap_fragment', fragmentAfterEmissive(c));
  f = after(f, 'lights_physical_fragment', fragmentAfterLights(c));
  return { vertex: v, fragment: f };
}
