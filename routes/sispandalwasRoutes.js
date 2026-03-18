const express = require("express");
const controller = require("../controllers/sispandalwasController");

const router = express.Router();

router.get("/trackers", controller.listTrackers);
router.get("/tracker-configs", controller.listTrackerConfigs);
router.post("/tracker-configs", controller.createTrackerConfig);
router.patch("/tracker-configs/:id", controller.updateTrackerConfig);
router.delete("/tracker-configs/:id", controller.deleteTrackerConfig);
router.post("/poll-feed", controller.pollFeed);
router.get("/coverage-area", controller.getCoverageArea);
router.put("/coverage-area", controller.upsertCoverageArea);
router.get("/track", controller.getTrack);
router.get("/coverage", controller.getCoverageResult);
router.post("/simulate", controller.simulateCoverage);

module.exports = router;
