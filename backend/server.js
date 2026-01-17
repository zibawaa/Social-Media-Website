// Import core libraries used to build the backend HTTP API.
const express = require("express")           // Main web framework used to define routes and middleware.
const session = require("express-session")   // Handles session cookies so we know which user is logged in.
const { ObjectId } = require("mongodb")      // Used to convert string IDs back into MongoDB ObjectId values.
const db = require("./db")                   // Local helper that manages the connection to MongoDB.
const path = require("path")                 // Node core module for building safe file system paths.
const https = require("https")               // Node core module used for calling third-party HTTPS APIs.
const fileUpload = require("express-fileupload") // Middleware that parses multipart form data for file uploads.
const fs = require("fs")                     // Node file system module for checking / creating folders.

// Create the Express application instance.
const app = express()                        // This app object is used to register all routes and middleware.

// Port for the Node server to listen on.
const PORT = 8080                            // Fixed port so marker and Postman know where to send requests.

// Student ID used to namespace all routes.
const STUDENT_ID = "M00932446"               // All API paths include this so they do not clash with other students.

// ---------------------------------------------------------------------
// GLOBAL MIDDLEWARE
// ---------------------------------------------------------------------

// Parse JSON request bodies into req.body.
app.use(express.json({ limit: "10mb" }))     // Allows frontend to send JSON payloads, with enough size for images.

// Enable file upload handling.
app.use(fileUpload())                        // Adds req.files so we can accept uploaded images via multipart forms.

// Configure session support.
app.use(
  session({
    secret: "change_this_secret",            // Secret used to sign the session cookie so it cannot be forged.
    resave: false,                           // Avoids resaving unchanged sessions to reduce overhead.
    saveUninitialized: false                 // Only creates a session once we store data in it, keeps noise low.
  })
)

// Ensure uploads folder exists for file uploads.
const uploadsDir = path.join(__dirname, "uploads") // Absolute path to the uploads directory for storing images.
if (!fs.existsSync(uploadsDir)) {                   // Check if the folder already exists.
  fs.mkdirSync(uploadsDir)                          // Create it once at startup if missing to avoid runtime errors.
}

// Connect to MongoDB as soon as the server starts.
db.connect()                                 // Sets up the shared MongoDB connection used in all route handlers.

// Serve static frontend files from the "frontend" folder.
app.use(
  "/" + STUDENT_ID,                          // All static files are served under /M00932446 so paths are unique.
  express.static(path.join(__dirname, "..", "frontend")) // Exposes index.html, CSS, JS, and images to the browser.
)

// Serve uploaded files as static resources.
app.use(
  "/" + STUDENT_ID + "/uploads",             // Public path where uploaded images are available to the frontend.
  express.static(uploadsDir)                 // Serves files from the uploads directory on disk.
)

// Make http://localhost:8080 load the frontend as well.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html")) // Entry point for the SPA without ID prefix.
})

// ---------------------------------------------------------------------
// TEST ROUTE
// ---------------------------------------------------------------------

// Simple test endpoint so we can confirm the server is running.
app.get("/" + STUDENT_ID + "/test", (req, res) => {
  res.json({ message: "Server working" })    // Returns a small JSON message to show the route is reachable.
})

// ---------------------------------------------------------------------
// SMALL HTTPS JSON HELPER (for third-party APIs)
// ---------------------------------------------------------------------

// Helper that fetches and parses JSON from a remote HTTPS URL.
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {                     // Start a GET request to the third-party API.
        let data = ""                        // Buffer for streaming chunks.

        res.on("data", chunk => {           // Collect each chunk of data from the response.
          data += chunk
        })

        res.on("end", () => {               // Once all chunks arrive, try to parse as JSON.
          try {
            const json = JSON.parse(data)
            resolve(json)                   // Return parsed JSON to caller.
          } catch (err) {
            reject(err)                     // Parsing failed, reject the promise so caller can handle it.
          }
        })
      })
      .on("error", err => {
        reject(err)                         // Network or TLS error, bubble it up to caller.
      })
  })
}

// ---------------------------------------------------------------------
// USER CREATION AND PROFILE UPDATES
// ---------------------------------------------------------------------

// POST /M00932446/users
// This route both registers new accounts and updates the current user's bio.
app.post("/" + STUDENT_ID + "/users", async (req, res) => {
  try {
    const database = db.getDb()             // Shared MongoDB connection from db.js.
    const users = database.collection("users") // Collection where all user documents are stored.

    const { username, password, bio } = req.body // Read potential fields sent from the frontend.

    // Registration branch: username and password present, but no active session.
    if (username && password && (!req.session || !req.session.userId)) {
      const exists = await users.findOne({ username }) // Check if the username is already taken.
      if (exists) {
        return res.json({ success: false, message: "Username taken" }) // Prevent duplicate accounts.
      }

      await users.insertOne({ username, password }) // Store credentials in the database (plain for coursework).
      return res.json({ success: true })            // Inform frontend that registration has succeeded.
    }

    // Profile update branch: logged in user wants to change their bio.
    if (typeof bio === "string" && req.session && req.session.userId) {
      await users.updateOne(
        { username: req.session.username }, // Use username in session to find the right document.
        { $set: { bio } }                   // Overwrite bio field with the new text from the request.
      )
      return res.json({ success: true })    // Frontend can show a toast confirming the bio was saved.
    }

    // If neither branch matches, the request is incomplete or invalid.
    return res.json({ success: false, message: "Missing fields" })
  } catch (err) {
    console.log(err)                        // Log full error on server for debugging.
    res.json({ success: false, message: "Server error" }) // Send generic error to client to avoid leaking details.
  }
})

// ---------------------------------------------------------------------
// USER SEARCH AND PROFILE STATS
// ---------------------------------------------------------------------

// GET /M00932446/users
// Returns either stats for the current user or a filtered list of other users.
app.get("/" + STUDENT_ID + "/users", async (req, res) => {
  try {
    const database = db.getDb()
    const users = database.collection("users")   // Base collection storing user bios and credentials.
    const follows = database.collection("follows") // Collection storing follow relationships.

    const q = req.query.q || ""                 // Optional query string used for search or special modes.

    // Stats for current user when q="__me_stats".
    if (q === "__me_stats" && req.session && req.session.username) {
      const username = req.session.username     // Use session to know whose stats we are returning.

      // In parallel, load user profile and both follower/following counts.
      const [userDoc, followers, following] = await Promise.all([
        users.findOne(
          { username },
          { projection: { username: 1, bio: 1, _id: 0 } } // Only return fields we need in the UI.
        ),
        follows.countDocuments({ targetUsername: username }),      // How many follow this user.
        follows.countDocuments({ followerUsername: username })     // How many this user follows.
      ])

      return res.json({
        success: true,
        mode: "stats",
        username,
        bio: (userDoc && userDoc.bio) || "",    // If bio is missing, send empty string for safety.
        followers,
        following
      })
    }

    // Normal search branch: filter by username using case-insensitive regex.
    const basicUsers = await users
      .find({ username: { $regex: q, $options: "i" } }) // Search by substring if q is not empty.
      .project({ username: 1, bio: 1 })                 // Bio + username is enough for the right column.
      .toArray()

    // For each found user, compute follower and following counts.
    const results = await Promise.all(
      basicUsers.map(async u => {
        const username = u.username

        const [followers, following] = await Promise.all([
          follows.countDocuments({ targetUsername: username }),   // Number of followers.
          follows.countDocuments({ followerUsername: username })  // Number of accounts they follow.
        ])

        return {
          username,
          bio: u.bio || "",
          followerCount: followers,
          followingCount: following
        }
      })
    )

    res.json({ results })                    // Send structured list back for the "Other paws" panel.
  } catch (err) {
    console.log(err)
    res.json({ results: [], error: "Server error" }) // Empty list + error message if something fails.
  }
})

// ---------------------------------------------------------------------
// FILE UPLOAD HANDLING
// ---------------------------------------------------------------------

// POST /M00932446/upload
// Receives an image, saves it on disk, and returns a public URL for the file.
app.post("/" + STUDENT_ID + "/upload", async (req, res) => {
  try {
    if (!req.files || !req.files.uploadFile) {  // Validate that a file was actually sent.
      return res.status(400).json({ upload: false, error: "File missing" })
    }

    const file = req.files.uploadFile           // The uploaded file object provided by express-fileupload.

    const extIndex = file.name.lastIndexOf(".") // Extract the original file extension (e.g. .png or .jpg).
    const ext = extIndex !== -1 ? file.name.substring(extIndex) : ""

    // Generate a unique filename so different uploads do not overwrite each other.
    const uniqueName =
      Date.now() + "_" + Math.floor(Math.random() * 999999) + ext

    // Build an absolute path where this file will be stored.
    const savePath = path.join(uploadsDir, uniqueName)

    // Move the file from the temp location to our uploads directory.
    file.mv(savePath, err => {
      if (err) {
        console.log(err)
        return res
          .status(500)
          .json({ upload: false, error: "Failed to save file" }) // Tell client the upload failed on the server.
      }

      // Return the public URL so the frontend can store it in posts.
      res.json({
        upload: true,
        filename: uniqueName,
        url: `/${STUDENT_ID}/uploads/${uniqueName}`
      })
    })
  } catch (err) {
    console.log(err)
    res.status(500).json({ upload: false, error: "Server error" })
  }
})

// ---------------------------------------------------------------------
// LOGIN AND SESSION MANAGEMENT
// ---------------------------------------------------------------------

// POST /M00932446/login
// Authenticates a user and starts a session that is stored in a cookie.
app.post("/" + STUDENT_ID + "/login", async (req, res) => {
  try {
    const database = db.getDb()
    const users = database.collection("users")
    const follows = database.collection("follows")

    const username = req.body.username        // Username submitted by the login form.
    const password = req.body.password        // Password submitted by the login form.

    if (!username || !password) {             // Reject missing credentials early.
      return res.json({ success: false, message: "Missing fields" })
    }

    const user = await users.findOne({ username, password }) // Simple lookup for this coursework.

    if (!user) {
      return res.json({ success: false, message: "Invalid login" }) // Do not start a session on wrong details.
    }

    // Count how many followers and following to show in the UI.
    const followerCount = await follows.countDocuments({
      targetUsername: user.username
    })

    const followingCount = await follows.countDocuments({
      followerId: user._id.toString()
    })

    // Store identity in the session so all later requests know who is logged in.
    req.session.userId = user._id.toString()
    req.session.username = user.username

    // Return basic profile details to hydrate the frontend.
    res.json({
      success: true,
      username: user.username,
      bio: user.bio || "",
      followerCount,
      followingCount
    })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

// GET /M00932446/login
// Returns whether a user is logged in and their latest follower stats.
app.get("/" + STUDENT_ID + "/login", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) { // If no session, the frontend knows to show the login overlay.
      return res.json({ loggedIn: false })
    }

    const database = db.getDb()
    const users = database.collection("users")
    const follows = database.collection("follows")

    const user = await users.findOne({
      _id: new ObjectId(req.session.userId)   // Reload full user document based on stored ID.
    })

    let followerCount = 0
    let followingCount = 0
    let bio = ""

    if (user) {
      bio = user.bio || ""                    // Keep existing bio if set.

      // Counts are recomputed on every status check so they stay in sync.
      followerCount = await follows.countDocuments({
        targetUsername: user.username
      })

      followingCount = await follows.countDocuments({
        followerId: req.session.userId
      })
    }

    res.json({
      loggedIn: true,
      userId: req.session.userId,
      username: req.session.username,
      bio,
      followerCount,
      followingCount
    })
  } catch (err) {
    console.log(err)
    res.json({ loggedIn: false, message: "Server error" })
  }
})

// DELETE /M00932446/login
// Logs the user out by destroying the server-side session.
app.delete("/" + STUDENT_ID + "/login", (req, res) => {
  if (!req.session) {                         // Even if no session exists, respond success for simplicity.
    return res.json({ success: true })
  }

  req.session.destroy(err => {                // Remove session from store so cookie no longer maps to a user.
    if (err) {
      console.log(err)
      return res.json({ success: false, message: "Logout failed" })
    }
    res.json({ success: true })               // Frontend clears UI state on this response.
  })
})

// ---------------------------------------------------------------------
// CONTENT (POSTS)
// ---------------------------------------------------------------------

// POST /M00932446/contents
// Creates a new post that can contain text, an image URL, or both.
app.post("/" + STUDENT_ID + "/contents", async (req, res) => {
  if (!req.session || !req.session.userId) {  // Only logged in users can create posts.
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const contents = database.collection("contents") // Collection that stores all posts for the app.

    const text = req.body.text                       // Caption or spell text from the frontend.
    const imageUrl = req.body.imageUrl || null       // Image URL from the upload endpoint, if provided.

    if (!text && !imageUrl) {                        // Reject completely empty posts to keep feed clean.
      return res.json({ success: false, message: "Missing content" })
    }

    const doc = {
      userId: req.session.userId,                    // Link post to the logged in user's ID.
      username: req.session.username,                // Also store username for fast display in feed.
      text: text || "",                              // Always store a string even if empty.
      imageUrl,                                      // May be null if this is a text-only post.
      createdAt: new Date()                          // Timestamp used for sorting by newest first.
    }

    await contents.insertOne(doc)                    // Persist the new post in MongoDB.

    res.json({ success: true })                      // Let the frontend know the post was created.
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

// GET /M00932446/contents
// Returns a global feed of posts, optionally filtered by a text query.
app.get("/" + STUDENT_ID + "/contents", async (req, res) => {
  try {
    const database = db.getDb()
    const contents = database.collection("contents")

    const q = req.query.q || ""                      // Optional text filter for searching post captions.

    const query =
      q.trim().length > 0
        ? { text: { $regex: q, $options: "i" } }     // Case-insensitive regex search when q is present.
        : {}

    const results = await contents
      .find(query)
      .sort({ createdAt: -1 })                       // Newest posts appear at the top of the feed.
      .toArray()

    const mapped = results.map(doc => ({             // Map to the shape expected by the frontend.
      username: doc.username,
      text: doc.text,
      createdAt: doc.createdAt,
      imageUrl: doc.imageUrl || doc.imageData || null // Support both imageUrl and legacy imageData fields.
    }))

    res.json({ results: mapped })                    // Send feed data to the SPA.
  } catch (err) {
    console.log(err)
    res.json({ results: [], error: "Server error" })
  }
})

// ---------------------------------------------------------------------
// FOLLOW / UNFOLLOW
// ---------------------------------------------------------------------

// POST /M00932446/follow
// Adds a follow relationship from the logged in user to another user.
app.post("/" + STUDENT_ID + "/follow", async (req, res) => {
  if (!req.session || !req.session.userId) {         // Prevent anonymous users from following others.
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")

    const targetUsername = req.body.username         // Username we want to follow.

    if (!targetUsername) {
      return res.json({ success: false, message: "Missing username" })
    }

    if (targetUsername === req.session.username) {   // Prevent following yourself.
      return res.json({ success: false, message: "Cannot follow yourself" })
    }

    const existing = await follows.findOne({
      followerId: req.session.userId,
      targetUsername
    })

    if (existing) {                                  // Do not create duplicate follow edges.
      return res.json({ success: false, message: "Already following" })
    }

    await follows.insertOne({
      followerId: req.session.userId,                // Who is doing the following.
      followerUsername: req.session.username,        // Cached follower username for easier queries if needed.
      targetUsername                                // Who they are following.
    })

    res.json({ success: true })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

// DELETE /M00932446/follow
// Removes a follow relationship from the logged in user to a target user.
app.delete("/" + STUDENT_ID + "/follow", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")

    const targetUsername = req.body.username         // Username we want to stop following.

    if (!targetUsername) {
      return res.json({ success: false, message: "Missing username" })
    }

    await follows.deleteOne({
      followerId: req.session.userId,
      targetUsername
    })                                               // Remove exactly one follow edge for this pair.

    res.json({ success: true })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

// GET /M00932446/follow
// Returns the list of usernames that the logged in user is following.
app.get("/" + STUDENT_ID + "/follow", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in", following: [] })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")

    const docs = await follows
      .find({ followerId: req.session.userId })      // All follow edges where current user is the follower.
      .project({ targetUsername: 1, _id: 0 })        // Only return the usernames we follow.
      .toArray()

    const following = docs.map(d => d.targetUsername)

    res.json({ success: true, following })           // Used by frontend to highlight "Following" state.
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error", following: [] })
  }
})

// ---------------------------------------------------------------------
// PERSONALIZED FEED
// ---------------------------------------------------------------------

// GET /M00932446/feed
// Returns posts only from users that the current user follows.
app.get("/" + STUDENT_ID + "/feed", async (req, res) => {
  if (!req.session || !req.session.userId) {         // Feed is only personalised when logged in.
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")
    const contents = database.collection("contents")

    const followDocs = await follows
      .find({ followerId: req.session.userId })      // Get all follow edges for this user.
      .toArray()

    const followedUsernames = followDocs.map(f => f.targetUsername)

    if (followedUsernames.length === 0) {            // If user follows nobody yet, return an empty feed.
      return res.json({ results: [] })
    }

    const results = await contents
      .find({ username: { $in: followedUsernames } }) // Only posts from users we follow.
      .sort({ createdAt: -1 })
      .toArray()

    const mapped = results.map(doc => ({
      username: doc.username,
      text: doc.text,
      createdAt: doc.createdAt,
      imageUrl: doc.imageUrl || doc.imageData || null
    }))

    res.json({ results: mapped })
  } catch (err) {
    console.log(err)
    res.json({ results: [], error: "Server error" })
  }
})

// ---------------------------------------------------------------------
// THIRD-PARTY DATA: MYSTIC ORACLE
// ---------------------------------------------------------------------

// GET /M00932446/oracle
// Calls two public APIs for a cat fact and cat image, then returns combined data.
app.get("/" + STUDENT_ID + "/oracle", async (req, res) => {
  try {
    const [factJson, imgJson] = await Promise.all([
      fetchJson("https://catfact.ninja/fact"),               // Random cat fact as plain JSON.
      fetchJson("https://api.thecatapi.com/v1/images/search")// Random cat image from The Cat API.
    ])

    const imageUrl =
      Array.isArray(imgJson) && imgJson[0] && imgJson[0].url
        ? imgJson[0].url                                    // Use first image result if available.
        : null

    res.json({
      success: true,
      fact: factJson.fact || "Cats are mysterious animals.", // Default fallback fact in case API omits text.
      imageUrl
    })
  } catch (err) {
    console.log(err)
    res.json({
      success: false,
      message: "Could not load mystic oracle",               // Friendly message for the card status field.
      fact: "The mystic oracle is sleeping right now.",      // Fallback text if third-party APIs fail.
      imageUrl: null
    })
  }
})

// ---------------------------------------------------------------------
// SERVER START
// ---------------------------------------------------------------------

// Start listening for HTTP requests on the configured port.
app.listen(PORT, () => {
  console.log("Server running on port", PORT)                // Confirm in terminal that the backend is live.
})
