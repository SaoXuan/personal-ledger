require("dotenv").config();

const path = require("node:path");
const express = require("express");
const dayjs = require("dayjs");
const { initSchema, dbPath } = require("./db");
const routes = require("./routes/web");

initSchema();

const app = express();
const port = Number(process.env.PORT || 3000);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.locals.formatDate = (value) => {
  if (!value) return "-";
  return dayjs(value).format("YYYY-MM-DD");
};

app.locals.now = () => dayjs().format("YYYY-MM-DD HH:mm:ss");

app.use(routes);

app.use((req, res) => {
  res.status(404).render("404", {
    title: "Page Not Found",
    active: "",
    messages: {},
  });
});

app.use((error, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).render("500", {
    title: "Server Error",
    active: "",
    messages: { err: error.message || "Unknown Error" },
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Personal Ledger running at http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`📦 SQLite DB: ${dbPath}`);
});
