const db = require("../db");

function resolveImagePath(req) {
  if (req.files?.image?.[0]?.filename) {
    return `/uploads/kegiatan/${req.files.image[0].filename}`;
  }

  if (req.files?.thumbnail?.[0]?.filename) {
    return `/uploads/kegiatan/${req.files.thumbnail[0].filename}`;
  }

  if (req.file?.filename) {
    return `/uploads/kegiatan/${req.file.filename}`;
  }

  return null;
}

exports.getAllKegiatan = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM kalender_kegiatan ORDER BY date ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err.message);
  }
};

exports.createKegiatan = async (req, res) => {
  const { title, location, date, time, category, summary, description } = req.body;

    const image = resolveImagePath(req);

  try {
    const result = await db.query(
      `INSERT INTO kalender_kegiatan(title,location,date,time,category,image, summary, description)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [title, location, date, time, category, image, summary, description]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json(err.message);
  }
};


exports.updateKegiatan = async (req, res) => {

  const { id } = req.params;

  const allowedFields = [
  "title",
  "location",
  "date",
  "time",
  "category",
  "image",
  "summary",
  "description"
];

const fields = Object.keys(req.body)
  .filter(key => allowedFields.includes(key))
  .reduce((obj, key) => {
    obj[key] = req.body[key];
    return obj;
  }, {});

  const image = resolveImagePath(req);
  if (image) {
    fields.image = image;
  }

  try {

    const keys = Object.keys(fields);

    if (keys.length === 0) {
      return res.status(400).json({ message: "Tidak ada data untuk diupdate" });
    }

    const setClause = keys
      .map((key, index) => `${key}=$${index + 1}`)
      .join(", ");

    const values = Object.values(fields);

    const query = `
      UPDATE kalender_kegiatan
      SET ${setClause}
      WHERE id=$${keys.length + 1}
      RETURNING *
    `;

    const result = await db.query(query, [...values, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Kegiatan tidak ditemukan" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json(err.message);
  }

};

exports.deleteKegiatan = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM kalender_kegiatan WHERE id=$1", [id]);
    res.json({ message: "deleted" });
  } catch (err) {
    res.status(500).json(err.message);
  }
};


exports.getAllKegiatanByDate = async (req, res) => {
  const { date } = req.params;

  try {
    const result = await db.query("SELECT * FROM kalender_kegiatan WHERE date = $1 ORDER BY time ASC", [date]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err.message);
  }
};