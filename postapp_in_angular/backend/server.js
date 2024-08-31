const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const { body, validationResult } = require("express-validator");
const fs = require("fs");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:4200",
    methods: ["GET", "POST"],
  },
});

const corsOptions = {
  origin: "http://localhost:4200",
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

// Connect to MongoDB
mongoose
  .connect("mongodb://localhost:27017/postsapp")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, match: /\S+@\S+\.\S+/ },
  password: { type: String, required: true, minlength: 6 },
});
const User = mongoose.model("User", UserSchema);

// Post Schema
const PostSchema = new mongoose.Schema({
  image: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, default: Date.now },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  likesCount: { type: Number, default: 0 },
  comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
});
const Post = mongoose.model("Post", PostSchema);

// Comment Schema
const CommentSchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now },
  replies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Reply" }],
});
const Comment = mongoose.model("Comment", CommentSchema);

// Like Schema
const LikeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
  createdAt: { type: Date, default: Date.now },
});
const Like = mongoose.model("Like", LikeSchema);

// Reply Schema
const ReplySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
  comment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Comment",
    required: true,
  },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now },
});
const Reply = mongoose.model("Reply", ReplySchema);

const JWT_SECRET = "your_jwt_secret";

// In-memory token blacklist
let tokenBlacklist = [];

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Access denied" });

  // Check if token is blacklisted
  if (tokenBlacklist.includes(token)) {
    return res.status(401).json({ message: "Token has been invalidated" });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    console.error("JWT verification error:", err);
    res.status(400).json({ message: "Invalid token" });
  }
};

io.on("connection", (socket) => {
  console.log("A user connected");

  // Handle authentication
  socket.on("authenticate", (token) => {
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      socket.userId = verified.id;
      console.log(`User ${socket.userId} authenticated`);
    } catch (err) {
      console.error("Authentication error:", err);
    }
  });

  // Middleware to ensure socket is authenticated
  const ensureAuthenticated = (socket, next) => {
    if (socket.userId) {
      return next();
    } else {
      console.error("User ID not found in socket");
    }
  };

  // Handle likePost event
  socket.on("likePost", async (postId) => {
    ensureAuthenticated(socket, async () => {
      try {
        const existingLike = await Like.findOne({
          post: postId,
          user: socket.userId,
        });
        if (existingLike) {
          return console.log("User has already liked the post");
        }

        const like = new Like({ post: postId, user: socket.userId });
        await like.save();

        const updatedPost = await Post.findByIdAndUpdate(
          postId,
          { $inc: { likesCount: 1 } },
          { new: true }
        ).populate("user", "username");

        io.emit("postUpdated", { post: updatedPost });

        io.emit("likesCountUpdated", {
          postId,
          likesCount: updatedPost.likesCount,
        });
      } catch (err) {
        console.error("Like post error:", err);
      }
    });
  });

  // Handle unlikePost event
  socket.on("unlikePost", async (postId) => {
    ensureAuthenticated(socket, async () => {
      try {
        const like = await Like.findOneAndDelete({
          post: postId,
          user: socket.userId,
        });
        if (!like) {
          return console.log("User has not liked the post");
        }

        const updatedPost = await Post.findByIdAndUpdate(
          postId,
          { $inc: { likesCount: -1 } },
          { new: true }
        ).populate("user", "username");

        io.emit("postUpdated", { post: updatedPost });

        io.emit("likesCountUpdated", {
          postId,
          likesCount: updatedPost.likesCount,
        });
      } catch (err) {
        console.error("Unlike post error:", err);
      }
    });
  });

  // Handle addComment event
  socket.on("addComment", async ({ postId, text }) => {
    ensureAuthenticated(socket, async () => {
      try {
        const comment = new Comment({
          post: postId,
          user: socket.userId,
          text,
        });

        await comment.save();

        const updatedPost = await Post.findByIdAndUpdate(
          postId,
          { $push: { comments: comment._id } },
          { new: true }
        )
          .populate({
            path: "comments",
            populate: {
              path: "user",
              select: "username",
            },
          })
          .populate("user", "username");

        io.emit("postUpdated", { post: updatedPost });
      } catch (err) {
        console.error("Add comment error:", err);
      }
    });
  });

  // Handle replyToComment event
  socket.on("replyToComment", async ({ postId, commentId, text }) => {
    ensureAuthenticated(socket, async () => {
      try {
        const reply = new Reply({
          post: postId,
          comment: commentId,
          user: socket.userId,
          text,
        });

        await reply.save();

        const comment = await Comment.findByIdAndUpdate(
          commentId,
          { $push: { replies: reply._id } },
          { new: true }
        )
          .populate("user", "username")
          .populate({
            path: "replies",
            populate: {
              path: "user",
              select: "username",
            },
          });

        io.emit("commentUpdated", { comment });
      } catch (err) {
        console.error("Reply to comment error:", err);
      }
    });
  });

  // Handle deleteComment event
  socket.on("deleteComment", async ({ postId, commentId }) => {
    ensureAuthenticated(socket, async () => {
      try {
        const comment = await Comment.findOne({
          _id: commentId,
          $or: [{ user: socket.userId }, { post: postId, user: socket.userId }],
        });

        if (!comment) {
          return console.log("User not authorized to delete this comment");
        }

        await Comment.findByIdAndDelete(commentId);

        await Post.findByIdAndUpdate(
          postId,
          { $pull: { comments: commentId } },
          { new: true }
        );

        io.emit("commentDeleted", { commentId, postId });
      } catch (err) {
        console.error("Delete comment error:", err);
      }
    });
  });

  // Handle deleteReply event
  socket.on("deleteReply", async ({ commentId, replyId }) => {
    ensureAuthenticated(socket, async () => {
      try {
        const reply = await Reply.findOne({
          _id: replyId,
          $or: [{ user: socket.userId }, { comment: commentId }],
        });

        if (!reply) {
          return console.log("User not authorized to delete this reply");
        }

        await Reply.findByIdAndDelete(replyId);

        await Comment.findByIdAndUpdate(
          commentId,
          { $pull: { replies: replyId } },
          { new: true }
        );

        io.emit("replyDeleted", { replyId, commentId });
      } catch (err) {
        console.error("Delete reply error:", err);
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// User signup route
app.post(
  "/signup",
  [
    body("username").not().isEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Email is invalid"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
      let user = await User.findOne({ email });
      if (user) {
        return res.status(400).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      user = new User({ username, email, password: hashedPassword });
      await user.save();

      res.status(201).json({ message: "Signup successful" });
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// User login route
app.post(
  "/login",
  [
    body("email").isEmail().withMessage("Email is invalid"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { id: user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: "36h" }
      );

      res.status(200).json({ token });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Add post route
app.post(
  "/addpost",
  verifyToken,
  upload.single("image"),
  [
    body("title").not().isEmpty().withMessage("Title is required"),
    body("description").not().isEmpty().withMessage("Description is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description } = req.body;

    try {
      const post = new Post({
        image: req.file.path,
        title,
        description,
        user: req.user.id,
      });

      await post.save();

      res.status(201).json({ post });
    } catch (err) {
      console.error("Add post error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get current user route
app.get("/current-user", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user });
  } catch (err) {
    console.error("Get current user error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all posts route
app.get("/posts", async (req, res) => {
  try {
    const posts = await Post.find()
      .populate("user", "username email")
      .populate({
        path: "comments",
        populate: {
          path: "user",
          select: "username",
        },
      });
    res.status(200).json({ posts });
  } catch (err) {
    console.error("Get posts error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get posts by user route
app.get("/user/posts", verifyToken, async (req, res) => {
  try {
    const posts = await Post.find({ user: req.user.id }).populate(
      "user",
      "username"
    );
    res.status(200).json({ posts });
  } catch (err) {
    console.error("Get user posts error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get post by ID route
app.get("/post/:id", verifyToken, async (req, res) => {
  try {
    const post = await Post.findOne({
      _id: req.params.id,
      user: req.user.id,
    })
      .populate("user", "username email")
      .populate({
        path: "comments",
        populate: {
          path: "user",
          select: "username",
        },
      });
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    res.status(200).json({ post });
  } catch (err) {
    console.error("Get post by ID error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Update post by ID route
app.put(
  "/post/:id",
  verifyToken,
  upload.single("image"),
  [
    body("title").optional().not().isEmpty().withMessage("Title is required"),
    body("description")
      .optional()
      .not()
      .isEmpty()
      .withMessage("Description is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description } = req.body;

    try {
      const updateData = { title, description };
      if (req.file) {
        updateData.image = req.file.path;
      }

      const post = await Post.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id },
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      res.status(200).json({ post });
    } catch (err) {
      console.error("Update post error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Add like to post
app.post("/post/:id/like", verifyToken, async (req, res) => {
  try {
    const postId = req.params.id;
    const existingLike = await Like.findOne({
      post: postId,
      user: req.user.id,
    });
    if (existingLike) {
      return res.status(400).json({ message: "Already liked" });
    }

    const like = new Like({ post: postId, user: req.user.id });
    await like.save();

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $inc: { likesCount: 1 } },
      { new: true }
    ).populate("user", "username");

    io.emit("postUpdated", { post: updatedPost });
    io.emit("likesCountUpdated", {
      postId,
      likesCount: updatedPost.likesCount,
    });

    res.status(200).json({ message: "Post liked", post: updatedPost });
  } catch (err) {
    console.error("Like post error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Remove like from post
app.delete("/post/:id/like", verifyToken, async (req, res) => {
  try {
    const postId = req.params.id;
    const like = await Like.findOneAndDelete({
      post: postId,
      user: req.user.id,
    });
    if (!like) {
      return res.status(400).json({ message: "Not liked yet" });
    }

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $inc: { likesCount: -1 } },
      { new: true }
    ).populate("user", "username");

    io.emit("postUpdated", { post: updatedPost });
    io.emit("likesCountUpdated", {
      postId,
      likesCount: updatedPost.likesCount,
    });

    res.status(200).json({ message: "Post unliked", post: updatedPost });
  } catch (err) {
    console.error("Unlike post error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get comments for a post
app.get("/post/:id/comments", async (req, res) => {
  try {
    const comments = await Comment.find({ post: req.params.id })
      .populate("user", "username")
      .populate({
        path: "replies",
        populate: {
          path: "user",
          select: "username",
        },
      });

    res.status(200).json({ comments });
  } catch (err) {
    console.error("Get comments error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Add a comment to a post
app.post("/post/:id/comment", verifyToken, async (req, res) => {
  const { text } = req.body;
  const postId = req.params.id;

  if (!text) {
    return res.status(400).json({ message: "Text is required" });
  }

  try {
    const comment = new Comment({
      post: postId,
      user: req.user.id,
      text,
    });

    await comment.save();

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $push: { comments: comment._id } },
      { new: true }
    )
      .populate({
        path: "comments",
        populate: {
          path: "user",
          select: "username",
        },
      })
      .populate("user", "username");

    io.emit("postUpdated", { post: updatedPost });

    res.status(201).json({ comment });
  } catch (err) {
    console.error("Add comment error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Add a reply to a comment
app.post(
  "/post/:postId/comment/:commentId/reply",
  verifyToken,
  async (req, res) => {
    const { text } = req.body;
    const { postId, commentId } = req.params;

    if (!text) {
      return res.status(400).json({ message: "Text is required" });
    }

    try {
      const reply = new Reply({
        post: postId,
        comment: commentId,
        user: req.user.id,
        text,
      });

      await reply.save();

      const updatedComment = await Comment.findByIdAndUpdate(
        commentId,
        { $push: { replies: reply._id } },
        { new: true }
      )
        .populate("user", "username")
        .populate({
          path: "replies",
          populate: {
            path: "user",
            select: "username",
          },
        });

      io.emit("commentUpdated", { comment: updatedComment });

      res.status(201).json({ reply });
    } catch (err) {
      console.error("Reply to comment error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get replies for a comment
app.get("/comment/:id/replies", async (req, res) => {
  try {
    const replies = await Reply.find({ comment: req.params.id })
      .populate("user", "username")
      .populate({
        path: "replies",
        populate: {
          path: "user",
          select: "username",
        },
      });

    res.status(200).json({ replies });
  } catch (err) {
    console.error("Get replies error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete a comment
app.delete('/post/:postId/comment/:commentId', verifyToken, async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const commentIndex = post.comments.findIndex(comment => comment._id.toString() === commentId);
    if (commentIndex === -1) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    post.comments.splice(commentIndex, 1);
    await post.save();

    io.emit('commentDeleted', { postId, commentId });

    res.status(200).json({ message: 'Comment deleted', post });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// Delete a reply
app.delete('/comment/:commentId/reply/:replyId', verifyToken, async (req, res) => {
  try {
    const { commentId, replyId } = req.params;

    const post = await Post.findOne({ 'comments._id': commentId });
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const comment = post.comments.id(commentId);
    const replyIndex = comment.replies.findIndex(reply => reply._id.toString() === replyId);
    if (replyIndex === -1) {
      return res.status(404).json({ message: 'Reply not found' });
    }

    comment.replies.splice(replyIndex, 1);
    await post.save();

    io.emit('replyDeleted', { commentId, replyId });

    res.status(200).json({ message: 'Reply deleted', post });
  } catch (err) {
    console.error('Delete reply error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});



// Delete post by ID route
app.delete("/post/:id", verifyToken, async (req, res) => {
  try {
    const post = await Post.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    res.status(200).json({ message: "Post deleted" });
  } catch (err) {
    console.error("Delete post error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Logout route
app.post("/logout", verifyToken, (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  tokenBlacklist.push(token);
  res.status(200).json({ message: "Logout successful" });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
