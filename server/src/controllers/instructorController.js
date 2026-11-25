import mongoSanitize from 'express-mongo-sanitize';
import Joi from 'joi';
import { Instructor } from '../models/Instructor.js';

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
}).required();

const searchSchema = Joi.object({
  name: Joi.string().allow(''),
  department: Joi.string().allow(''),
  role: Joi.string().allow('')
});

const directoryFields = 'name department role';

function publicProfile(instructor) {
  return {
    id: instructor.id,
    name: instructor.name,
    username: instructor.username,
    department: instructor.department,
    role: instructor.role
  };
}

function literalPattern(value) {
  return new RegExp(value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'), 'i');
}

export async function loginInstructor(req, res, next) {
  try {
    const { value, error } = loginSchema.validate(req.body, { convert: false });
    if (error) {
      return res.status(400).json({ message: 'Provide a username and password as strings' });
    }

    const { username, password } = value;
    const instructor = await Instructor.findOne({ username })
      .select(`${directoryFields} username +password +passwordFormat`);
    if (!instructor || !(await instructor.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.json({ instructor: publicProfile(instructor) });
  } catch (err) {
    next(err);
  }
}

export async function getDirectory(req, res, next) {
  try {
    const instructors = await Instructor.find()
      .select(directoryFields)
      .sort({ name: 1 })
      .lean();
    res.json({ instructors });
  } catch (err) {
    next(err);
  }
}

export async function searchInstructors(req, res, next) {
  try {
    // Reject prohibited keys before validation so removing them cannot broaden the search.
    if (mongoSanitize.has(req.query)) {
      return res.json({ count: 0, instructors: [] });
    }

    const { value, error } = searchSchema.validate(req.query, { convert: false });
    if (error) {
      return res.status(400).json({ message: 'Use name, department, or role as string filters' });
    }

    const { name, department, role } = value;
    const filter = {};
    if (name !== undefined) filter.name = name === '' ? '' : literalPattern(name);
    if (department !== undefined) filter.department = department;
    if (role !== undefined) filter.role = role;

    const instructors = await Instructor.find(filter).select(directoryFields).lean();
    return res.json({ count: instructors.length, instructors });
  } catch (err) {
    next(err);
  }
}
