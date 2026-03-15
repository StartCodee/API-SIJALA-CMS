const fs = require("fs");
const path = require("path");
const { pool } = require("../db");

async function run() {
  const migrationPath = path.join(__dirname, "..", "migration", "mig.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  try {
    await pool.query(sql);
    console.log("Migrasi CMS selesai dijalankan.");
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
