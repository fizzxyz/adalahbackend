const db = require('../src/lib/db');

async function check() {
  try {
    console.log("Mencari 'Weak Hero' di media_items...");
    const res = await db.query("SELECT * FROM media_items WHERE title ILIKE '%Weak Hero%'");
    console.log("Hasil pencarian media_items:", res.rows);

    if (res.rows.length > 0) {
      for (const row of res.rows) {
        console.log(`\nMencari video_files untuk media_item_id: ${row.id}`);
        const filesRes = await db.query("SELECT * FROM video_files WHERE media_item_id = $1", [row.id]);
        console.log("Hasil video_files:", filesRes.rows);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit();
  }
}

check();
