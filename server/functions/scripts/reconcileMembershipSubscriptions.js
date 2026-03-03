require("dotenv").config();
const { runMembershipSubscriptionReconciliation } = require("../membershipSubscriptionReconcile");

runMembershipSubscriptionReconciliation()
  .then((summary) => {
    console.log("Reconcile complete:", summary);
  })
  .catch((err) => {
    console.error("Reconcile failed:", err?.message || err);
    process.exitCode = 1;
  });
