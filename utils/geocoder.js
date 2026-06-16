import opencage from "opencage-api-client";

const geoCoder = function (location) {
  return opencage
    .geocode({ q: location, language: process.env.GEOCODER_LANGUAGE || "en" })
    .then((data) => {
      if (data.status.code === 200 && data.results.length > 0) {
        // use the top match; [1] crashes when only one result is returned
        const place = data.results[0];
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

export default geoCoder;
