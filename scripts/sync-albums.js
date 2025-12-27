import fs from "fs";
import path from "path";

const GENERATED_DIR = "images/generated";
const DB_NAME = process.env.DB_NAME || "portfolio-db";

let syncLog = {
  startTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  totalRows: 0,
  successfulInserts: 0,
  failedInserts: 0,
  errors: []
};

function generateAlbumInserts() {
  if (!fs.existsSync(GENERATED_DIR)) return [];
  
  const albums = fs.readdirSync(GENERATED_DIR).filter(dir => 
    fs.statSync(path.join(GENERATED_DIR, dir)).isDirectory()
  );

  const albumData = {
    'doors': { title: 'Doors & Windows', description: 'Unique doors and windows from around the world.' },
    'macro': { title: 'Macro', description: 'Get closer to the world around you.' },
    'minimal': { title: 'Minimal', description: 'Less is the new more' },
    'nature': { title: 'Nature', description: 'Indeed the most beautiful mother nature' },
    'patterns': { title: 'Patterns', description: 'They are everywhere, just look around' }
  };

  const statements = [];
  
  for (const album of albums) {
    const data = albumData[album] || { title: album.charAt(0).toUpperCase() + album.slice(1), description: '' };
    
    try {
      statements.push(`INSERT OR IGNORE INTO albums (slug, title, description) VALUES ('${album}', '${data.title}', '${data.description}');`);
      syncLog.totalRows++;
    } catch (err) {
      syncLog.errors.push(`Failed to create album insert for ${album}: ${err.message}`);
    }
  }

  return statements;
}

function generateWranglerCommands(statements) {
  return statements.map(sql => 
    `npx wrangler d1 execute ${DB_NAME} --command "${sql.replace(/"/g, '\\"')}"`
  );
}

function saveLog() {
  if (!fs.existsSync('logs/database-sync')) fs.mkdirSync('logs/database-sync', { recursive: true });
  
  syncLog.endTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  syncLog.status = syncLog.errors.length > 0 ? 'FAILED' : 'SUCCESS';
  
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).replace(/[/,: ]/g, '_');
  fs.writeFileSync(`logs/database-sync/sync_${timestamp}.json`, JSON.stringify(syncLog, null, 2));
}

async function run() {
  console.log("🔄 Generating database sync commands...");
  
  if (!fs.existsSync(GENERATED_DIR)) {
    syncLog.errors.push("images/generated directory not found");
    saveLog();
    console.error("❌ images/generated directory not found");
    return;
  }

  const statements = generateAlbumInserts();
  
  if (statements.length === 0) {
    syncLog.status = 'NO_CHANGES';
    saveLog();
    console.log("ℹ️ No albums to sync");
    return;
  }

  // Create db-sync directory
  if (!fs.existsSync('db-sync')) fs.mkdirSync('db-sync');
  
  const commands = generateWranglerCommands(statements);
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).replace(/[/,: ]/g, '_');
  const scriptContent = `#!/bin/bash\n# Database sync script - ${timestamp}\n\n${commands.join('\n')}\n\necho "✅ Database sync completed"`;
  
  // Save current script
  fs.writeFileSync("sync-db.sh", scriptContent);
  fs.chmodSync("sync-db.sh", 0o755);
  
  // Save SQL in db-sync folder
  fs.writeFileSync(`db-sync/sync_${timestamp}.sql`, statements.join('\n'));
  
  syncLog.successfulInserts = statements.length;
  saveLog();
  
  console.log(`✅ Generated ${statements.length} album inserts`);
  console.log(`📝 SQL saved to db-sync/sync_${timestamp}.sql`);
  console.log("Run: ./sync-db.sh");
}

run();