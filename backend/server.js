// Import core libraries used to build the backend HTTP API.
const express = require("express")
const session = require("express-session")
const { ObjectId } = require("mongodb")
const db = require("./db")
const path = require("path")
const https = require("https")
const fileUpload = require("express-fileupload")
const fs = require("fs")

// Create the Express application instance.
const app = express()

// Port for the Node server to listen on.
const PORT = 8080

// Student ID used to namespace all routes.
const STUDENT_ID = "M00932446"

// ---------------------------------------------------------------------
// GLOBAL MIDDLEWARE
// ---------------------------------------------------------------------

// Parse JSON request bodies into req.body.
app.use(express.json({ limit: "10mb" }))

// Enable file upload handling.
app.use(fileUpload())

// Configure session support.
app.use(
  session({
    secret: "change_this_secret",
    resave: false,
    saveUninitialized: false
  })
)

// Ensure uploads folder exists for file uploads.
const uploadsDir = path.join(__dirname, "uploads")
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir)
}

// Connect to MongoDB as soon as the server starts.
db.connect()

// Serve static frontend files from the "frontend" folder.
app.use(
  "/" + STUDENT_ID,
  express.static(path.join(__dirname, "..", "frontend"))
)

// Serve uploaded files.
app.use(
  "/" + STUDENT_ID + "/uploads",
  express.static(uploadsDir)
)

// Make http://localhost:8080 load the frontend as well.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"))
})

// ---------------------------------------------------------------------
// TEST ROUTE
// ---------------------------------------------------------------------

app.get("/" + STUDENT_ID + "/test", (req, res) => {
  res.json({ message: "Server working" })
})

// ---------------------------------------------------------------------
// SMALL HTTPS JSON HELPER (for third-party APIs)
// ---------------------------------------------------------------------

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = ""

        res.on("data", chunk => {
          data += chunk
        })

        res.on("end", () => {
          try {
            const json = JSON.parse(data)
            resolve(json)
          } catch (err) {
            reject(err)
          }
        })
      })
      .on("error", err => {
        reject(err)
      })
  })
}

// ---------------------------------------------------------------------
// USER CREATION AND PROFILE UPDATES
// ---------------------------------------------------------------------

app.post("/" + STUDENT_ID + "/users", async (req, res) => {
  try {
    const database = db.getDb()
    const users = database.collection("users")

    const { username, password, bio } = req.body

    // Registration
    if (username && password && (!req.session || !req.session.userId)) {
      const exists = await users.findOne({ username })
      if (exists) {
        return res.json({ success: false, message: "Username taken" })
      }

      await users.insertOne({ username, password })
      return res.json({ success: true })
    }

    // Profile update
    if (typeof bio === "string" && req.session && req.session.userId) {
      await users.updateOne(
        { username: req.session.username },
        { $set: { bio } }
      )
      return res.json({ success: true })
    }

    return res.json({ success: false, message: "Missing fields" })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

// ---------------------------------------------------------------------
// USER SEARCH AND PROFILE STATS
// ---------------------------------------------------------------------

app.get("/" + STUDENT_ID + "/users", async (req, res) => {
  try {
    const database = db.getDb()
    const users = database.collection("users")
    const follows = database.collection("follows")

    const q = req.query.q || ""

    // Stats for current user.
    if (q === "__me_stats" && req.session && req.session.username) {
      const username = req.session.username

      const [userDoc, followers, following] = await Promise.all([
        users.findOne(
          { username },
          { projection: { username: 1, bio: 1, _id: 0 } }
        ),
        follows.countDocuments({ targetUsername: username }),
        follows.countDocuments({ followerUsername: username })
      ])

      return res.json({
        success: true,
        mode: "stats",
        username,
        bio: (userDoc && userDoc.bio) || "",
        followers,
        following
      })
    }

    // Normal search.
    const basicUsers = await users
      .find({ username: { $regex: q, $options: "i" } })
      .project({ username: 1, bio: 1 })
      .toArray()

    const results = await Promise.all(
      basicUsers.map(async u => {
        const username = u.username

        const [followers, following] = await Promise.all([
          follows.countDocuments({ targetUsername: username }),
          follows.countDocuments({ followerUsername: username })
        ])

        return {
          username,
          bio: u.bio || "",
          followerCount: followers,
          followingCount: following
        }
      })
    )

    res.json({ results })
  } catch (err) {
    console.log(err)
    res.json({ results: [], error: "Server error" })
  }
})

// ---------------------------------------------------------------------
// FILE UPLOAD HANDLING
// ---------------------------------------------------------------------

app.post("/" + STUDENT_ID + "/upload", async (req, res) => {
  try {
    if (!req.files || !req.files.uploadFile) {
      return res.status(400).json({ upload: false, error: "File missing" })
    }

    const file = req.files.uploadFile

    const extIndex = file.name.lastIndexOf(".")
    const ext = extIndex !== -1 ? file.name.substring(extIndex) : ""

    const uniqueName =
      Date.now() + "_" + Math.floor(Math.random() * 999999) + ext

    const savePath = path.join(uploadsDir, uniqueName)

    file.mv(savePath, err => {
      if (err) {
        console.log(err)
        return res
          .status(500)
          .json({ upload: false, error: "Failed to save file" })
      }

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

app.post("/" + STUDENT_ID + "/login", async (req, res) => {
  try {
    const database = db.getDb()
    const users = database.collection("users")
    const follows = database.collection("follows")

    const username = req.body.username
    const password = req.body.password

    if (!username || !password) {
      return res.json({ success: false, message: "Missing fields" })
    }

    const user = await users.findOne({ username, password })

    if (!user) {
      return res.json({ success: false, message: "Invalid login" })
    }

    const followerCount = await follows.countDocuments({
      targetUsername: user.username
    })

    const followingCount = await follows.countDocuments({
      followerId: user._id.toString()
    })

    req.session.userId = user._id.toString()
    req.session.username = user.username

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

app.get("/" + STUDENT_ID + "/login", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.json({ loggedIn: false })
    }

    const database = db.getDb()
    const users = database.collection("users")
    const follows = database.collection("follows")

    const user = await users.findOne({
      _id: new ObjectId(req.session.userId)
    })

    let followerCount = 0
    let followingCount = 0
    let bio = ""

    if (user) {
      bio = user.bio || ""

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

app.delete("/" + STUDENT_ID + "/login", (req, res) => {
  if (!req.session) {
    return res.json({ success: true })
  }

  req.session.destroy(err => {
    if (err) {
      console.log(err)
      return res.json({ success: false, message: "Logout failed" })
    }
    res.json({ success: true })
  })
})

// ---------------------------------------------------------------------
// CONTENT (POSTS)
// ---------------------------------------------------------------------

app.post("/" + STUDENT_ID + "/contents", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const contents = database.collection("contents")

    const text = req.body.text
    const imageUrl = req.body.imageUrl || null

    if (!text && !imageUrl) {
      return res.json({ success: false, message: "Missing content" })
    }

    const doc = {
      userId: req.session.userId,
      username: req.session.username,
      text: text || "",
      imageUrl,
      createdAt: new Date()
    }

    await contents.insertOne(doc)

    res.json({ success: true })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

app.get("/" + STUDENT_ID + "/contents", async (req, res) => {
  try {
    const database = db.getDb()
    const contents = database.collection("contents")

    const q = req.query.q || ""

    const query =
      q.trim().length > 0
        ? { text: { $regex: q, $options: "i" } }
        : {}

    const results = await contents
      .find(query)
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
// FOLLOW / UNFOLLOW
// ---------------------------------------------------------------------

app.post("/" + STUDENT_ID + "/follow", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")

    const targetUsername = req.body.username

    if (!targetUsername) {
      return res.json({ success: false, message: "Missing username" })
    }

    if (targetUsername === req.session.username) {
      return res.json({ success: false, message: "Cannot follow yourself" })
    }

    const existing = await follows.findOne({
      followerId: req.session.userId,
      targetUsername
    })

    if (existing) {
      return res.json({ success: false, message: "Already following" })
    }

    await follows.insertOne({
      followerId: req.session.userId,
      followerUsername: req.session.username,
      targetUsername
    })

    res.json({ success: true })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

app.delete("/" + STUDENT_ID + "/follow", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")

    const targetUsername = req.body.username

    if (!targetUsername) {
      return res.json({ success: false, message: "Missing username" })
    }

    await follows.deleteOne({
      followerId: req.session.userId,
      targetUsername
    })

    res.json({ success: true })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error" })
  }
})

app.get("/" + STUDENT_ID + "/follow", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in", following: [] })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")

    const docs = await follows
      .find({ followerId: req.session.userId })
      .project({ targetUsername: 1, _id: 0 })
      .toArray()

    const following = docs.map(d => d.targetUsername)

    res.json({ success: true, following })
  } catch (err) {
    console.log(err)
    res.json({ success: false, message: "Server error", following: [] })
  }
})

// ---------------------------------------------------------------------
// PERSONALIZED FEED
// ---------------------------------------------------------------------

app.get("/" + STUDENT_ID + "/feed", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ success: false, message: "Not logged in" })
  }

  try {
    const database = db.getDb()
    const follows = database.collection("follows")
    const contents = database.collection("contents")

    const followDocs = await follows
      .find({ followerId: req.session.userId })
      .toArray()

    const followedUsernames = followDocs.map(f => f.targetUsername)

    if (followedUsernames.length === 0) {
      return res.json({ results: [] })
    }

    const results = await contents
      .find({ username: { $in: followedUsernames } })
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

app.get("/" + STUDENT_ID + "/oracle", async (req, res) => {
  try {
    const [factJson, imgJson] = await Promise.all([
      fetchJson("https://catfact.ninja/fact"),
      fetchJson("https://api.thecatapi.com/v1/images/search")
    ])

    const imageUrl =
      Array.isArray(imgJson) && imgJson[0] && imgJson[0].url
        ? imgJson[0].url
        : null

    res.json({
      success: true,
      fact: factJson.fact || "Cats are mysterious animals.",
      imageUrl
    })
  } catch (err) {
    console.log(err)
    res.json({
      success: false,
      message: "Could not load mystic oracle",
      fact: "The mystic oracle is sleeping right now.",
      imageUrl: null
    })
  }
})

// ---------------------------------------------------------------------
// SERVER START
// ---------------------------------------------------------------------

app.listen(PORT, () => {
  console.log("Server running on port", PORT)
})
