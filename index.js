const experss = require("express");
const app = experss();
const port = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/users", (req, res) => {
  res.send("Hello Users!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 