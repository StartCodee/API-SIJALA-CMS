const express = require("express");
const router = express.Router();
const publikasi = require("../controllers/publikasiController");
const { publikasiUpload } = require("../middleware/upload");

router.get("/", publikasi.getAllPublikasi);
router.post("/", publikasiUpload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "pdf", maxCount: 1 }
  ]), publikasi.createPublikasi);
router.patch("/:id", publikasiUpload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "pdf", maxCount: 1 }
  ]), publikasi.updatePublikasi);
router.delete("/:id", publikasi.deletePublikasi);

module.exports = router;