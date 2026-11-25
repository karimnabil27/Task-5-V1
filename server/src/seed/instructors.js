import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Instructor } from '../models/Instructor.js';

dotenv.config();

const instructors = [
  { name: 'Prof. Alice Smith', username: 'prof.smith', department: 'CS' },
  { name: 'Prof. Brian Jones', username: 'prof.jones', department: 'Math' },
  { name: 'Prof. Chen Lee', username: 'prof.lee', department: 'Math' },
  {
    name: 'Portal Administrator',
    username: 'admin',
    department: 'IT',
    role: 'superadmin'
  }
];

async function seed() {
  const password = process.env.INSTRUCTOR_SEED_PASSWORD;
  if (!password) throw new Error('Set INSTRUCTOR_SEED_PASSWORD for the local demo accounts');

  await connectDB();
  try {
    await Instructor.init();
    let created = 0;
    for (const instructor of instructors) {
      if (await Instructor.exists({ username: instructor.username })) continue;
      try {
        await Instructor.create({ ...instructor, password });
        created += 1;
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    console.log('Created %d demo instructor account(s).', created);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((error) => {
  console.error('Instructor seeding failed:', error.message);
  process.exitCode = 1;
});
