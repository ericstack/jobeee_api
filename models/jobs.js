const mongoose = require("mongoose");
const validator = require("validator");
const slugify = require("slugify");
const geoCoder = require("../utils/geocoder");

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Please enter Job title"],
    trim: true,
    maxlength: [100, "Job title can not exceed 100 characters."],
  },
  slug: String,
  description: {
    type: String,
    required: [true, "Please enter Job description."],
    maxlength: [1000, "Job description can not exceed 1000 characters."],
  },
  email: {
    type: String,
    validate: [validator.isEmail, "Please add a valid email address."],
  },
  address: {
    type: String,
    required: [true, "Please add an address."],
  },
  location: {
    type: {
      type: String,
      enum: ["Point"],
    },
    coordinates: {
      type: [Number],
      index: "2dsphere",
    },
    formattedAddress: String,
    city: String,
    state: String,
    zipcode: String,
    country: String,
  },
  company: {
    type: String,
    required: [true, "Please add an Company name."],
  },
  industry: {
    type: [String],
    required: [true, "Please enter industry for this job"],
    enum: {
      values: [
        "Business",
        "Information Technology",
        "Banking",
        "Education/Training",
        "Telecommunication",
        "Others",
      ],
      message: "Please select correct options for industry",
    },
  },
  jobType: {
    type: String,
    required: [true, "Please enter Job Type for this job"],
    enum: {
      values: ["Permanent", "Temporary", "Internship"],
      message: "Please select correct options for job type.",
    },
  },
  minEducation: {
    type: String,
    required: [true, "Please enter min Education for this job"],
    enum: {
      values: ["Bachelors", "Masters", "PhD"],
      message: "Please select correct options for Education.",
    },
  },
  positions: {
    type: Number,
    default: 1,
  },
  experience: {
    type: String,
    required: [true, "Please enter experience for this job"],
    enum: {
      values: [
        "No Experience",
        "1-2 years experience",
        "2-5 years experience",
        "5 years experience ",
      ],
      message: "Please select correct options for Experience.",
    },
  },
  salary: {
    type: Number,
    required: [true, "Please enter expected salary for this job."],
  },
  postingDate: {
    type: Date,
    default: Date.now,
  },
  lastDate: {
    type: Date,
    default: new Date().setDate(new Date().getDate() + 7),
  },
  applicantsApplied: {
    type: [Object],
    select: false,
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
  },
});

//creating job slug before save
jobSchema.pre("save", function (next) {
  this.slug = slugify(this.title, { lower: true });

  next();
});

//Setting up location
jobSchema.pre("save", async function (next) {
  const loc = await geoCoder(this.address);
  this.location = {
    type: "Point",
    coordinates: [loc.geometry["lat"], loc.geometry["lng"]],
    formattedAddress: loc.formatted,
    city: loc.components["city"],
    state: loc.components["state"],
    zipcode: loc.components["postcode"],
    country: loc.components["country_code"],
  };

  next();
});

module.exports = mongoose.model("Job", jobSchema);
