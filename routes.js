const express = require('express');
const router = express.Router();
const db = require('./db');

/* ---------- Helpers ---------- */
async function getOrCreateStudent(name) {
  const [rows] = await db.query('SELECT id FROM students WHERE name = ?', [name]);
  if (rows.length) return rows[0].id;
  const [res] = await db.query('INSERT INTO students (name) VALUES (?)', [name]);
  return res.insertId;
}

// Check overlap for teacher or students
async function hasOverlap(teacher_id, student_ids, day, start, end, excludeId = null) {
  // Teacher check
  let sql = `
    SELECT id FROM classes
    WHERE teacher_id = ? AND day = ?
      AND NOT (end_time <= ? OR start_time >= ?)
  `;
  const params = [teacher_id, day, start, end];
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  const [teacherClash] = await db.query(sql, params);
  if (teacherClash.length) return true;

  // Student check
  for (const sid of student_ids) {
    let sSql = `
      SELECT c.id FROM classes c
      JOIN class_students cs ON c.id = cs.class_id
      WHERE cs.student_id = ? AND c.day = ?
        AND NOT (c.end_time <= ? OR c.start_time >= ?)
    `;
    const sParams = [sid, day, start, end];
    if (excludeId) { sSql += ' AND c.id != ?'; sParams.push(excludeId); }
    const [sRows] = await db.query(sSql, sParams);
    if (sRows.length) return true;
  }
  return false;
}

/* ---------- Teachers ---------- */
router.get('/teachers', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM teachers ORDER BY name');
  res.json(rows);
});

router.post('/teachers', async (req, res) => {
  const { name } = req.body;
  const [r] = await db.query('INSERT INTO teachers (name) VALUES (?)', [name]);
  res.json({ id: r.insertId, name });
});

router.get('/teachers/:id/timetable', async (req, res) => {
  const tid = req.params.id;
  const [rows] = await db.query(
    `SELECT c.id, t.name AS teacher, c.subject, c.day,
            TIME_FORMAT(c.start_time,"%H:%i") AS start_time,
            TIME_FORMAT(c.end_time,"%H:%i") AS end_time,
            GROUP_CONCAT(s.name SEPARATOR ', ') AS students
     FROM classes c
     JOIN teachers t ON c.teacher_id=t.id
     LEFT JOIN class_students cs ON c.id=cs.class_id
     LEFT JOIN students s ON cs.student_id=s.id
     WHERE c.teacher_id=? 
     GROUP BY c.id
     ORDER BY FIELD(c.day,"Monday","Tuesday","Wednesday","Thursday","Friday"), c.start_time`,
    [tid]
  );
  res.json(rows);
});

/* ---------- Students ---------- */
router.get('/students', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM students ORDER BY name');
  res.json(rows);
});

router.post('/students', async (req, res) => {
  const { name } = req.body;
  const [r] = await db.query('INSERT INTO students (name) VALUES (?)', [name]);
  res.json({ id: r.insertId, name });
});

router.get('/students/:id/timetable', async (req, res) => {
  const sid = req.params.id;
  const [rows] = await db.query(
    `SELECT c.id, t.name AS teacher, c.subject, c.day,
            TIME_FORMAT(c.start_time,"%H:%i") AS start_time,
            TIME_FORMAT(c.end_time,"%H:%i") AS end_time
     FROM classes c
     JOIN teachers t ON c.teacher_id=t.id
     JOIN class_students cs ON c.id=cs.class_id
     WHERE cs.student_id=?
     ORDER BY FIELD(c.day,"Monday","Tuesday","Wednesday","Thursday","Friday"), c.start_time`,
    [sid]
  );
  res.json(rows);
});

/* ---------- Classes ---------- */
router.post('/classes', async (req, res) => {
  let { teacher_id, students, subject, day, start_time, end_time } = req.body;
  if (!Array.isArray(students)) return res.status(400).json({ error: 'students must be array' });

  const student_ids = [];
  for (const s of students) {
    const id = await getOrCreateStudent(s.trim());
    student_ids.push(id);
  }

  if (await hasOverlap(teacher_id, student_ids, day, start_time, end_time)) {
    return res.status(409).json({ error: 'clash_detected' });
  }

  const [r] = await db.query(
    'INSERT INTO classes (teacher_id, subject, day, start_time, end_time) VALUES (?,?,?,?,?)',
    [teacher_id, subject, day, start_time, end_time]
  );
  const classId = r.insertId;

  for (const sid of student_ids) {
    await db.query('INSERT INTO class_students (class_id, student_id) VALUES (?,?)', [classId, sid]);
  }
  res.json({ id: classId });
});

router.put('/classes/:id', async (req, res) => {
  const id = req.params.id;
  let { teacher_id, students, subject, day, start_time, end_time } = req.body;
  if (!Array.isArray(students)) return res.status(400).json({ error: 'students must be array' });

  const student_ids = [];
  for (const s of students) {
    const sid = await getOrCreateStudent(s.trim());
    student_ids.push(sid);
  }

  if (await hasOverlap(teacher_id, student_ids, day, start_time, end_time, id)) {
    return res.status(409).json({ error: 'clash_detected' });
  }

  await db.query('UPDATE classes SET teacher_id=?, subject=?, day=?, start_time=?, end_time=? WHERE id=?',
    [teacher_id, subject, day, start_time, end_time, id]);
  await db.query('DELETE FROM class_students WHERE class_id=?', [id]);
  for (const sid of student_ids) {
    await db.query('INSERT INTO class_students (class_id, student_id) VALUES (?,?)', [id, sid]);
  }
  res.json({ success: true });
});

router.delete('/classes/:id', async (req, res) => {
  await db.query('DELETE FROM classes WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
