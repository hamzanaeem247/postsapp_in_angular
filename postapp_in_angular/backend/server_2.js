const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());

const arr = [
  {
    _id: "5ec391d1ce247d51f22d4832",
    name: "Apparel1",
    slug: "apparel",
    link: "apparel",
  },
  { _id: "5ec391d6ce247d51f22d4a99", name: "Art", slug: "art", link: "art" },
  {
    _id: "5ec391d8ce247d51f22d4bf3",
    name: "Electronics",
    slug: "electronics",
    link: "electronics",
  },
  {
    _id: "5ec391e0ce247d51f22d4ecd",
    name: "Food & Beverages",
    slug: "food-and-beverages",
    link: "food-and-beverages",
  },
  {
    _id: "5ec391e1ce247d51f22d4f5c",
    name: "Health & Beauty",
    slug: "health-and-beauty",
    link: "health-and-beauty",
  },
  {
    _id: "5ec391e3ce247d51f22d5015",
    name: "Health Care",
    slug: "health-care",
    link: "health-care",
  },
  {
    _id: "5ec391e5ce247d51f22d50e1",
    name: "Home & Garden",
    slug: "home-and-garden",
    link: "home-and-garden",
  },
  {
    _id: "5ec391f2ce247d51f22d5496",
    name: "Pet Supplies",
    slug: "pet-supplies",
    link: "pet-supplies",
  },
  {
    _id: "5ec391f4ce247d51f22d550b",
    name: "Sporting Goods",
    slug: "sporting-goods",
    link: "sporting-goods",
  },
  {
    _id: "5ec3920dce247d51f22d58de",
    name: "Toys & Games",
    slug: "toys-and-games",
    link: "toys-and-games",
  },
];

const res = {};
for (let i = 0; i < arr.length; i++) {
  const key = arr[i]["_id"];
  res[key] = { ...arr[i] };
  delete res[key]["_id"];
}

mongoose
  .connect("mongodb://localhost:27017/quiz")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const schema = new mongoose.Schema({ data: mongoose.Schema.Types.Mixed });
const Collection = mongoose.model("Collection", schema);

async function Data() {
  try {
    const doc = new Collection({ data: res });
    await doc.save();
    console.log("Data inserted successfully");
  } catch (err) {
    console.error("err:", err);
  }
}
Data();

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
