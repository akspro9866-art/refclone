#!/usr/bin/env node
/**
 * scripts/fetch-brand-logo.mjs
 * Universal Brand & Project Logo Resolver
 *
 * Setiap kali konten video menyebutkan brand, framework, aplikasi, atau nama project:
 * 1. Cek folder project/repo lokal (--project-dir) untuk mengambil file logo asli milik project tersebut (logo.svg, icon.svg, favicon.svg, logo.png).
 * 2. Ambil SVG vektor resmi dari registry publik:
 *    - svgl.app API (https://api.svgl.app?search=<brand>) -> SVG resmi full-color
 *    - Simple Icons CDN (https://cdn.simpleicons.org/<slug>) -> 3,200+ SVG resmi brand dunia
 * 3. Simpan ke `public/brands/<slug>.svg` agar dapat dirender langsung dengan `<BrandLogo brand="<slug>" />`.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const SLUG_ALIASES = {
  claude: 'claude',
  'claude-code': 'anthropic',
  anthropic: 'anthropic',
  remotion: 'remotion',
  adobe: 'adobe',
  'after-effects': 'adobeaftereffects',
  aftereffects: 'adobeaftereffects',
  'premiere-pro': 'adobepremierepro',
  premiere: 'adobepremierepro',
  photoshop: 'adobephotoshop',
  illustrator: 'adobeillustrator',
  capcut: 'capcut',
  davinci: 'davinciresolve',
  'davinci-resolve': 'davinciresolve',
  react: 'react',
  typescript: 'typescript',
  javascript: 'javascript',
  nextjs: 'nextdotjs',
  nodejs: 'nodedotjs',
  tailwind: 'tailwindcss',
  github: 'github',
  vscode: 'visualstudiocode',
  openai: 'openai',
  figma: 'figma',
  vercel: 'vercel',
  supabase: 'supabase',
  docker: 'docker',
  tiktok: 'tiktok',
  instagram: 'instagram',
  youtube: 'youtube',
  whatsapp: 'whatsapp',
  x: 'x',
  twitter: 'x',
  apple: 'apple',
  google: 'google',
  chrome: 'googlechrome',
  safari: 'safari',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'motion-craft/2.2' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchUrl(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

function findLocalProjectLogo(projectDir, brandName) {
  if (!projectDir || !fs.existsSync(projectDir)) return null;
  const candidates = [
    'public/logo.svg',
    'public/icon.svg',
    'public/favicon.svg',
    'src/assets/logo.svg',
    'assets/logo.svg',
    'logo.svg',
    'icon.svg',
    `public/${brandName}.svg`,
  ];
  for (const rel of candidates) {
    const full = path.join(projectDir, rel);
    if (fs.existsSync(full)) {
      return fs.readFileSync(full, 'utf8');
    }
  }
  return null;
}

async function resolveBrandSvg(rawName, projectDir) {
  const clean = rawName.trim().toLowerCase().replace(/\s+/g, '-');
  const simpleSlug = SLUG_ALIASES[clean] || clean.replace(/[^a-z0-9]/g, '');

  // 1. Cek di folder project lokal terlebih dahulu
  const localSvg = findLocalProjectLogo(projectDir, clean);
  if (localSvg && localSvg.includes('<svg')) {
    return { slug: clean, source: 'local-project', svg: localSvg };
  }

  // 2. Coba svgl.app API (SVG resmi full-color)
  try {
    const apiJson = await fetchUrl(`https://api.svgl.app?search=${encodeURIComponent(clean)}`);
    const items = JSON.parse(apiJson);
    if (Array.isArray(items) && items.length > 0) {
      const match = items[0];
      const route = typeof match.route === 'string' ? match.route : match.route?.dark || match.route?.light;
      if (route && route.startsWith('http')) {
        const svg = await fetchUrl(route);
        if (svg.includes('<svg')) {
          return { slug: clean, source: `svgl.app (${match.title})`, svg };
        }
      }
    }
  } catch {}

  // 3. Coba Simple Icons CDN (3,200+ brand resmi)
  try {
    const svg = await fetchUrl(`https://cdn.simpleicons.org/${simpleSlug}`);
    if (svg.includes('<svg')) {
      return { slug: clean, source: `simpleicons (${simpleSlug})`, svg };
    }
  } catch {}

  return null;
}

function parseArgs(argv) {
  const args = {
    brands: [],
    projectDir: process.cwd(),
    outDir: 'public/brands',
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--brands' && v) args.brands = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (k === '--project-dir' && v) args.projectDir = path.resolve(v);
    if (k === '--out' && v) args.outDir = v;
  }
  return args;
}

const opts = parseArgs(process.argv);
if (opts.brands.length === 0) {
  console.log('Usage: node scripts/fetch-brand-logo.mjs --brands "claude,remotion,after-effects,react" [--project-dir .] [--out public/brands]');
  process.exit(0);
}

const outPath = path.resolve(process.cwd(), opts.outDir);
fs.mkdirSync(outPath, { recursive: true });

const results = [];
for (const b of opts.brands) {
  const res = await resolveBrandSvg(b, opts.projectDir);
  if (res) {
    const file = path.join(outPath, `${res.slug}.svg`);
    fs.writeFileSync(file, res.svg, 'utf8');
    results.push({ brand: b, slug: res.slug, source: res.source, file: path.relative(process.cwd(), file), status: 'OK' });
  } else {
    results.push({ brand: b, status: 'BUILTIN_OR_MANUAL_REQUIRED' });
  }
}

console.log(JSON.stringify({ resolved: results }, null, 2));
