// usage: node sign.js "symbol=BTCUSDT&investment=100&..." "apiSecret"
const crypto = require("crypto");
const query = process.argv[2];
const secret = process.argv[3];
console.log(
  crypto.createHmac("sha256", secret).update(query).digest("hex")
);