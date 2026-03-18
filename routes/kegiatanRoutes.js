const express = require("express");
const router = express.Router();
const kegiatan = require("../controllers/kegiatanController");
const { kegiatanUpload } = require("../middleware/upload");

router.get("/", kegiatan.getAllKegiatan);
router.post(
  "/",
  kegiatanUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  kegiatan.createKegiatan
);
router.patch(
  "/:id",
  kegiatanUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  kegiatan.updateKegiatan
);
router.delete("/:id", kegiatan.deleteKegiatan);
router.get("/:date", kegiatan.getAllKegiatanByDate);


module.exports = router;
