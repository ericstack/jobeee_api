import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
const connectDatabase = () => {
  mongoose
    .connect(
      process.env.NODE_ENV === "production"
        ? process.env.MONGODB_URI_PRO
        : process.env.MONGODB_URI,
    )
    .then(() => {
      console.log("Connected to MongoDB");
    })
    .catch((err) => {
      console.error("Failed to connect to MongoDB", err);
    });
};

export default connectDatabase;
