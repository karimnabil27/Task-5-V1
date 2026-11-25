import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../src/app.js';
import { Instructor } from '../src/models/Instructor.js';

const credentials = { username: 'avery.reed', password: 'Fixture passphrase 17!' };
const profile = {
  name: 'Avery (Guest). Reed',
  department: 'Physics',
  role: 'instructor'
};
const privateFields = {
  apiKey: 'fixture-key',
  privateEmail: 'avery@example.test',
  privatePhone: '555-0100'
};

let mongo;
let avery;
let morgan;
let alex;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  [avery, morgan, alex] = await Instructor.create([
    { ...credentials, ...profile, ...privateFields },
    {
      name: 'Morgan Reed', username: 'morgan.reed', password: 'Fixture passphrase 18!',
      department: 'Biology', role: 'superadmin'
    },
    {
      name: 'Alex Rivera', username: 'alex.rivera', password: 'Fixture passphrase 19!',
      department: 'Physics', role: 'instructor'
    }
  ]);
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

function publicEntry(instructor) {
  const { _id, name, department, role } = instructor;
  return { _id: _id.toString(), name, department, role };
}

test('stores a password hash and omits private fields from default reads', async () => {
  const stored = await Instructor.findById(avery.id).select('+password').lean();
  expect(stored.password).toEqual(expect.any(String));
  expect(stored.password).not.toBe(credentials.password);

  const defaultRead = await Instructor.findById(avery.id).lean();
  for (const field of ['password', ...Object.keys(privateFields)]) {
    expect(defaultRead).not.toHaveProperty(field);
  }
});

test('signs in an instructor and returns only the profile fields', async () => {
  const response = await request(app).post('/api/instructors/login').send(credentials);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    instructor: { id: avery.id, username: credentials.username, ...profile }
  });
});

test('rejects incorrect credentials', async () => {
  const response = await request(app).post('/api/instructors/login').send({
    ...credentials,
    password: 'Wrong fixture passphrase'
  });
  expect(response.status).toBe(401);
  expect(response.body).toEqual({ message: 'Invalid credentials' });
});

test.each([
  { username: credentials.username },
  { ...credentials, username: 42 },
  { ...credentials, password: { text: credentials.password } }
])('rejects malformed login input', async (body) => {
  const response = await request(app).post('/api/instructors/login').send(body);
  expect(response.status).toBe(400);
  expect(response.body).not.toHaveProperty('instructor');
});

test('returns only the public fields in the directory and unfiltered search', async () => {
  const directory = await request(app).get('/api/instructors');
  expect(directory.status).toBe(200);
  expect(directory.body).toEqual({ instructors: [alex, avery, morgan].map(publicEntry) });

  const search = await request(app).get('/api/instructors/search');
  expect(search.status).toBe(200);
  expect(search.body).toEqual({
    count: 3,
    instructors: expect.arrayContaining([alex, avery, morgan].map(publicEntry))
  });
  expect(search.body.instructors).toHaveLength(3);
});

test.each([
  [{ name: '(gUESt).' }, () => [avery]],
  [{ name: 'reed', department: 'Biology', role: 'superadmin' }, () => [morgan]],
  [{ department: 'Bio' }, () => []],
  [{ role: 'Instructor' }, () => []]
])('searches public fields with literal matching', async (query, matches) => {
  const response = await request(app).get('/api/instructors/search').query(query);
  const expected = matches().map(publicEntry);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ count: expected.length, instructors: expected });
});

test.each([
  'faculty=Physics',
  'name%5Btext%5D=Avery',
  'name=Avery&name=Morgan'
])('rejects unsupported search fields and non-scalar values', async (query) => {
  const response = await request(app).get('/api/instructors/search').query(query);
  expect(response.status).toBe(400);
  expect(response.body).not.toHaveProperty('instructors');
});

test('returns an empty result for prohibited search keys without querying the directory', async () => {
  const find = jest.spyOn(Instructor, 'find');
  try {
    const response = await request(app).get('/api/instructors/search').query({
      'staff.name': 'Avery'
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 0, instructors: [] });
    expect(find).not.toHaveBeenCalled();
  } finally {
    find.mockRestore();
  }
});

test('migrates legacy passwords in place and can be run again', async () => {
  const legacy = { username: 'legacy.user', password: 'Legacy fixture passphrase!' };
  const existing = await Instructor.findById(avery.id).select('+password').lean();
  const { insertedId } = await Instructor.collection.insertOne({ name: 'Legacy User', ...legacy });

  try {
    await Instructor.migrateLegacyPasswords();
    const migrated = await Instructor.findById(insertedId).select('+password').lean();
    expect(migrated.password).toEqual(expect.any(String));
    expect(migrated.password).not.toBe(legacy.password);

    await Instructor.migrateLegacyPasswords();
    const rerun = await Instructor.findById(insertedId).select('+password').lean();
    expect(rerun.password).toBe(migrated.password);
    const stillExisting = await Instructor.findById(avery.id).select('+password').lean();
    expect(stillExisting.password).toBe(existing.password);

    const response = await request(app).post('/api/instructors/login').send(legacy);
    expect(response.status).toBe(200);
    expect(response.body.instructor.id).toBe(insertedId.toString());
  } finally {
    await Instructor.collection.deleteOne({ _id: insertedId });
  }
});
