// Import the official MongoDB driver so we can talk to the database.
const { MongoClient } = require("mongodb")

// Connection string for a local MongoDB server.
// Uses the default port 27017 on localhost.
const URL = "mongodb://127.0.0.1:27017"

// Name of the database used for this project.
// Collections inside this database are created automatically when used.
const DBNAME = "mysticpaws"

// This variable will hold the active database connection once connected.
// It is shared across all modules that import getDb().
let db

// Establish a connection to MongoDB when the server starts.
// This runs only once in server.js.
async function connect() {
  // Create a new client instance for MongoDB.
  const client = new MongoClient(URL)

  // Open the connection. If this fails, the server cannot run properly.
  await client.connect()

  // Select the database. If it does not exist, MongoDB creates it on demand.
  db = client.db(DBNAME)

  // Log to confirm a successful connection.
  console.log("MongoDB connected")
}

// Returns the active database connection.
// Other modules use this function instead of creating new connections.
// This ensures efficient use of resources.
function getDb() {
  return db
}

// Export both functions so server.js can call them.
module.exports = { connect, getDb }
