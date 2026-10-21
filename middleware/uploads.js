const multer = require("multer");
const path = require("path");
const fs = require("fs");

const avatarDir = path.join(
  __dirname,
  "../uploads/users/avatars"
);

const drawingDir = path.join(
  __dirname,
  "../uploads/drawings"
);

// create folders
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

if (!fs.existsSync(drawingDir)) {
  fs.mkdirSync(drawingDir, { recursive: true });
}

// helper
const isDrawingUpload = (url) => {
  return url.includes("/drawings/upload-background");
};

const isUserAvatarUpload = (url) => {
  return (
    // create user with avatar
    url.includes("/customers/") &&
    url.includes("/users")
  ) || (
    // update avatar
    url.includes("/users/") &&
    url.includes("/avatar")
  );
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const url = req.originalUrl;

    // drawing background
    if (isDrawingUpload(url)) {
      return cb(null, drawingDir);
    }

    // user avatar
    if (isUserAvatarUpload(url)) {
      return cb(null, avatarDir);
    }

    return cb(null, avatarDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);

    const url = req.originalUrl;

    // drawing background
    if (isDrawingUpload(url)) {
      return cb(
        null,
        `drawing-${Date.now()}${ext}`
      );
    }

    // user avatar
    if (isUserAvatarUpload(url)) {
      return cb(
        null,
        `user-${Date.now()}${ext}`
      );
    }

    return cb(
      null,
      `file-${Date.now()}${ext}`
    );
  },
});

const fileFilter = (req, file, cb) => {
  const url = req.originalUrl;

  // drawing upload
  if (isDrawingUpload(url)) {
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/pdf",
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error(
          "Only PNG, JPG, JPEG and PDF allowed"
        ),
        false
      );
    }

    return cb(null, true);
  }

  // avatar upload
  if (isUserAvatarUpload(url)) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(
        new Error("Only images allowed"),
        false
      );
    }

    return cb(null, true);
  }

  cb(null, true);
};

module.exports = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});