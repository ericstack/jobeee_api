import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please enter your name"],
    },
    email: {
      type: String,
      required: [true, "Please enter your email address"],
      unique: true,
      validate: [validator.isEmail, "Please enter valid email address"],
    },
    role: {
      type: String,
      enum: {
        values: ["admin", "user", "employer"],
        message: "Please select correct role",
      },
      default: "user",
    },
    password: {
      type: String,
      required: [true, "Please enter password for your account"],
      minlength: [8, "Your password must be at least 8 characters long"],
      select: false,
    },
    avatar: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      default: "",
    },
    headline: {
      type: String,
      maxlength: [120, "Headline cannot exceed 120 characters"],
      default: "",
    },
    skills: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // jobs this user has bookmarked
    savedJobs: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Job",
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

userSchema.pre("save", async function (next) {
  // only (re)hash when the password actually changed — otherwise saving a doc
  // (e.g. storing a reset token) would re-hash the existing hash and lock the user out
  if (!this.isModified("password")) {
    return next();
  }
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

//return jwt
userSchema.methods.getJwtToken = async function () {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const expiresIn = process.env.JWT_EXPIRES_TIME;
  const expiration = /^[0-9]+$/.test(expiresIn) ? `${expiresIn}` : expiresIn;

  return await new SignJWT({ id: this._id.toString() })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
};

//Compare user password in db password
userSchema.methods.comparePassword = async function (enterPassword) {
  return await bcrypt.compare(enterPassword, this.password);
};

// Generate Password Reset Token
userSchema.methods.getResetPasswordToken = function () {
  //Generate token
  const resetToken = crypto.randomBytes(20).toString("hex");

  // Hash and reset pASsword token
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000;

  return resetToken;
};
// show all jobs create by user using virtuals
userSchema.virtual("jobPublished", {
  ref: "Job",
  localField: "_id",
  foreignField: "user",
  justOne: false,
});
export default mongoose.model("User", userSchema);
