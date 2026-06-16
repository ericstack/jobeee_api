export default class APIFilters {
  constructor(query, queryStr) {
    this.query = query;
    this.queryStr = queryStr;
  }

  filter() {
    const queryCopy = { ...this.queryStr };

    //Removing fields from query (incl. the custom search filters handled in searchFilters())
    const removeFields = [
      "sort",
      "fields",
      "q",
      "limit",
      "page",
      "keyword",
      "location",
      "company",
      "jobType",
      "industry",
      "salaryMin",
      "salaryMax",
    ];
    removeFields.forEach((el) => delete queryCopy[el]);

    //advane query filter using: lt,lte,gt,gte

    let queryStr = JSON.stringify(queryCopy);
    queryStr = queryStr.replace(
      /\b(gt|gte|lt|lte|in)\b/g,
      (match) => `$${match}`,
    );

    this.query = this.query.find(JSON.parse(queryStr));
    return this;
  }

  sort() {
    // always append _id as a tiebreaker so pagination is stable when the
    // primary sort key has duplicate values (otherwise pages can overlap)
    if (this.queryStr.sort) {
      const sortBy = this.queryStr.sort.split(",").join(" ");
      this.query = this.query.sort(`${sortBy} _id`);
    } else {
      this.query = this.query.sort("-postingDate _id");
    }

    return this;
  }

  limitFields() {
    if (this.queryStr.fields) {
      const fields = this.queryStr.fields.split(",").join(" ");
      this.query = this.query.select(fields);
    } else {
      // exclude the internal version key without overriding the sort set by sort()
      this.query = this.query.select("-__v");
    }

    return this;
  }

  searchByQuery() {
    if (this.queryStr.q) {
      const qu = this.queryStr.q.split("-");
      this.query = this.query.find({ $text: { $search: '"' + qu + '"' } });
    }
    return this;
  }

  // Job-search filters: keyword (title/company/description), location & company
  // (case-insensitive partial match), jobType (exact), and a salary range.
  searchFilters() {
    const and = [];

    if (this.queryStr.keyword) {
      const kw = { $regex: this.queryStr.keyword, $options: "i" };
      and.push({ $or: [{ title: kw }, { company: kw }, { description: kw }] });
    }
    if (this.queryStr.location) {
      and.push({ address: { $regex: this.queryStr.location, $options: "i" } });
    }
    if (this.queryStr.company) {
      and.push({ company: { $regex: this.queryStr.company, $options: "i" } });
    }
    if (this.queryStr.jobType) {
      and.push({ jobType: this.queryStr.jobType });
    }
    if (this.queryStr.industry) {
      // industry is an array field; a scalar match keeps jobs that include it
      and.push({ industry: this.queryStr.industry });
    }

    const salary = {};
    if (this.queryStr.salaryMin) salary.$gte = Number(this.queryStr.salaryMin);
    if (this.queryStr.salaryMax) salary.$lte = Number(this.queryStr.salaryMax);
    if (Object.keys(salary).length) and.push({ salary });

    if (and.length) {
      this.query = this.query.find({ $and: and });
    }
    return this;
  }
  pagination() {
    const page = parseInt(this.queryStr.page, 10) || 1;
    const limit = parseInt(this.queryStr.limit, 10) || 10;
    const skipResults = (page - 1) * limit;

    this.query = this.query.skip(skipResults).limit(limit);

    return this;
  }
}
