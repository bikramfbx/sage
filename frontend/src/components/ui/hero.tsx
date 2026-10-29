"use client"

/**
 * Aurora Hero — a vast sheet of silk drifting toward the horizon, shaded with
 * thin-film iridescence.
 *
 * Everything is procedural: the surface is a subdivided plane displaced by
 * fbm noise in the vertex stage, and the colour comes from a fresnel-driven
 * ramp rather than any texture or environment map. No models, no HDRI, no
 * external assets — so it survives being pasted into a sandbox with no network.
 */

import * as React from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

/* -------------------------------------------------------------------------- */
/*  Shaders                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ashima / Stefan Gustavson simplex noise (MIT). Value noise leaves visible
 * grid artefacts on a surface this smooth and this close to the camera, which
 * is the whole reason for carrying the extra lines.
 */
const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`

const VERT = /* glsl */ `
${SIMPLEX}

uniform float uTime;
uniform float uAmp;
uniform float uFreq;

varying vec3  vWorld;
varying vec3  vNormal;
varying vec2  vUv;
varying float vH;

/**
 * One dominant low-frequency fold plus decaying detail. A textbook fbm gives
 * every octave similar visual weight, which reads as rough terrain; fabric is
 * a few long folds with fine creases riding on top.
 *
 * The x/y anisotropy is what makes it cloth rather than dunes — real folds run
 * in a direction, they do not form a lumpy field.
 */
float surface(vec2 xy, float t){
  vec2 q = xy * vec2(uFreq * 0.55, uFreq * 1.75);
  float h = snoise(vec3(q, t));
#if OCTAVES > 1
  h += 0.26 * snoise(vec3(q * 2.15 + 17.0, t * 1.35));
#endif
#if OCTAVES > 2
  h += 0.085 * snoise(vec3(q * 4.4 + 31.0, t * 1.9));
#endif
  return h;
}

void main(){
  vUv = uv;
  vec3 p = position;

  float t = uTime * 0.075;

  // Settle the near edge so the sheet meets the viewport cleanly instead of
  // clipping through the camera.
  float settle = smoothstep(0.0, 0.30, vUv.y);
  float amp = uAmp * settle;

  float h = surface(p.xy, t);
  p.z += h * amp;
  vH = h;

  // Finite-difference normal. Screen-space derivatives are cheaper but they
  // shade the flat triangle rather than the surface, which is exactly what
  // made the first pass look like faceted rock.
  float e = 0.18;
  float hx = surface(p.xy + vec2(e, 0.0), t) * amp;
  float hy = surface(p.xy + vec2(0.0, e), t) * amp;
  vec3 tx = vec3(e, 0.0, hx - h * amp);
  vec3 ty = vec3(0.0, e, hy - h * amp);
  vNormal = normalize(normalMatrix * normalize(cross(tx, ty)));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FRAG = /* glsl */ `
uniform vec3  uA;
uniform vec3  uB;
uniform vec3  uC;
uniform vec3  uBg;
uniform float uTime;
uniform float uSheen;

varying vec3  vWorld;
varying vec3  vNormal;
varying vec2  vUv;
varying float vH;

vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uA, uB, t * 2.0) : mix(uB, uC, (t - 0.5) * 2.0);
}

void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(n, v));

  float fres = pow(1.0 - ndv, 2.6);

  // Thin-film banding. Weighted toward view angle rather than height so the
  // hue sweeps in broad continuous bands along each fold — height-dominant
  // banding just speckles the noise back onto the surface.
  //
  // The 0.62 phase offset matters: fres sits near zero across most of a sheet
  // facing the camera, so without it the ramp parks on its middle stop and the
  // first colour never appears at all.
  float phase = fres * 1.35 + vH * 0.20 + uTime * 0.02 + 0.62;
  float band  = 0.5 + 0.5 * sin(6.2831 * phase);
  vec3 col = ramp(band);

  // Two lights at opposing rakes. One sheen line reads as plastic; the second,
  // dimmer and colder, is what suggests a fabric weave catching the room.
  vec3 l1 = normalize(vec3(0.30, 0.86, 0.42));
  vec3 l2 = normalize(vec3(-0.55, 0.42, 0.72));
  float s1 = pow(max(dot(reflect(-l1, n), v), 0.0), 52.0);
  float s2 = pow(max(dot(reflect(-l2, n), v), 0.0), 22.0);
  col += s1 * uSheen + s2 * uSheen * 0.30;

  // Diffuse wrap keeps the troughs from going flat black.
  float wrap = clamp(dot(n, l1) * 0.5 + 0.5, 0.0, 1.0);
  col *= 0.34 + 0.58 * wrap;

  // Distance haze — the far edge dissolves into the page instead of ending.
  float depth = smoothstep(-13.0, 1.0, vWorld.z);
  col = mix(uBg, col, depth);

  float edge = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
  float alpha = edge * depth;

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`

/* -------------------------------------------------------------------------- */
/*  Adaptive quality                                                          */
/* -------------------------------------------------------------------------- */

type Quality = "low" | "medium" | "high"

interface QualitySpec {
  /** Plane subdivisions. The vertex stage runs fbm per vertex, so this is the
   *  dominant cost — far more than fragment work at these resolutions. */
  segments: number
  octaves: number
  maxDpr: number
  sheen: number
}

const QUALITY: Record<Quality, QualitySpec> = {
  // surface() only branches up to three octaves; a higher number here
  // would silently do nothing.
  low: { segments: 110, octaves: 2, maxDpr: 1.25, sheen: 0.42 },
  medium: { segments: 168, octaves: 3, maxDpr: 1.5, sheen: 0.5 },
  high: { segments: 232, octaves: 3, maxDpr: 1.75, sheen: 0.55 },
}

function subscribeToViewport(cb: () => void) {
  window.addEventListener("resize", cb)
  return () => window.removeEventListener("resize", cb)
}

function detectQuality(): Quality {
  if (typeof window === "undefined") return "medium"
  const cores = navigator.hardwareConcurrency ?? 4
  const w = window.innerWidth
  if (w < 768 || cores <= 4) return "low"
  if (w < 1440 || cores <= 8) return "medium"
  return "high"
}

/* -------------------------------------------------------------------------- */
/*  Entrance motion                                                           */
/* -------------------------------------------------------------------------- */

const ENTER = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 96, damping: 17, mass: 0.9 },
  },
}

const GROUP = {
  hidden: {},
  show: { transition: { staggerChildren: 0.11, delayChildren: 0.15 } },
}

/* -------------------------------------------------------------------------- */
/*  Scene                                                                     */
/* -------------------------------------------------------------------------- */

interface SilkProps {
  spec: QualitySpec
  colors: [string, string, string]
  background: string
  amplitude: number
  scale: number
  staticTime?: number
  paused: boolean
}

function Silk({ spec, colors, background, amplitude, scale, staticTime, paused }: SilkProps) {
  const matRef = React.useRef<THREE.ShaderMaterial>(null)
  const { size } = useThree()
  // A placement tuned for landscape fills a tall viewport corner to corner and
  // leaves the copy nowhere to sit.
  const portrait = size.height > size.width

  const uniforms = React.useMemo(
    () => ({
      uTime: { value: staticTime ?? 0 },
      uAmp: { value: amplitude },
      uFreq: { value: scale },
      uSheen: { value: spec.sheen },
      uA: { value: new THREE.Color(colors[0]) },
      uB: { value: new THREE.Color(colors[1]) },
      uC: { value: new THREE.Color(colors[2]) },
      uBg: { value: new THREE.Color(background) },
    }),
    // Built once. Everything below is pushed in through the ref instead, so a
    // colour change never resets the clock mid-drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Reaching the material through the ref rather than mutating `uniforms`
  // directly is what keeps the React Compiler's immutability rule satisfied.
  React.useEffect(() => {
    const m = matRef.current
    if (!m) return
    m.uniforms.uAmp.value = amplitude
    m.uniforms.uFreq.value = scale
    m.uniforms.uSheen.value = spec.sheen
    m.uniforms.uA.value.set(colors[0])
    m.uniforms.uB.value.set(colors[1])
    m.uniforms.uC.value.set(colors[2])
    m.uniforms.uBg.value.set(background)
  }, [amplitude, scale, spec.sheen, colors, background])

  useFrame((_, delta) => {
    const m = matRef.current
    if (!m) return
    if (staticTime !== undefined) {
      m.uniforms.uTime.value = staticTime
      return
    }
    if (!paused) m.uniforms.uTime.value += delta
  })

  return (
    // Laid flat and receding, not stood up facing the camera. Looking *down*
    // across the folds is what shows the sheen travelling along them; edge-on
    // you only ever see a jagged silhouette.
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={portrait ? [0, -2.35, -8.5] : [0, -1.85, -6]}
    >
      <planeGeometry args={[30, 22, spec.segments, spec.segments]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        defines={{ OCTAVES: spec.octaves }}
        transparent
        // A transparent surface still writes depth by default and would occlude
        // anything placed behind it.
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/* -------------------------------------------------------------------------- */
/*  Public component                                                          */
/* -------------------------------------------------------------------------- */

export interface AuroraHeroProps {
  eyebrow?: string
  headline?: string
  description?: string
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  /** Small facts strip along the bottom. */
  meta?: string[]
  /** Three stops of the iridescent ramp, low band to high. */
  colors?: [string, string, string]
  background?: string
  foreground?: string
  accent?: string
  /** Fold depth. 0.35 is a calm drape, 1.2 is heavy fabric. */
  amplitude?: number
  /** Noise frequency — lower is broader, slower folds. */
  scale?: number
  /** CSS font-family for the headline. */
  displayFont?: string
  italicHeadline?: boolean
  /** Pin the clock to a fixed value and stop animating. Needed for covers and
   *  thumbnails, which are captured without any chance to scroll or wait. */
  staticTime?: number
  /** Extra objects rendered inside the R3F canvas. */
  sceneChildren?: React.ReactNode
  /** Adds top padding so the copy clears a fixed site header. */
  topInset?: boolean
  className?: string
}

export function AuroraHero({
  eyebrow = "Bevel UI",
  headline = "Iridescence",
  description =
    "A sheet of silk drifting toward the horizon, shaded by thin-film interference. Procedural geometry, procedural colour — no textures, no environment map, no external assets.",
  action,
  secondaryAction,
  meta = ["Simplex displacement", "Thin-film shading", "Zero assets"],
  colors = ["#7E2F63", "#C9A961", "#2F7C86"],
  background = "#08080B",
  foreground = "#EDE8DF",
  accent = "#C9A961",
  amplitude = 0.7,
  scale = 0.16,
  displayFont = "var(--font-display), 'Bodoni Moda', Georgia, serif",
  italicHeadline = false,
  staticTime,
  sceneChildren,
  topInset = false,
  className,
}: AuroraHeroProps) {
  const sectionRef = React.useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = React.useState(true)
  const prefersReduced = useReducedMotion()

  // Server snapshot keeps hydration deterministic and the tier re-evaluates
  // for free when the window crosses a breakpoint.
  const quality = React.useSyncExternalStore(
    subscribeToViewport,
    detectQuality,
    () => "medium" as Quality
  )
  const spec = QUALITY[quality]

  // The fbm vertex pass is the most expensive thing on the page; there is no
  // reason to keep paying for it once the hero has scrolled away.
  React.useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: "120px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const pinned = staticTime !== undefined
  const frozen = pinned || !!prefersReduced

  return (
    <MotionConfig reducedMotion="user">
      <section
        ref={sectionRef}
        className={[
          "relative isolate grid h-[100svh] max-h-full min-h-[540px] w-full place-items-center overflow-hidden",
          className ?? "",
        ].join(" ")}
        style={{ background, color: foreground }}
      >
        {/* Decorative. The headline is real DOM text above this, so there is
            nothing here for a screen reader to gain. */}
        <div aria-hidden className="absolute inset-0 z-0">
          <Canvas
            dpr={[1, spec.maxDpr]}
            gl={{ antialias: true, alpha: true }}
            camera={{ position: [0, 2.05, 3.4], fov: 40 }}
            frameloop={pinned ? "demand" : onScreen ? "always" : "never"}
          >
            <Silk
              spec={spec}
              colors={colors}
              background={background}
              amplitude={amplitude}
              scale={scale}
              staticTime={staticTime}
              paused={frozen}
            />
            {sceneChildren}
          </Canvas>
        </div>

        {/* Scrim. The silk is bright enough in places to drop body copy below
            4.5:1, and a hero that is beautiful and unreadable is neither. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background: [
              `linear-gradient(180deg, ${background} 0%, ${background}F7 40%, ${background}E0 58%, ${background}8C 72%, ${background}1F 84%, ${background}00 93%)`,
              `linear-gradient(0deg, ${background}A6 0%, ${background}47 14%, ${background}00 34%)`,
            ].join(", "),
          }}
        />

        <motion.div
          variants={GROUP}
          // A pinned frame is a cover shot: it wants the settled composition,
          // not whatever the entrance happened to be doing.
          initial={pinned ? "show" : "hidden"}
          animate="show"
          className={[
            "relative z-[2] mx-auto flex w-[min(100%-2.5rem,62rem)] flex-col items-center gap-4 text-center sm:gap-6",
            topInset ? "pt-24 sm:pt-28" : "pt-10 sm:pt-14",
            "pb-10 sm:pb-14",
          ].join(" ")}
        >
          {eyebrow ? (
            <motion.p
              variants={ENTER}
              className="m-0 font-[family-name:var(--font-mono,ui-monospace)] text-[11px] uppercase tracking-[0.34em] opacity-80"
              style={{ color: accent }}
            >
              {eyebrow}
            </motion.p>
          ) : null}

          <motion.h1
            variants={ENTER}
            className="m-0 text-[clamp(2.75rem,9vw,7rem)] font-normal leading-[0.98] tracking-[-0.02em]"
            style={{
              fontFamily: displayFont,
              fontStyle: italicHeadline ? "italic" : "normal",
              color: foreground,
            }}
          >
            {headline}
          </motion.h1>

          {description ? (
            <motion.p
              variants={ENTER}
              className="m-0 max-w-[44ch] font-[family-name:var(--font-body,ui-sans-serif)] text-[15px] leading-relaxed opacity-80 sm:text-[17px]"
              style={{ color: foreground }}
            >
              {description}
            </motion.p>
          ) : null}

          {action || secondaryAction ? (
            <motion.div
              variants={ENTER}
              className="mt-2 flex flex-wrap justify-center gap-3"
            >
              {action}
              {secondaryAction}
            </motion.div>
          ) : null}

          {meta?.length ? (
            // Hidden on phones by CSS rather than by measuring the viewport in
            // JS: a JS breakpoint renders the desktop layout on the server and
            // snaps on hydration.
            <motion.ul
              variants={ENTER}
              className="mt-8 hidden list-none flex-wrap justify-center gap-x-8 gap-y-3 p-0 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.18em] opacity-60 sm:mt-12 sm:flex"
              style={{ color: foreground }}
            >
              {meta.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </motion.ul>
          ) : null}
        </motion.div>
      </section>
    </MotionConfig>
  )
}

export default AuroraHero
