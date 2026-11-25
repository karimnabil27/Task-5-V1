import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

const scrypt = promisify(deriveKey);
const passwordFormat = 'scrypt-v1';
const saltLength = 16;
const keyLength = 32;
const scryptOptions = {
  cost: 2 ** 15,
  blockSize: 8,
  parallelization: 3,
  maxmem: 64 * 1024 * 1024
};

async function hashPassword(password) {
  const salt = randomBytes(saltLength);
  const key = await scrypt(password, salt, keyLength, scryptOptions);
  return [salt.toString('hex'), key.toString('hex')].join(':');
}

const instructorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, select: false },
    passwordFormat: { type: String, select: false },
    department: { type: String },
    role: { type: String, default: 'instructor' },
    apiKey: { type: String, select: false },
    privateEmail: { type: String, select: false },
    privatePhone: { type: String, select: false }
  },
  { timestamps: true }
);

instructorSchema.pre('save', async function () {
  // Remember the generated digest if a failed save is retried on this document.
  if (this.isModified('password') && this.password !== this.$locals.passwordDigest) {
    this.$locals.passwordDigest = await hashPassword(this.password);
    this.password = this.$locals.passwordDigest;
    this.passwordFormat = passwordFormat;
  }
});

instructorSchema.methods.comparePassword = async function (password) {
  if (this.passwordFormat !== passwordFormat || !this.password) return false;

  const [saltHex, keyHex] = this.password.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(keyHex ?? '', 'hex');
  if (salt.length !== saltLength || expectedKey.length !== keyLength) return false;

  const key = await scrypt(password, salt, keyLength, scryptOptions);
  return timingSafeEqual(key, expectedKey);
};

instructorSchema.statics.migrateLegacyPasswords = async function () {
  const legacyVersion = { $exists: false };
  const instructors = this.collection.find(
    { passwordFormat: legacyVersion, password: { $type: 'string' } },
    { projection: { password: 1 } }
  );
  for await (const { _id, password } of instructors) {
    const digest = await hashPassword(password);
    // Keep a credential change made by another process after the cursor read.
    await this.collection.updateOne(
      { _id, password, passwordFormat: legacyVersion },
      { $set: { password: digest, passwordFormat } }
    );
  }
};

export const Instructor = mongoose.model('Instructor', instructorSchema);
