/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const app = require("./app");
const { runMonthlyEmailScheduler } = require("./emailScheduler");
const { runMonthlyMembershipCharges } = require("./monthlyMembershipCharges");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

exports.api = onRequest(app);

exports.monthlyEmailScheduler = onSchedule("every 1 minutes", async () => {
  try {
    await runMonthlyEmailScheduler();
  } catch (err) {
    console.error("Monthly email scheduler failed:", err?.message || err);
  }
});

exports.monthlyMembershipCharges = onSchedule("0 2 * * *", async () => {
  try {
    await runMonthlyMembershipCharges();
  } catch (err) {
    console.error("Monthly membership charge scheduler failed:", err?.message || err);
  }
});

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
