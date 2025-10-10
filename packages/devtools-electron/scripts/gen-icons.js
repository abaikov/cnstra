const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true }).catch(() => {});
}

async function main() {
  const rootSvg = path.resolve(__dirname, '..', '..', '..', 'docs', 'static', 'img', 'logo.svg');
  const outDir = path.resolve(__dirname, '..', 'build', 'icons');
  await ensureDir(outDir);

  const sizesPng = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  for (const s of sizesPng) {
    const out = path.join(outDir, `icon_${s}x${s}.png`);
    await sharp(rootSvg).resize(s, s).png().toFile(out);
  }

  // Generate .icns and .ico if needed using largest PNG; electron-builder can also derive from PNG set
  // Keep placeholder; many pipelines let electron-builder create icns/ico from pngs.
  console.log('Icons generated at', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


