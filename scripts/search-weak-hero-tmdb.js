const { fetchTmdb } = require('../src/lib/tmdb');

async function run() {
  try {
    console.log("Mencari TV Shows dengan nama 'Weak Hero'...");
    const tvSearch = await fetchTmdb('/search/tv', { query: 'Weak Hero' });
    console.log("Hasil TV Search:", tvSearch.results.map(r => ({ id: r.id, name: r.name, original_name: r.original_name, first_air_date: r.first_air_date })));

    console.log("\nMencari Movies dengan nama 'Weak Hero'...");
    const movieSearch = await fetchTmdb('/search/movie', { query: 'Weak Hero' });
    console.log("Hasil Movie Search:", movieSearch.results.map(r => ({ id: r.id, title: r.title, release_date: r.release_date })));

  } catch (err) {
    console.log("Error:", err.message);
  }
  process.exit();
}

run();
