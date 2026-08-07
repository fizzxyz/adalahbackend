const tmdb = require('../src/lib/tmdb');

async function run() {
  try {
    const res = await tmdb.getTvDetail(1081003);
    console.log("TV Result ID:", res ? res.id : 'null');
    console.log("TV Result Name:", res ? res.name : 'null');
  } catch (err) {
    console.log("TV Error:", err.message);
  }

  try {
    const res = await tmdb.getMovieDetail(1081003);
    console.log("Movie Result ID:", res ? res.id : 'null');
    console.log("Movie Result Name:", res ? res.title : 'null');
  } catch (err) {
    console.log("Movie Error:", err.message);
  }
  process.exit();
}

run();
