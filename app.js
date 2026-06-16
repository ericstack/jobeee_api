import express from "express";
const app = express();

// behind a reverse proxy (Render/Heroku/etc.) — trust the first hop so
// express-rate-limit can read the real client IP from X-Forwarded-For
app.set("trust proxy", 1);

import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";
import { Buffer } from "buffer";

//config env
dotenv.config({ path: ".env" });

import connectDatabase from "./config/database.js";
import errorMiddleware from "./middleware/errors.js";
import ErrorHandler from "./utils/errorHandler.js";
import sendToken from "./utils/jwtToken.js";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import xssClean from "xss-clean";
import hpp from "hpp";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
global.SlowBuffer = Buffer;
//handling uncaught exception
process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${err.stack || err.message || err}`);
  console.log("Shutting down the server due to uncaught exception");
  process.exit(1);
});

//connecting to database
connectDatabase();

//bodyparser
app.use(bodyParser.urlencoded({ extended: true }));

//security header — allow uploaded assets (avatars/resumes) to be embedded by the
//frontend on a different origin (single static mount lives below, after helmet)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

//bodyparse
app.use(express.json());

//set Cookie parser
app.use(cookieParser());

//Sanitize Data
app.use(mongoSanitize());

//handle file upload
app.use(fileUpload());

//Prevent XSS
app.use(xssClean());

//Prevent Parameter pollutio
app.use(hpp());

//rate limiter
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
});

app.use(limiter);

//cors — restrict to configured frontend origins (comma-separated env)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

//routes
import jobs from "./routes/jobs.js";
import auth from "./routes/auth.js";
import user from "./routes/user.js";

app.use("/", express.static(__dirname + "/public"));
app.use("/api/jobs/v1", jobs);
app.use("/api/auth/v1", auth);
app.use("/api/user/v1", user);
//unhandled routes
app.all("*", (req, res, next) => {
  next(new ErrorHandler(`${req.originalUrl} route not found`, 404));
});

//middleware
app.use(errorMiddleware);

const PORT = process.env.PORT;

const server = app.listen(PORT, () => {
  console.log(
    `Server started on port ${process.env.PORT} in ${process.env.NODE_ENV} mode.`,
  );
});
process.on("unhandledRejection", (err) => {
  console.log(`Error:${err}`);
  console.log("Shutting down the server due to unhandled promise");
  server.close(() => {
    process.exit(1);
  });
});
