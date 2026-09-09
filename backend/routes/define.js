const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
    res.json({
        message: "Define route is working",
        status: "success"
    });
});

module.exports = router;