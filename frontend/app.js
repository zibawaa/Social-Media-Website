// ============================================================================
// Mystic Paws frontend logic (app.js)
// Handles: auth, profile, posting, feeds, following, hover cards, search
// ============================================================================

// Student ID is used in every backend route so the marker can see it is my work
const STUDENT_ID = "M00932446"

// Base URL of my own backend API for this assignment
const BASE_URL = window.location.origin + "/" + STUDENT_ID

// Which feed is currently visible: "following" (personal) or "explore" (all)
let currentFeedMode = "explore"

// Holds the image preview data for the current post (for the glowing circle)
let currentPostImageData = null

// Holds the actual File object that will be uploaded for the post
let currentPostImageFile = null

// Username of the currently logged in user, or null if logged out
let currentUsername = null

// Timer id used to delay hiding of the hover card so it feels smoother
let userHoverHideTimer = null

// Shared DOM element that holds the hover card content
let userHoverCard = null

// Container that positions the hover card relative to the "Other paws" panel
let userHoverContainer = null

// Cached count of followers for the current user (used in profile and hover)
let currentFollowersCount = 0

// Cached count of how many users the current user follows
let currentFollowingCount = 0

// ============================================================================
// Small helper utilities
// ============================================================================

/**
 * Wrapper around fetch that automatically:
 *  - prefixes the base URL and student id
 *  - sends JSON bodies
 *  - includes cookies for the session
 *
 * path: string like "/login" or "/contents?q=..."
 * options: { method, body } optional
 */
function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    },
    // include cookies so the node server can read the session
    credentials: "include"
  }

  // Only attach body for methods that send JSON data
  if (options.body) {
    config.body = JSON.stringify(options.body)
  }

  return fetch(BASE_URL + path, config)
}

/**
 * Shorthand for document.getElementById
 */
function $(id) {
  return document.getElementById(id)
}

/**
 * Safe helper to set textContent on an element by id
 */
function setText(id, text) {
  const el = $(id)
  if (el) el.textContent = text
}

/**
 * Helper to show an element by removing the "hidden" class
 */
function showElement(id) {
  const el = $(id)
  if (el) el.classList.remove("hidden")
}

/**
 * Helper to hide an element by adding the "hidden" class
 */
function hideElement(id) {
  const el = $(id)
  if (el) el.classList.add("hidden")
}

/**
 * Small toast at the bottom of the screen, used for global status messages
 */
function showGlobalMessage(message) {
  const box = $("globalMessage")
  if (!box) return
  box.textContent = message
  box.classList.remove("hidden")
  // Hide the message again after 2.5 seconds
  setTimeout(() => box.classList.add("hidden"), 2500)
}

/**
 * Standalone demo file upload form (the small demo box under the post form)
 */
async function uploadFile() {
  const serverResponse = document.getElementById("ServerResponse")
  serverResponse.innerHTML = ""

  const fileArray = document.getElementById("FileInput").files
  if (fileArray.length !== 1) {
    serverResponse.innerHTML = "Select a file"
    return
  }

  const formData = new FormData()
  formData.append("uploadFile", fileArray[0])

  try {
    const res = await fetch("/M00932446/upload", {
      method: "POST",
      body: formData
    })

    const result = await res.json()

    if (!result.upload) {
      serverResponse.innerHTML = "Upload failed: " + result.error
      return
    }

    serverResponse.innerHTML = "Uploaded successfully: " + result.filename

    document.getElementById("UploadedImage").innerHTML =
      `<img src="${result.url}" style="max-width:300px;">`
  } catch (err) {
    serverResponse.innerHTML = "Server error"
  }
}

/**
 * Helper used by posts to upload an image file to /M00932446/upload
 * Returns the public URL of the stored image
 */
async function uploadPostImage(file) {
  const formData = new FormData()
  formData.append("uploadFile", file)

  const res = await fetch("/" + STUDENT_ID + "/upload", {
    method: "POST",
    body: formData
  })

  const result = await res.json()

  if (!result.upload) {
    throw new Error(result.error || "Upload failed")
  }

  return result.url
}

// ============================================================================
// Post search above feed
// ============================================================================

function wirePostSearch() {
  const form = document.getElementById("postSearchForm")
  const input = document.getElementById("postSearchQuery")
  const msg = document.getElementById("feedSearchMessage")

  if (!form || !input) return

  form.addEventListener("submit", (e) => {
    e.preventDefault()

    const q = input.value.trim()
    msg.textContent = ""

    if (!q) {
      msg.textContent = "Enter a search term"
      renderFeed([], "feedList")
      return
    }

    fetch(`/M00932446/contents?q=${encodeURIComponent(q)}`, {
      method: "GET",
      credentials: "include"
    })
      .then(res => res.json())
      .then(data => {
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.results)
          ? data.results
          : []

        if (items.length === 0) {
          msg.textContent = "No posts matched that spell"
        } else {
          msg.textContent = ""
        }

        renderFeed(items, "feedList")
      })
      .catch(() => {
        msg.textContent = "Search error"
        renderFeed([], "feedList")
      })
  })
}

// ============================================================================
// Following cache (frontend only)
// ============================================================================

// Local cache of who I follow, so I do not need to hit the server for
// every hover. It is persisted in localStorage between sessions.
let followingSet = new Set(
  JSON.parse(localStorage.getItem("mpFollowing") || "[]")
)

/**
 * Adds or removes a username from followingSet and keeps localStorage
 * and the numeric counter in sync.
 */
function setFollowingFlag(username, isFollowing) {
  if (!username) return

  if (isFollowing) {
    followingSet.add(username)
  } else {
    followingSet.delete(username)
  }

  // Save to localStorage so the state is restored after refresh
  localStorage.setItem("mpFollowing", JSON.stringify([...followingSet]))

  // Keep currentFollowingCount in sync with this set
  currentFollowingCount = followingSet.size
}

// ============================================================================
// Header avatar
// ============================================================================

/**
 * Updates the circle avatar in the top left header.
 * For this assignment avatar is just the first letter of the username.
 */
function updateHeaderAvatar(username) {
  const img = $("headerAvatarImg")
  const initial = $("headerAvatarInitial")
  if (!img || !initial) return

  const letter = username ? username.charAt(0).toUpperCase() : "M"
  initial.textContent = letter
  initial.classList.remove("hidden")
  img.classList.add("hidden")
}

// ============================================================================
// Login state and top level UI switching
// ============================================================================

/**
 * Central place that turns the UI into "logged in" or "logged out" mode.
 * Called after:
 *  - login
 *  - registration + login
 *  - logout
 *  - initial /login status check
 *
 * It also updates:
 *  - profile card counts
 *  - header text
 *  - follower / following numbers
 */
function updateLoggedInUI(username, bioText, followerCount = 0, followingCount = 0) {
  const appShell = document.querySelector(".app-shell")

  // Logged in branch
  if (username) {
    currentUsername = username

    // Cache stats for use in the hover card and profile
    currentFollowersCount = followerCount
    currentFollowingCount = followingCount

    // Show initial stats in the profile card
    setText("profileFollowersCount", String(currentFollowersCount))
    setText("profileFollowingCount", String(currentFollowingCount))

    // Ask backend which users I follow so local cache is consistent with DB
    api("/follow")
      .then(res => res.json())
      .then(data => {
        // following is an array of usernames returned by the new GET /follow route
        followingSet = new Set(data.following || [])
        localStorage.setItem("mpFollowing", JSON.stringify([...followingSet]))
        currentFollowingCount = followingSet.size
        setText("profileFollowingCount", String(currentFollowingCount))
      })
      .catch(() => {
        // In case of error we keep the counts from login response
      })

    // Toggle header login state
    hideElement("statusLoggedOut")
    showElement("statusLoggedIn")

    // Update texts that mention the current user
    setText("currentUserName", username)
    setText("profileUsername", username)
    setText("profileNote", "You are logged in as " + username)

    // First letter for the profile avatar circle
    const first = username.charAt(0).toUpperCase() || "U"
    $("profileAvatarInitial").textContent = first

    // Fill bio textarea with current value
    $("profileBio").value = bioText || ""

    // Also update the tiny header avatar
    updateHeaderAvatar(username)

    // Remove blur lock and hide auth dialog
    hideAuthOverlay()
    appShell.classList.remove("locked")

    // When user logs in, automatically show Explore feed for more content
    const exploreBtn = $("showExploreFeed")
    if (exploreBtn) exploreBtn.click()
    else refreshFeed()

    // Refresh "Other paws" list so the follow states and stats are fresh
    refreshUsers()

    return
  }

  // Logged out branch

  currentUsername = null
  currentFollowersCount = 0
  currentFollowingCount = 0

  // Clear following cache on logout so it does not bleed between accounts
  followingSet = new Set()
  localStorage.removeItem("mpFollowing")

  showElement("statusLoggedOut")
  hideElement("statusLoggedIn")

  // Reset the profile card to a neutral state
  setText("profileUsername", "You")
  setText("profileNote", "You are not logged in yet")
  setText("profileFollowersCount", "0")
  setText("profileFollowingCount", "0")

  $("profileAvatarInitial").textContent = "M"
  $("profileBio").value = ""

  updateHeaderAvatar(null)

  // Show Following tab by default, even if it will be empty when logged out
  $("showFollowingFeed").click()

  // Re-lock the main app and show login dialog
  showAuthOverlay()
  appShell.classList.add("locked")

  // Refresh users so the list is visible even when logged out
  refreshUsers()
}

// ============================================================================
// User search in "Other paws"
// ============================================================================

/**
 * Handles the small search form on the right column.
 * It sends q as a query string to /users and reuses renderUserResults.
 */
function wireUserSearch() {
  const form = $("userSearchForm")
  if (!form) return

  form.addEventListener("submit", e => {
    e.preventDefault()

    const qInput = $("userSearchQuery")
    const q = qInput ? qInput.value.trim() : ""

    // If query is empty, get all users. If not, let server filter by regex.
    const path = q ? "/users?q=" + encodeURIComponent(q) : "/users"

    api(path)
      .then(res => res.json())
      .then(data => {
        renderUserResults(data.results || data || [])
      })
      .catch(() => {
        renderUserResults([])
      })
  })
}

// ============================================================================
// Auth overlay helpers
// ============================================================================

function showAuthOverlay() {
  const overlay = $("authOverlay")
  if (overlay) overlay.classList.add("visible")
}

function hideAuthOverlay() {
  const overlay = $("authOverlay")
  if (overlay) overlay.classList.remove("visible")
}

// ============================================================================
// Feed rendering
// ============================================================================

/**
 * Renders a list of content items into the given <ul>.
 * Used for the main feed and also for a search feed if needed.
 */
function renderFeed(items, targetId) {
  const list = $(targetId)
  const emptyHint = $("feedEmpty")
  if (!list) return

  list.innerHTML = ""

  // If no posts, show the hint in the main feed area
  if (!items || items.length === 0) {
    if (emptyHint && targetId === "feedList") {
      emptyHint.classList.remove("hidden")
    }
    return
  }

  if (emptyHint && targetId === "feedList") {
    emptyHint.classList.add("hidden")
  }

  items.forEach((item) => {
    const li = document.createElement("li")
    li.className = "mp-feed-item"

    // Top meta row with username and time
    const meta = document.createElement("div")
    meta.className = "feed-meta"

    const userSpan = document.createElement("span")
    userSpan.className = "feed-user"
    userSpan.textContent = item.username || "unknown"

    const timeSpan = document.createElement("span")
    timeSpan.className = "feed-time"
    const when = item.createdAt ? new Date(item.createdAt) : null
    timeSpan.textContent = when ? when.toLocaleString() : ""

    meta.appendChild(userSpan)
    meta.appendChild(timeSpan)

    // Text content
    const textDiv = document.createElement("div")
    textDiv.className = "feed-text"
    textDiv.textContent = item.text || ""

    li.appendChild(meta)
    li.appendChild(textDiv)

    // Optional image content
    if (item.imageUrl) {
      const img = document.createElement("img")
      img.className = "mp-feed-item-image"
      img.src = item.imageUrl
      img.alt = "Post image"
      li.appendChild(img)
    }

    list.appendChild(li)
  })
}

// ============================================================================
// Optional helper to attach per-row hover. Not used now but kept for clarity.
// ============================================================================

function attachUserHover(listItem, card) {
  let hideTimer = null

  // Directly show card while mouse is over list item or card
  function showCard() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    card.style.display = "block"
  }

  // Delay hiding a bit so moving from row to card feels natural
  function scheduleHide() {
    hideTimer = setTimeout(() => {
      card.style.display = "none"
    }, 400)
  }

  listItem.addEventListener("mouseenter", showCard)
  listItem.addEventListener("mouseleave", scheduleHide)

  card.addEventListener("mouseenter", showCard)
  card.addEventListener("mouseleave", scheduleHide)
}

// THIRD-PARTY CARD: MYSTIC ORACLE

function wireMysticOracle() {
  const btn = $("oracleRefreshButton")
  const img = $("oracleImage")
  const factEl = $("oracleFact")

  if (!btn || !img || !factEl) return

  function loadOracle() {
    api("/oracle")
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          factEl.textContent = data.message || "Could not load mystic oracle"
          return
        }

        factEl.textContent = data.fact
        if (data.imageUrl) {
          img.src = data.imageUrl
        }
      })
      .catch(() => {
        factEl.textContent = "Server error while loading mystic oracle"
      })
  }

  btn.addEventListener("click", loadOracle)
  loadOracle()
}

// ============================================================================
// Shared hover card elements
// ============================================================================

/**
 * Makes sure we have a shared hover container + card in the DOM
 * and wires the enter or leave handlers that cancel the hide timer.
 */
function ensureUserHoverElements() {
  if (!userHoverContainer) {
    userHoverContainer = $("userHoverContainer")
  }

  if (userHoverContainer && !userHoverCard) {
    userHoverCard = document.createElement("div")
    userHoverCard.className = "user-hover-card"
    userHoverContainer.appendChild(userHoverCard)

    // If mouse enters the card, stop any pending hide
    userHoverCard.addEventListener("mouseenter", () => {
      if (userHoverHideTimer) {
        clearTimeout(userHoverHideTimer)
        userHoverHideTimer = null
      }
    })

    // If mouse leaves the card, schedule hiding
    userHoverCard.addEventListener("mouseleave", () => {
      scheduleUserHoverHide()
    })
  }
}

/**
 * Fills and shows the hover card for a given user.
 * It reuses the cached follow set and the current user's stats.
 */
function showUserHover(user, anchorLi) {
  ensureUserHoverElements()
  if (!userHoverContainer || !userHoverCard) return

  // Cancel any pending hide so the card stays visible
  if (userHoverHideTimer) {
    clearTimeout(userHoverHideTimer)
    userHoverHideTimer = null
  }

  // Vertically align card with the hovered list item
  const rect = anchorLi.getBoundingClientRect()
  const panelRect = $("userSearchPanel").getBoundingClientRect()
  const offsetY = rect.top - panelRect.top
  userHoverContainer.style.top = Math.max(40, offsetY) + "px"

  const username = user.username
  const bio = user.bio || "No bio yet"
  const isSelf = currentUsername && username === currentUsername
  const isFollowing = followingSet.has(username)

  // Stats: self from cached counts, others from backend
  let followers = isSelf
    ? currentFollowersCount ||
      parseInt($("profileFollowersCount").textContent || "0", 10) ||
      0
    : user.followerCount || 0

  let following = isSelf
    ? currentFollowingCount ||
      parseInt($("profileFollowingCount").textContent || "0", 10) ||
      0
    : user.followingCount || 0

  // Local copies used on the card so we can adjust after follow or unfollow
  let cardFollowers = followers
  let cardFollowing = following

  userHoverCard.innerHTML = ""

  // Header row
  const header = document.createElement("div")
  header.className = "user-hover-header"

  const avatar = document.createElement("div")
  avatar.className = "user-hover-avatar"
  avatar.textContent = username.charAt(0).toUpperCase()

  const nameSpan = document.createElement("span")
  nameSpan.className = "user-hover-name"
  nameSpan.textContent = isSelf ? username + " (You)" : username

  header.appendChild(avatar)
  header.appendChild(nameSpan)

  // Bio
  const bioP = document.createElement("p")
  bioP.className = "user-hover-bio"
  bioP.textContent = bio

  // Stats badges
  const stats = document.createElement("div")
  stats.className = "user-hover-stats"

  const followersSpan = document.createElement("span")
  followersSpan.className = "stat-item"
  followersSpan.textContent = cardFollowers + " Followers"

  const followingSpan = document.createElement("span")
  followingSpan.className = "stat-item"
  followingSpan.textContent = cardFollowing + " Following"

  stats.appendChild(followersSpan)
  stats.appendChild(followingSpan)

  // Actions row
  const actions = document.createElement("div")
  actions.className = "user-hover-actions"

  if (!isSelf) {
    const followBtn = document.createElement("button")
    followBtn.className = "btn btn-small user-hover-follow-btn"

    if (isFollowing) {
      followBtn.textContent = "Following"
      followBtn.classList.add("following")

      followBtn.addEventListener("mouseenter", () => {
        followBtn.textContent = "Unfollow"
      })

      followBtn.addEventListener("mouseleave", () => {
        followBtn.textContent = "Following"
      })
    } else {
      followBtn.textContent = "Follow"
    }

    followBtn.addEventListener("click", () => {
      const currentlyFollowing = followingSet.has(username)

      // Unfollow
      if (currentlyFollowing) {
        api("/follow", { method: "DELETE", body: { username } })
          .then(res => res.json())
          .then(data => {
            if (!data.success) {
              showGlobalMessage(data.message || "Could not unfollow")
              return
            }

            setFollowingFlag(username, false)
            followBtn.textContent = "Follow"
            followBtn.classList.remove("following")
            setText("profileFollowingCount", String(currentFollowingCount))

            // Update this user's follower count on card
            cardFollowers = Math.max(0, cardFollowers - 1)
            followersSpan.textContent = cardFollowers + " Followers"

            refreshFeed()
          })
          .catch(() => {
            showGlobalMessage("Server error")
          })

        return
      }

      // Follow
      api("/follow", { method: "POST", body: { username } })
        .then(res => res.json())
        .then(data => {
          if (!data.success) {
            showGlobalMessage(data.message || "Could not follow")
            return
          }

          setFollowingFlag(username, true)
          followBtn.textContent = "Following"
          followBtn.classList.add("following")
          setText("profileFollowingCount", String(currentFollowingCount))

          // Increment follower count on card
          cardFollowers += 1
          followersSpan.textContent = cardFollowers + " Followers"

          // Re-enable hover text swap once we follow
          followBtn.addEventListener("mouseenter", () => {
            followBtn.textContent = "Unfollow"
          })

          followBtn.addEventListener("mouseleave", () => {
            followBtn.textContent = "Following"
          })

          refreshFeed()
        })
        .catch(() => {
          showGlobalMessage("Server error")
        })
    })

    actions.appendChild(followBtn)
  }

  // Assemble card
  userHoverCard.appendChild(header)
  userHoverCard.appendChild(bioP)
  userHoverCard.appendChild(stats)
  userHoverCard.appendChild(actions)

  userHoverContainer.classList.add("visible")
}

/**
 * Starts a small timer that hides the hover card after 300 ms.
 * Called when the mouse leaves the list item and the hover card.
 */
function scheduleUserHoverHide() {
  if (!userHoverContainer) return
  if (userHoverHideTimer) {
    clearTimeout(userHoverHideTimer)
  }
  userHoverHideTimer = setTimeout(() => {
    userHoverContainer.classList.remove("visible")
  }, 300)
}

// ============================================================================
// Render helpers for "Other paws" list
// ============================================================================

/**
 * Renders the list of users in the right column and attaches hover handlers.
 */
function renderUserResults(results) {
  const list = $("userSearchResults")
  if (!list) return
  list.innerHTML = ""

  if (!results || results.length === 0) {
    const li = document.createElement("li")
    li.textContent = "No other paws found yet"
    list.appendChild(li)
    return
  }

  results.forEach(u => {
    const username = u.username

    const li = document.createElement("li")
    li.className = "mp-user-list-item"
    li.textContent = username

    // Show the shared hover card when user hovers this row
    li.addEventListener("mouseenter", () => {
      showUserHover(u, li)
    })

    li.addEventListener("mouseleave", () => {
      scheduleUserHoverHide()
    })

    list.appendChild(li)
  })
}

// ============================================================================
// Startup: run after DOM is ready
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const appShell = document.querySelector(".app-shell")
  if (appShell) appShell.classList.add("locked")

  showAuthOverlay()
  wireAuthForms()
  wirePostForm()
  wireSearchForms()
  wirePostSearch()
  wireFollowForms()
  wireLogout()
  wireCharCount()
  wireFeedToggle()
  wireUserRefresh()
  wireProfileCard()
  wireImageDrop()
  wireUserSearch()
  wireMysticOracle()

  // Initial data load
  refreshFeed()
  refreshUsers()
  checkLoginStatus()
})

// ============================================================================
// Auth forms and login or registration logic
// ============================================================================

function wireAuthForms() {
  const loginForm = $("loginForm")
  const registerForm = $("registerForm")
  const loginSection = $("loginSection")
  const registerSection = $("registerSection")
  const showRegisterBtn = $("showRegister")
  const showLoginBtn = $("showLogin")

  // Simple tab switcher between Login and Register views
  function showLoginView() {
    if (loginSection) loginSection.classList.remove("hidden")
    if (registerSection) registerSection.classList.add("hidden")
  }

  function showRegisterView() {
    if (loginSection) loginSection.classList.add("hidden")
    if (registerSection) registerSection.classList.remove("hidden")
  }

  if (showRegisterBtn) {
    showRegisterBtn.addEventListener("click", () => {
      showRegisterView()
    })
  }

  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", () => {
      showLoginView()
    })
  }

  // Login form
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault()
      const username = $("loginUsername").value.trim()
      const password = $("loginPassword").value.trim()
      const msg = $("loginMessage")

      if (msg) {
        msg.textContent = ""
        msg.className = "mp-message"
      }

      // Client side validation
      if (!username && !password) {
        if (msg) {
          msg.textContent = "Enter a username and password"
          msg.className = "mp-message error"
        }
        return
      }
      if (!username) {
        if (msg) {
          msg.textContent = "Enter a username"
          msg.className = "mp-message error"
        }
        return
      }
      if (!password) {
        if (msg) {
          msg.textContent = "Enter a password"
          msg.className = "mp-message error"
        }
        return
      }

      api("/login", { method: "POST", body: { username, password } })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (msg) {
              msg.textContent = "Logged in"
              msg.className = "mp-message success"
            }
            updateLoggedInUI(
              data.username || username,
              data.bio || "",
              data.followerCount || 0,
              data.followingCount || 0
            )
            showGlobalMessage("Welcome back, " + (data.username || username))
          } else {
            if (msg) {
              msg.textContent = data.message || "Login failed"
              msg.className = "mp-message error"
            }
            updateLoggedInUI(null)
          }
        })
        .catch(() => {
          if (msg) {
            msg.textContent = "Server error"
            msg.className = "mp-message error"
          }
        })
    })
  }

  // Registration form
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault()

      const username = $("registerUsername").value.trim()
      const password = $("registerPassword").value.trim()
      const msg = $("registerMessage")

      if (msg) {
        msg.textContent = ""
        msg.className = "mp-message"
      }

      // Simple validation
      if (!username && !password) {
        if (msg) {
          msg.textContent = "Enter a username and password"
          msg.className = "mp-message error"
        }
        return
      }
      if (!username) {
        if (msg) {
          msg.textContent = "Enter a username"
          msg.className = "mp-message error"
        }
        return
      }
      if (!password) {
        if (msg) {
          msg.textContent = "Enter a password"
          msg.className = "mp-message error"
        }
        return
      }

      // Create the user
      api("/users", { method: "POST", body: { username, password } })
        .then((res) => res.json())
        .then((data) => {
          if (!data.success) {
            if (msg) {
              msg.textContent = data.message || "Registration failed"
              msg.className = "mp-message error"
            }
            return
          }

          // Log in automatically
          return api("/login", { method: "POST", body: { username, password } })
            .then((res) => res.json())
            .then((loginData) => {
              if (loginData.success) {
                updateLoggedInUI(
                  loginData.username || username,
                  loginData.bio || "",
                  loginData.followerCount || 0,
                  loginData.followingCount || 0
                )
                showGlobalMessage("Welcome, " + username)
              } else if (msg) {
                msg.textContent = "Account created, but login failed"
                msg.className = "mp-message error"
              }
            })
        })
        .catch(() => {
          if (msg) {
            msg.textContent = "Server error"
            msg.className = "mp-message error"
          }
        })
    })
  }
}

// ============================================================================
// Profile card (bio + avatar)
// ============================================================================

function wireProfileCard() {
  const card = $("profileCard")
  const form = $("profileForm")
  const bioField = $("profileBio")
  const headerAvatar = $("headerAvatar")

  // Tapping the avatar in the header toggles the profile card visibility
  if (headerAvatar && card) {
    headerAvatar.addEventListener("click", () => {
      if (!currentUsername) return
      card.classList.toggle("hidden")
    })
  }

  if (!form || !bioField) return

  // Submit bio update to the backend; backend uses the session user id
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    const bio = bioField.value.trim()

    api("/users", { method: "POST", body: { bio } })
      .then(res => res.json())
      .then(data => {
        if (data && data.success) {
          showGlobalMessage("Profile saved")
        } else {
          showGlobalMessage("Could not save bio")
        }
      })
      .catch(() => {
        showGlobalMessage("Server error")
      })
  })
}

// ============================================================================
// Image dropzone for posts
// ============================================================================

function wireImageDrop() {
  const drop = $("postImageDrop")
  const fileInput = $("postImageFile")
  if (!drop || !fileInput) return

  // Reads the image so we can show it in the glowing circle
  // and keeps the File so we can upload it when posting
  function handleFiles(files) {
    const file = files && files[0]
    if (!file || !file.type.startsWith("image/")) return

    currentPostImageFile = file

    const reader = new FileReader()
    reader.onload = () => {
      currentPostImageData = reader.result
      drop.style.backgroundImage = `url("${currentPostImageData}")`
      const txt = drop.querySelector(".post-drop-text")
      if (txt) txt.style.opacity = "0"
    }
    reader.readAsDataURL(file)
  }

  // Clicking the circle opens the hidden file input
  drop.addEventListener("click", () => fileInput.click())

  // When file is picked from dialog
  fileInput.addEventListener("change", e => handleFiles(e.target.files))

  // Drag and drop effects
  ;["dragenter", "dragover"].forEach(evt => {
    drop.addEventListener(evt, e => {
      e.preventDefault()
      e.stopPropagation()
      drop.classList.add("drag-over")
    })
  })

  ;["dragleave", "drop"].forEach(evt => {
    drop.addEventListener(evt, e => {
      e.preventDefault()
      e.stopPropagation()
      drop.classList.remove("drag-over")
    })
  })

  drop.addEventListener("drop", e => {
    handleFiles(e.dataTransfer.files)
  })
}

// ============================================================================
// Create post form
// ============================================================================

function wirePostForm() {
  const form = $("postForm")
  if (!form) return

  // Async listener because we might need to upload the image first
  form.addEventListener("submit", async e => {
    e.preventDefault()

    const textArea = $("postText")
    const message = $("postMessage")
    const drop = $("postImageDrop")

    if (message) {
      message.textContent = ""
      message.className = "mp-message"
    }

    const text = textArea.value.trim()

    // Require at least some text or an image file
    if (!text && !currentPostImageFile) {
      if (message) {
        message.textContent = "Add a caption or an image first"
        message.className = "mp-message error"
      }
      return
    }

    // Upload image file first, if there is one
    let imageUrl = null
    if (currentPostImageFile) {
      try {
        imageUrl = await uploadPostImage(currentPostImageFile)
      } catch (err) {
        if (message) {
          message.textContent = "Image upload failed"
          message.className = "mp-message error"
        }
        return
      }
    }

    // Now send the post with optional imageUrl to the contents API
    const body = { text }
    if (imageUrl) {
      body.imageUrl = imageUrl
    }

    api("/contents", { method: "POST", body })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // Clear form
          textArea.value = ""
          updateCharCount()

          // Reset image state and preview
          currentPostImageData = null
          currentPostImageFile = null
          if (drop) {
            drop.style.backgroundImage = ""
            const txt = drop.querySelector(".post-drop-text")
            if (txt) txt.style.opacity = "1"
          }

          if (message) {
            message.textContent = "Posted"
            message.className = "mp-message success"
          }
          refreshFeed()
        } else if (message) {
          message.textContent = data.message || "Could not post"
          message.className = "mp-message error"
        }
      })
      .catch(() => {
        if (message) {
          message.textContent = "Server error"
          message.className = "mp-message error"
        }
      })
  })
}

// ============================================================================
// Optional search form for posts (not prominent in the UI)
// ============================================================================

function wireSearchForms() {
  const contentForm = $("contentSearchForm")
  if (!contentForm) return

  contentForm.addEventListener("submit", (e) => {
    e.preventDefault()
    const q = $("contentSearchQuery").value.trim()
    api("/contents?q=" + encodeURIComponent(q))
      .then((res) => res.json())
      .then((data) => {
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.results)
          ? data.results
          : []
        renderFeed(items, "contentSearchResults")
      })
      .catch(() => {
        renderFeed([], "contentSearchResults")
      })
  })
}

// ============================================================================
// Legacy follow forms (not present in final HTML but left for completeness)
// ============================================================================

function wireFollowForms() {
  const followForm = $("followForm")
  const unfollowForm = $("unfollowForm")
  const message = $("followMessage")

  // Basic follow form
  if (followForm) {
    followForm.addEventListener("submit", (e) => {
      e.preventDefault()
      const username = $("followUsername").value.trim()
      if (!username) return
      if (message) message.textContent = ""

      api("/follow", { method: "POST", body: { username } })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (message) {
              message.textContent = "Now following " + username
              message.className = "mp-message success"
            }
            setFollowingFlag(username, true)
            setText("profileFollowingCount", String(followingSet.size))
            refreshFeed()
          } else if (message) {
            message.textContent = data.message || "Could not follow"
            message.className = "mp-message error"
          }
        })
        .catch(() => {
          if (message) {
            message.textContent = "Server error"
            message.className = "mp-message error"
          }
        })
    })
  }

  // Basic unfollow form
  if (unfollowForm) {
    unfollowForm.addEventListener("submit", (e) => {
      e.preventDefault()
      const username = $("unfollowUsername").value.trim()
      if (!username) return
      if (message) message.textContent = ""

      api("/follow", { method: "DELETE", body: { username } })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (message) {
              message.textContent = "Unfollowed " + username
              message.className = "mp-message success"
            }
            setFollowingFlag(username, false)
            setText("profileFollowingCount", String(followingSet.size))
            refreshFeed()
          } else if (message) {
            message.textContent = data.message || "Could not unfollow"
            message.className = "mp-message error"
          }
        })
        .catch(() => {
          if (message) {
            message.textContent = "Server error"
            message.className = "mp-message error"
          }
        })
    })
  }
}

// ============================================================================
// Logout wiring
// ============================================================================

function wireLogout() {
  const button = $("logoutButton")
  if (!button) return

  button.addEventListener("click", (e) => {
    e.preventDefault()
    api("/login", { method: "DELETE" })
      .then((res) => res.json())
      .then(() => {
        updateLoggedInUI(null)
        showGlobalMessage("You have logged out")
      })
      .catch(() => {
        showGlobalMessage("Logout error")
      })
  })
}

// ============================================================================
// Feed mode toggle (Following vs Explore)
// ============================================================================

function wireFeedToggle() {
  const followingBtn = $("showFollowingFeed")
  const exploreBtn = $("showExploreFeed")
  if (!followingBtn || !exploreBtn) return

  // Central function updates the mode and the button styles
  function setMode(mode) {
    currentFeedMode = mode
    if (mode === "following") {
      followingBtn.classList.add("active")
      exploreBtn.classList.remove("active")
    } else {
      exploreBtn.classList.add("active")
      followingBtn.classList.remove("active")
    }
    refreshFeed()
  }

  followingBtn.addEventListener("click", () => setMode("following"))
  exploreBtn.addEventListener("click", () => setMode("explore"))

  // Start on "following" so the label looks active when the page loads
  setMode("following")
}

// ============================================================================
// "Other paws" refresh button
// ============================================================================

function wireUserRefresh() {
  const btn = $("refreshUsersButton")
  if (!btn) return
  btn.addEventListener("click", (e) => {
    e.preventDefault()
    refreshUsers()
  })
}

// ============================================================================
// Data refresh helpers
// ============================================================================

/**
 * Loads either the global explore feed or the personal feed.
 */
function refreshFeed() {
  const path = currentFeedMode === "explore" ? "/contents" : "/feed"

  api(path)
    .then((res) => res.json())
    .then((data) => {
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
        ? data.results
        : []
      renderFeed(items, "feedList")
    })
    .catch(() => {
      renderFeed([], "feedList")
    })
}

/**
 * Loads user list for the "Other paws" panel.
 */
function refreshUsers() {
  api("/users")
    .then((res) => res.json())
    .then((data) => {
      renderUserResults(data.results || data || [])
    })
    .catch(() => {
      renderUserResults([])
    })
}

/**
 * Checks if there is an active session when the page first loads.
 * If the backend session exists, we hydrate the UI as logged in.
 */
function checkLoginStatus() {
  api("/login")
    .then(res => res.json())
    .then(data => {
      if (data.loggedIn) {
        updateLoggedInUI(
          data.username || null,
          data.bio || "",
          data.followerCount || 0,
          data.followingCount || 0
        )
      } else {
        updateLoggedInUI(null)
      }
    })
    .catch(() => {
      updateLoggedInUI(null)
    })
}

// ============================================================================
// Character counter for post textarea
// ============================================================================

function wireCharCount() {
  const text = $("postText")
  if (!text) return
  text.addEventListener("input", updateCharCount)
  updateCharCount()
}

/**
 * Updates the "0 / 280" label under the post textarea.
 */
function updateCharCount() {
  const text = $("postText")
  const label = $("postCharCount")
  if (!text || !label) return
  const len = text.value.length
  label.textContent = len + " / 280"
}
