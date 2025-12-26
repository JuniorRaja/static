import fs from "fs";
import path from "path";
import sharp from "sharp";

const ORIGINALS_DIR = "images/originals";
const GENERATED_DIR = "images/generated";

const SIZES = {
  thumb: { width: 320, quality: 70 },
  medium: { width: 1200, quality: 80 },
  full: { width: 2400, quality: 85 }
};

function pad(num) {
  return String(num).padStart(3, "0");
}

function loadManifest(album) {
  const manifestPath = path.join(GENERATED_DIR, album, "_manifest.json");
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

function saveManifest(album, manifest) {
  const albumDir = path.join(GENERATED_DIR, album);
  fs.mkdirSync(albumDir, { recursive: true });

  fs.writeFileSync(
    path.join(albumDir, "_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
}

async function extractMetadata(inputPath, album, seq, originalFile) {
  try {
    const meta = await sharp(inputPath).metadata();

    return {
      original_file: originalFile,
      album,
      sequence: pad(seq),
      width: meta.width || null,
      height: meta.height || null,
      format: meta.format || null,
      orientation: meta.orientation || null,

      taken_at: meta.exif?.DateTimeOriginal
        ? new Date(meta.exif.DateTimeOriginal).toISOString()
        : null,

      camera: {
        make: meta.exif?.Make || null,
        model: meta.exif?.Model || null
      },

      lens: meta.exif?.LensModel || null,
      iso: meta.exif?.ISOSpeedRatings || null,
      aperture: meta.exif?.FNumber || null,
      focal_length: meta.exif?.FocalLength || null,
      exposure_time: meta.exif?.ExposureTime || null,

      gps: meta.exif?.GPSLatitude && meta.exif?.GPSLongitude
        ? {
            lat: meta.exif.GPSLatitude,
            lon: meta.exif.GPSLongitude
          }
        : null
    };
  } catch (err) {
    console.warn(`⚠ Could not read EXIF for ${originalFile}`);
    return null;
  }
}

async function processImage(album, file, seq) {
  const inputPath = path.join(ORIGINALS_DIR, album, file);
  const outputDir = path.join(GENERATED_DIR, album, pad(seq));

  fs.mkdirSync(outputDir, { recursive: true });

  for (const [variant, opts] of Object.entries(SIZES)) {
    const outPath = path.join(outputDir, `${variant}.webp`);
    if (fs.existsSync(outPath)) continue;

    await sharp(inputPath)
      .resize({ width: opts.width, withoutEnlargement: true })
      .webp({ quality: opts.quality })
      .toFile(outPath);
  }

  const metaPath = path.join(outputDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    const metadata = await extractMetadata(inputPath, album, seq, file);
    if (metadata) {
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    }
  }

  console.log(`✔ ${album}/${pad(seq)} ← ${file}`);
}

async function run() {
  console.log("🚀 Image processing started");

  if (!fs.existsSync(ORIGINALS_DIR)) {
    console.error("❌ images/originals does not exist");
    return;
  }

  const albums = fs.readdirSync(ORIGINALS_DIR);

  for (const album of albums) {
    const albumPath = path.join(ORIGINALS_DIR, album);
    if (!fs.statSync(albumPath).isDirectory()) continue;

    console.log(`📁 Album: ${album}`);

    const files = fs
      .readdirSync(albumPath)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort(); // stable order

    const manifest = loadManifest(album);
    const usedSeqs = Object.values(manifest).map(Number);
    let nextSeq = usedSeqs.length ? Math.max(...usedSeqs) + 1 : 1;

    for (const file of files) {
      if (manifest[file]) {
        console.log(`↪ Skipping ${file} (already processed)`);
        continue;
      }

      const seq = nextSeq++;
      manifest[file] = pad(seq);

      await processImage(album, file, seq);
    }

    saveManifest(album, manifest);
  }

  console.log("✅ Image processing completed");
}

run();
