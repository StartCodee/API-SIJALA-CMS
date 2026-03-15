const db = require("../db");

function resolveThumbnailPath(req) {
  if (req.files?.thumbnail?.[0]?.filename) {
    return `/uploads/berita/${req.files.thumbnail[0].filename}`;
  }

  if (req.file?.filename) {
    return `/uploads/berita/${req.file.filename}`;
  }

  return null;
}

exports.getAllBerita = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM berita ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err.message);
  }
};

exports.createBerita = async (req, res) => {

  const {
    title,
    author,
    category,
    status,
    date,
    subjudul,
    content
  } = req.body;

  // const thumbnail = req.file
  //   ? `/uploads/berita/${req.file.filename}`
  //   : null;

  const thumbnail = resolveThumbnailPath(req);

  try {

    const result = await db.query(
      `INSERT INTO berita
      (title,author,category,status,date,subjudul,thumbnail,content)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        title,
        author,
        category,
        status,
        date,
        subjudul,
        thumbnail,
        content
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json(err.message);
  }

};

exports.updateBerita = async (req, res) => {

  const { id } = req.params;

    const allowedFields = [
    "title",
    "author",
    "category",
    "status",
    "date",
    "subjudul",
    "thumbnail",
    "content",
];

  const fields = Object.keys(req.body)
  .filter(key => allowedFields.includes(key))
  .reduce((obj, key) => {
    obj[key] = req.body[key];
    return obj;
  }, {});

  const thumbnail = resolveThumbnailPath(req);
  if (thumbnail) {
    fields.thumbnail = thumbnail;
  }

  try {

     const keys = Object.keys(fields);

     if (keys.length === 0) {
      return res.status(400).json({ message: "Tidak ada data untuk diupdate" });
    }

    const setClause = keys
      .map((key, i) => `${key}=$${i + 1}`)
      .join(", ");

    const values = Object.values(fields);

    const query = `
      UPDATE berita
      SET ${setClause}
      WHERE id=$${keys.length + 1}
      RETURNING *
    `;

    const result = await db.query(query, [...values, id]);
    if (result.rows.length === 0) {
          return res.status(404).json({ message: "Publikasi tidak ditemukan" });
        }
        
    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json(err.message);
  }

};

exports.deleteBerita = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM berita WHERE id=$1", [id]);
    res.json({ message: "deleted" });
  } catch (err) {
    res.status(500).json(err.message);
  }
};
