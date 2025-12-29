const Stripe = require("stripe");

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error("Missing STRIPE_SECRET_KEY");
    // @ts-ignore
    err.status = 500;
    throw err;
  }

  return new Stripe(key, {
    // Let Stripe SDK pick a compatible default; do not pin unless needed.
    // apiVersion: "2024-06-20",
    typescript: false,
  });
}
module.exports = {
  getStripe,
};
