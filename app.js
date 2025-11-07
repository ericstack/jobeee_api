const express = require("express");
const app = express();

const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
//config env
dotenv.config({ path: "./config/config.env" });

const connectDatabase = require("./config/database");
const errorMiddleware = require("./middleware/errors");
const ErrorHandler = require("./utils/errorHandler");
const sendToken = require("./utils/jwtToken");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xssClean = require("xss-clean");
const hpp = require("hpp");
const cors = require("cors");
const bodyParser = require("body-parser");
var path = require("path");

//handling uncaught exception
process.on("uncaughtException", (err) => {
  console.log("Shutting down the server due to  uncaught exception");
  process.exit(1);
});

//connecting to database
connectDatabase();

//bodyparser
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static("public"));

//security header
app.use(helmet());

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

//cors
app.use(cors());

//routes
const jobs = require("./routes/jobs");
const auth = require("./routes/auth");
const user = require("./routes/user");

app.use("/", express.static(__dirname + "/public"));
app.use("/api/v1", jobs);
app.use("/api/v1", auth);
app.use("/api/v1", user);
//unhandled routes
app.all("*", (req, res, next) => {
  console.log(__dirname);
  next(new ErrorHandler(`${req.originalUrl} route not found`, 404));
});

//middleware
app.use(errorMiddleware);

const PORT = process.env.PORT;
const server = app.listen(PORT, () => {
  console.log(
    `Server started on port ${process.env.PORT} in ${process.env.NODE_ENV} mode.`
  );
});
process.on("unhandledRejection", (err) => {
  console.log(`Error:${err.message}`);
  console.log("Shutting down the server due to unhandled promise");
  server.close(() => {
    process.exit(1);
  });
});
