const db = require('../src/lib/db');

async function fix() {
  try {
    console.log("Mengupdate tmdb_id untuk Weak Hero 2022 dari 1081003 ke 200709...");
    const res = await db.query(
      "UPDATE media_items SET tmdb_id = 200709 WHERE slug = 'weak-hero-2022' RETURNING *"
    );
    console.log("Berhasil diupdate:", res.rows);
  } catch (err) {
    console.error("Gagal mengupdate:", err.message);
  } finally {
    process.exit();
  }
}

fix();
