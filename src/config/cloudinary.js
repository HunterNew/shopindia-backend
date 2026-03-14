const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload a buffer to Cloudinary
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} folder
 */
const uploadBuffer = (buffer, mimetype, folder = 'ecommerce') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, transformation: [{ width: 900, height: 900, crop: 'limit', quality: 'auto' }] },
      (error, result) => { if (error) reject(error); else resolve(result); }
    );
    stream.end(buffer);
  });
};

const deleteImage = (publicId) => cloudinary.uploader.destroy(publicId);

module.exports = { cloudinary, uploadBuffer, deleteImage };
