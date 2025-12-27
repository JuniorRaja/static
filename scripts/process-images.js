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

let processLog = {
  startTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  totalFiles: 0,
  processedFiles: 0,
  skippedFiles: 0,
  errors: [],
  compressionStats: []
};

function pad(num) {
  return String(num).padStart(3, "0");
}

function saveLog() {
  if (!fs.existsSync('logs/image-processing')) fs.mkdirSync('logs/image-processing', { recursive: true });
  
  processLog.endTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  processLog.status = processLog.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS';
  
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).replace(/[/,: ]/g, '_');
  fs.writeFileSync(`logs/image-processing/process_${timestamp}.json`, JSON.stringify(processLog, null, 2));
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
    processLog.errors.push(`EXIF extraction failed for ${originalFile}: ${err.message}`);
    return null;
  }
}

async function processImage(album, file, seq) {
  try {
    const inputPath = path.join(ORIGINALS_DIR, album, file);
    const outputDir = path.join(GENERATED_DIR, album, pad(seq));
    const originalSize = fs.statSync(inputPath).size;
    let totalCompressedSize = 0;

    fs.mkdirSync(outputDir, { recursive: true });

    for (const [variant, opts] of Object.entries(SIZES)) {
      const outPath = path.join(outputDir, `${variant}.webp`);
      if (fs.existsSync(outPath)) continue;

      await sharp(inputPath)
        .resize({ width: opts.width, withoutEnlargement: true })
        .webp({ quality: opts.quality })
        .toFile(outPath);
      
      totalCompressedSize += fs.statSync(outPath).size;
    }

    const metaPath = path.join(outputDir, "meta.json");
    if (!fs.existsSync(metaPath)) {
      const metadata = await extractMetadata(inputPath, album, seq, file);
      if (metadata) {
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
      }
    }

    processLog.compressionStats.push({
      file: `${album}/${file}`,
      originalSize,
      compressedSize: totalCompressedSize,
      ratio: ((1 - totalCompressedSize / originalSize) * 100).toFixed(1) + '%'
    });
    
    processLog.processedFiles++;
    console.log(`✔ ${album}/${pad(seq)} ← ${file}`);
  } catch (err) {
    processLog.errors.push(`Processing failed for ${album}/${file}: ${err.message}`);
  }
}

async function run() {
  console.log("🚀 Image processing started");

  if (!fs.existsSync(ORIGINALS_DIR)) {
    processLog.errors.push("images/originals directory does not exist");
    saveLog();
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
      .sort();
    
    processLog.totalFiles += files.length;

    const manifest = loadManifest(album);
    const usedSeqs = Object.values(manifest).map(Number);
    let nextSeq = usedSeqs.length ? Math.max(...usedSeqs) + 1 : 1;

    for (const file of files) {
      if (manifest[file]) {
        console.log(`↪ Skipping ${file} (already processed)`);
        processLog.skippedFiles++;
        continue;
      }

      const seq = nextSeq++;
      manifest[file] = pad(seq);

      await processImage(album, file, seq);
    }

    saveManifest(album, manifest);
  }

  saveLog();
  console.log(`✅ Processed: ${processLog.processedFiles}, Skipped: ${processLog.skippedFiles}, Errors: ${processLog.errors.length}`);
}

run();
