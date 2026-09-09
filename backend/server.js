const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const defineRoute = require("./routes/define");

app.use("/define", defineRoute);

app.get("/", (req, res) => {
    res.send("ContentCore Backend is running!");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});