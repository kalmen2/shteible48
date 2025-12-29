const { MongoClient } = require("mongodb");

let client;
let db;
let logged = false;

function maskMongoUri(uri) {
  if (!uri) return "(missing)";
  try {
    const u = new URL(uri);
    u.username = "";
    u.password = "";
    u.search = "";
    return u.toString();
  } catch {
    return "(invalid uri)";
  }
}

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;

  if (!uri) {
    const err = new Error("MONGODB_URI is required");
    // @ts-ignore
    err.status = 500;
    throw err;
  }

  if (db) return db;

  client = new MongoClient(uri);
  await client.connect();
  db = dbName ? client.db(dbName) : client.db();

  if (!logged) {
    logged = true;
    // eslint-disable-next-line no-console
    console.log(`MongoDB connected: ${maskMongoUri(uri)} (db: ${db.databaseName})`);
    if (process.env.FUNCTION_NAME) {
      // Firebase Functions log
      console.log('[FIREBASE] Database connection established');
    }
  }


  return db;
}


async function closeMongo() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

module.exports = {
  connectMongo,
  closeMongo,
};
