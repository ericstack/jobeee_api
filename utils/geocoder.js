const opencage = require("opencage-api-client");

const geoCoder = function (location) {
  return opencage
    .geocode({ q: location, language: "fr" })
    .then((data) => {
      if (data.status.code === 200 && data.results.length > 0) {
        const place = data.results[1];
        return place;
      } else {
        console.log("status", data.status.message);
        console.log("total_results", data.total_results);
      }
    })
    .catch((error) => {
      console.log("error", error.message);
      if (error.status.code === 402) {
        console.log("hit free trial daily limit");
        console.log("become a customer: https://opencagedata.com/pricing");
      }
    });
};

module.exports = geoCoder;
