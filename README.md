# Mystic Paws  
Social Media Website – CST2120 Coursework 2  

Mystic Paws is a full-stack social networking web application built for the CST2120 module. The project demonstrates core web development concepts including authentication, sessions, CRUD operations, file uploads, social networking logic, and client–server communication.

The system allows users to register, log in, create posts with optional images, follow other users, and view both a global feed and a personalised following feed. It also integrates a third-party “Mystic Oracle” feature using public APIs.

---

## Features

- User registration and login  
- Session-based authentication  
- Editable user profiles with bio  
- Create posts with text and optional images  
- Image upload system with server-side storage  
- Global “Explore” feed  
- Personalised “Following” feed  
- Follow and unfollow users  
- Live follower and following counts  
- User hover cards with social actions  
- Search for users and posts  
- Third-party “Mystic Oracle” card  

---

## Technology Stack

- Node.js with Express  
- MongoDB  
- express-session for authentication  
- express-fileupload for image handling  
- Vanilla JavaScript frontend  
- HTML and CSS  

---

## Project Structure

Social-Media-Website/
│
├── backend/
│   ├── server.js
│   ├── db.js
│   └── uploads/
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── dumps/
└── README.md

All API routes are namespaced using the student ID:

/M00932446/...

This ensures the application does not conflict with other submissions.

---

## How to Run

1. Install dependencies  
npm install

2. Start MongoDB  

3. Run the server  
node backend/server.js

4. Open in your browser  
http://localhost:8080

---

## Notes

- The application uses session cookies to track logged-in users.  
- All protected actions such as posting, following, and profile editing require an active session.  
- Uploaded images are stored in backend/uploads and served statically.  
- The project includes a database dump in the dumps folder for assessment.  

This coursework demonstrates a complete social networking system with both front-end and back-end logic, built from scratch using core web technologies.
