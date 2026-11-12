/**
 * A project's default glyph: one of a family of simple geometric compositions,
 * picked and shaped by a hash of the seed. White on transparent, viewBox 64×64,
 * meant to sit on the project's tinted tile.
 */

type Random = () => number;

const SOLID = 'fill="#fff"';
const SOFT = 'fill="#fff" fill-opacity=".55"';
const strokeAttrs = (width: number, opacity = 1) =>
  `fill="none" stroke="#fff" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${
    opacity === 1 ? "" : ` stroke-opacity="${opacity}"`
  }`;

const n = (value: number) => String(Math.round(value * 100) / 100);
const range = (random: Random, min: number, max: number) => min + random() * (max - min);
const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!;
const rotate = (degrees: number) => (degrees === 0 ? "" : ` transform="rotate(${degrees} 32 32)"`);

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): Random {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function orbit(random: Random): string {
  const tilt = pick(random, [-35, -20, 20, 35]);
  const ry = range(random, 7, 10);
  const angle = pick(random, [0.35, 0.8, 2.3, 2.8]) * Math.PI;
  const x = 32 + 22 * Math.cos(angle);
  const y = 32 + ry * Math.sin(angle);
  return [
    `<ellipse cx="32" cy="32" rx="22" ry="${n(ry)}" ${strokeAttrs(3.5, 0.6)}${rotate(tilt)}/>`,
    `<circle cx="32" cy="32" r="${n(range(random, 8.5, 11))}" ${SOLID}/>`,
    `<circle cx="${n(x)}" cy="${n(y)}" r="3.5" ${SOLID}${rotate(tilt)}/>`,
  ].join("");
}

function overlap(random: Random): string {
  if (random() < 0.5) {
    return `<g${rotate(pick(random, [0, 45, 90, -45]))}><circle cx="24" cy="32" r="14" ${SOLID}/><circle cx="40" cy="32" r="14" ${SOFT}/></g>`;
  }
  const offset = pick(random, [-90, 90, 0, 180]);
  const radius = range(random, 8, 10);
  const opacities = [1, 0.7, 0.45];
  return opacities
    .map((opacity, index) => {
      const angle = ((offset + index * 120) * Math.PI) / 180;
      return `<circle cx="${n(32 + radius * Math.cos(angle))}" cy="${n(32 + radius * Math.sin(angle))}" r="12.5" fill="#fff"${
        opacity === 1 ? "" : ` fill-opacity="${opacity}"`
      }/>`;
    })
    .join("");
}

function bars(random: Random): string {
  const count = pick(random, [3, 4]);
  if (random() < 0.5) {
    const height = count === 3 ? 9 : 7;
    const gap = 5;
    const top = 32 - (count * height + (count - 1) * gap) / 2;
    const centered = random() < 0.4;
    return Array.from({ length: count }, (_, index) => {
      const width = index === 0 ? 40 : Math.round(range(random, 18, 36));
      const x = centered ? 32 - width / 2 : 12;
      return `<rect x="${n(x)}" y="${n(top + index * (height + gap))}" width="${width}" height="${height}" rx="${n(height / 2)}" ${index === 0 ? SOLID : SOFT}/>`;
    }).join("");
  }
  const width = count === 3 ? 10 : 8;
  const gap = count === 3 ? 5 : 4;
  const left = 32 - (count * width + (count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, index) => {
    const last = index === count - 1;
    const height = last ? 38 : Math.round(range(random, 12, 32));
    return `<rect x="${n(left + index * (width + gap))}" y="${50 - height}" width="${width}" height="${height}" rx="${n(width / 2)}" ${last ? SOLID : SOFT}/>`;
  }).join("");
}

function dotGrid(random: Random): string {
  const cells = Array.from({ length: 9 }, (_, index) => index);
  const missing = new Set<number>();
  const missingCount = 1 + Math.floor(random() * 3);
  while (missing.size < missingCount) {
    const cell = Math.floor(random() * 9);
    if (cell !== 4) missing.add(cell);
  }
  const present = cells.filter((cell) => !missing.has(cell));
  const lit = new Set([4, pick(random, present), pick(random, present)]);
  return present
    .map((cell) => {
      const x = 18 + (cell % 3) * 14;
      const y = 18 + Math.floor(cell / 3) * 14;
      return lit.has(cell)
        ? `<circle cx="${x}" cy="${y}" r="5.5" ${SOLID}/>`
        : `<circle cx="${x}" cy="${y}" r="4.5" ${SOFT}/>`;
    })
    .join("");
}

function chevrons(random: Random): string {
  const count = pick(random, [2, 3]);
  const spacing = 11;
  const start = 32 - ((count - 1) * spacing + 12) / 2;
  const opacities = count === 2 ? [0.55, 1] : [0.4, 0.7, 1];
  const body = opacities
    .map((opacity, index) => {
      const x = start + index * spacing;
      return `<path d="M${n(x)} 18 L${n(x + 12)} 32 L${n(x)} 46" ${strokeAttrs(6, opacity)}/>`;
    })
    .join("");
  return `<g${rotate(pick(random, [0, -90, 90, 0]))}>${body}</g>`;
}

function quarters(random: Random): string {
  const size = 19;
  const origins = [
    [12, 12],
    [33, 12],
    [12, 33],
    [33, 33],
  ] as const;
  return origins
    .map(([x, y], index) => {
      const fill = index === 0 || index === 3 ? SOLID : SOFT;
      const cx = x + size / 2;
      const cy = y + size / 2;
      if (random() < 0.2) return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(size / 2)}" ${fill}/>`;
      const turn = Math.floor(random() * 4) * 90;
      return `<path d="M${x} ${y} H${x + size} A${size} ${size} 0 0 1 ${x} ${y + size} Z" ${fill}${
        turn === 0 ? "" : ` transform="rotate(${turn} ${n(cx)} ${n(cy)})"`
      }/>`;
    })
    .join("");
}

function hexagonPoints(cx: number, cy: number, radius: number, pointyTop: boolean): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((index * 60 + (pointyTop ? -90 : 0)) * Math.PI) / 180;
    return `${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))}`;
  }).join(" ");
}

function hexagons(random: Random): string {
  const pointyTop = random() < 0.5;
  if (random() < 0.5) {
    return [
      `<polygon points="${hexagonPoints(32, 32, 20, pointyTop)}" ${strokeAttrs(5)}/>`,
      `<polygon points="${hexagonPoints(32, 32, range(random, 7, 9.5), pointyTop)}" ${SOLID}/>`,
    ].join("");
  }
  // Three touching cells; the odd one out is softer.
  const radius = 10.5;
  const width = Math.sqrt(3) * radius;
  const soft = Math.floor(random() * 3);
  const centers = [
    [32 - width / 2, 25],
    [32 + width / 2, 25],
    [32, 25 + radius * 1.5],
  ] as const;
  return centers
    .map(
      ([cx, cy], index) =>
        `<polygon points="${hexagonPoints(cx, cy, radius - 1, true)}" ${index === soft ? SOFT : SOLID}/>`,
    )
    .join("");
}

function waves(random: Random): string {
  const count = pick(random, [2, 3]);
  const amplitude = range(random, 4, 6.5);
  const spacing = count === 2 ? 13 : 11;
  const top = 32 - ((count - 1) * spacing) / 2;
  const body = Array.from({ length: count }, (_, index) => {
    const y = top + index * spacing;
    return `<path d="M12 ${n(y)} Q17 ${n(y - amplitude)} 22 ${n(y)} T32 ${n(y)} T42 ${n(y)} T52 ${n(y)}" ${strokeAttrs(5.5, index === 0 ? 1 : 0.55)}/>`;
  }).join("");
  return `<g${rotate(pick(random, [0, 0, -15, 15]))}>${body}</g>`;
}

function peaks(random: Random): string {
  const body = [
    `<path d="M40 24 L57 50 H23 Z" ${SOFT} stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="M25 ${n(range(random, 14, 19))} L44 50 H7 Z" ${SOLID} stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`,
    `<circle cx="${n(range(random, 48, 51))}" cy="${n(range(random, 12, 15))}" r="${n(range(random, 4.5, 5.5))}" ${SOLID}/>`,
  ].join("");
  return random() < 0.5 ? `<g transform="matrix(-1 0 0 1 64 0)">${body}</g>` : body;
}

function gauge(random: Random): string {
  const radius = 19;
  const start = pick(random, [-90, 0, 90, 180, -45, 135]);
  const sweep = pick(random, [90, 150, 210, 270]);
  const point = (degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return `${n(32 + radius * Math.cos(angle))} ${n(32 + radius * Math.sin(angle))}`;
  };
  return [
    `<circle cx="32" cy="32" r="${radius}" ${strokeAttrs(5.5, 0.4)}/>`,
    `<path d="M${point(start)} A${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${point(start + sweep)}" ${strokeAttrs(5.5)}/>`,
    `<circle cx="32" cy="32" r="${n(range(random, 5, 7.5))}" ${SOLID}/>`,
  ].join("");
}

function sparkPath(cx: number, cy: number, radius: number): string {
  const pinch = radius * 0.16;
  return [
    `M${n(cx)} ${n(cy - radius)}`,
    `Q${n(cx + pinch)} ${n(cy - pinch)} ${n(cx + radius)} ${n(cy)}`,
    `Q${n(cx + pinch)} ${n(cy + pinch)} ${n(cx)} ${n(cy + radius)}`,
    `Q${n(cx - pinch)} ${n(cy + pinch)} ${n(cx - radius)} ${n(cy)}`,
    `Q${n(cx - pinch)} ${n(cy - pinch)} ${n(cx)} ${n(cy - radius)}Z`,
  ].join(" ");
}

function sparks(random: Random): string {
  const mirrored = random() < 0.5;
  const big = { x: mirrored ? 36 : 28, y: 35, r: range(random, 17, 20) };
  const small = { x: mirrored ? 17 : 47, y: 17, r: range(random, 6, 8) };
  return [
    `<path d="${sparkPath(big.x, big.y, big.r)}" ${SOLID}/>`,
    `<path d="${sparkPath(small.x, small.y, small.r)}" ${SOFT}/>`,
  ].join("");
}

function halves(random: Random): string {
  const gap = range(random, 2.5, 4.5);
  const body = [
    `<path d="M${n(32 - gap / 2)} 14 A18 18 0 0 0 ${n(32 - gap / 2)} 50 Z" ${SOLID}/>`,
    `<path d="M${n(32 + gap / 2)} 14 A18 18 0 0 1 ${n(32 + gap / 2)} 50 Z" ${SOFT}/>`,
  ].join("");
  return `<g${rotate(pick(random, [0, 45, 90, 135, -45]))}>${body}</g>`;
}

const COMPOSITIONS = [
  orbit,
  overlap,
  bars,
  dotGrid,
  chevrons,
  quarters,
  hexagons,
  waves,
  peaks,
  gauge,
  sparks,
  halves,
] as const;

/** The same seed always draws the same glyph. */
export function generatedProjectIconSvg(seed: string): string {
  const hash = fnv1a(seed.normalize("NFKC").trim().toLocaleLowerCase("en-US") || "project");
  const compose = COMPOSITIONS[hash % COMPOSITIONS.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${compose(mulberry32(hash))}</svg>`;
}
