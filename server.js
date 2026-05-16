const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = {
      users: [], pendingRegistrations: {}, licenses: {}, passports: {},
      cards: {}, cars: [], bookings: [], trips: [], sessions: {}
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function seedCarsIfEmpty() {
  const db = loadDB();
  if (db.cars.length > 0) return;
  const center = { lat: 55.7558, lon: 37.6173 };
  const models = [
    { brand: 'Kia', model: 'Rio', rate: 8, photo: 'https://images.unsplash.com/photo-1549921296-3a2bbd95c5cd?w=600' },
    { brand: 'Hyundai', model: 'Solaris', rate: 8, photo: 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=600' },
    { brand: 'Volkswagen', model: 'Polo', rate: 9, photo: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=600' },
    { brand: 'Renault', model: 'Logan', rate: 7, photo: 'https://images.unsplash.com/photo-1542362567-b07e54358753?w=600' },
    { brand: 'Skoda', model: 'Rapid', rate: 9, photo: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600' },
    { brand: 'Toyota', model: 'Camry', rate: 14, photo: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=600' },
    { brand: 'BMW', model: '3 Series', rate: 18, photo: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=600' },
    { brand: 'Mercedes-Benz', model: 'C-Class', rate: 19, photo: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=600' },
    { brand: 'Lada', model: 'Vesta', rate: 6, photo: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600' },
    { brand: 'Nissan', model: 'Qashqai', rate: 11, photo: 'https://images.unsplash.com/photo-1568844293986-8d0400bd4745?w=600' }
  ];
  const cars = [];
  for (let i = 0; i < 12; i++) {
    const m = models[i % models.length];
    cars.push({
      id: crypto.randomUUID(), brand: m.brand, model: m.model, plate: generatePlate(),
      lat: center.lat + (Math.random() - 0.5) * 0.04,
      lon: center.lon + (Math.random() - 0.5) * 0.06,
      fuel: 40 + Math.floor(Math.random() * 60),
      ratePerMin: m.rate, deposit: 150, status: 'available', photo: m.photo
    });
  }
  db.cars = cars;
  saveDB(db);
}

function generatePlate() {
  const letters = 'АВЕКМНОРСТУХ';
  const L = () => letters[Math.floor(Math.random() * letters.length)];
  const D = () => Math.floor(Math.random() * 10);
  return `${L()}${D()}${D()}${D()}${L()}${L()}77`;
}

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function auth(req, res, next) {
  const token = req.cookies.sid;
  const db = loadDB();
  if (!token || !db.sessions[token]) return res.status(401).json({ error: 'unauthorized' });
  const userId = db.sessions[token];
  const user = db.users.find(u => u.id === userId);
  if (user && user.blocked) {
    delete db.sessions[token];
    saveDB(db);
    return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
  }
  req.userId = userId;
  req.db = db;
  next();
}

function genSmsCode() { return Math.floor(1000 + Math.random() * 9000).toString(); }
function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }
function recomputeUserStatus(db, user) {
  const lic = db.licenses[user.id];
  const pass = db.passports[user.id];
  if (!lic || lic.status !== 'approved') { user.status = 'awaiting_license'; return; }
  if (!pass || pass.status !== 'approved') { user.status = 'awaiting_passport'; return; }
  user.status = 'active';
}
function publicUser(u, db) {
  const license = db.licenses[u.id];
  const passport = db.passports[u.id];
  const cards = db.cards[u.id] || [];
  return {
    id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, status: u.status,
    license: license ? { ...license, status: license.status } : null,
    passport: passport || null,
    cards: cards.map(c => ({ id: c.id, maskedPan: c.maskedPan, brand: c.brand, expiry: c.expiry }))
  };
}

app.post('/api/register/start', (req, res) => {
  const db = loadDB();
  const { fullName, email, phone, password } = req.body || {};
  if (!fullName || !email || !phone || !password) return res.status(400).json({ error: 'Все поля обязательны' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
  const phoneNorm = normalizePhone(phone);
  if (phoneNorm.length < 10) return res.status(400).json({ error: 'Некорректный номер телефона' });
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'E-mail уже зарегистрирован' });
  if (db.users.some(u => normalizePhone(u.phone) === phoneNorm)) return res.status(409).json({ error: 'Телефон уже зарегистрирован' });
  const code = genSmsCode();
  db.pendingRegistrations[phoneNorm] = {
    code, attempts: 0, expiresAt: Date.now() + 2 * 60 * 1000,
    payload: { fullName, email, phone, passwordHash: bcrypt.hashSync(password, 8) }
  };
  saveDB(db);
  console.log(`[SMS] Код для ${phone}: ${code}`);
  res.json({ ok: true, demoCode: code, phone });
});

app.post('/api/register/resend', (req, res) => {
  const db = loadDB();
  const phoneNorm = normalizePhone(req.body && req.body.phone);
  const pending = db.pendingRegistrations[phoneNorm];
  if (!pending) return res.status(404).json({ error: 'Заявка на регистрацию не найдена' });
  if (pending.blockedUntil && pending.blockedUntil > Date.now()) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
  pending.code = genSmsCode();
  pending.attempts = 0;
  pending.expiresAt = Date.now() + 2 * 60 * 1000;
  saveDB(db);
  console.log(`[SMS resend] Код для ${phoneNorm}: ${pending.code}`);
  res.json({ ok: true, demoCode: pending.code });
});

app.post('/api/register/verify', (req, res) => {
  const db = loadDB();
  const { phone, code } = req.body || {};
  const phoneNorm = normalizePhone(phone);
  const pending = db.pendingRegistrations[phoneNorm];
  if (!pending) return res.status(404).json({ error: 'Заявка не найдена' });
  if (pending.blockedUntil && pending.blockedUntil > Date.now()) return res.status(429).json({ error: 'Повторная отправка заблокирована на 5 минут' });
  if (Date.now() > pending.expiresAt) return res.status(410).json({ error: 'Срок действия кода истёк' });
  if (String(code) !== pending.code) {
    pending.attempts = (pending.attempts || 0) + 1;
    if (pending.attempts >= 3) {
      pending.blockedUntil = Date.now() + 5 * 60 * 1000;
      saveDB(db);
      return res.status(429).json({ error: 'Превышено число попыток, блокировка на 5 минут' });
    }
    saveDB(db);
    return res.status(400).json({ error: 'Неверный код', attemptsLeft: 3 - pending.attempts });
  }
  const user = {
    id: crypto.randomUUID(), fullName: pending.payload.fullName, email: pending.payload.email,
    phone: pending.payload.phone, passwordHash: pending.payload.passwordHash,
    status: 'awaiting_license', createdAt: new Date().toISOString()
  };
  db.users.push(user);
  delete db.pendingRegistrations[phoneNorm];
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.id;
  saveDB(db);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: publicUser(user, db) });
});

app.post('/api/login', (req, res) => {
  const db = loadDB();
  const { email, password } = req.body || {};
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) return res.status(401).json({ error: 'Неверный e-mail или пароль' });
  if (user.blocked) return res.status(403).json({ error: 'Аккаунт заблокирован администратором' });
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.id;
  saveDB(db);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: publicUser(user, db) });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies.sid;
  if (token) { const db = loadDB(); delete db.sessions[token]; saveDB(db); }
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const user = req.db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ user: publicUser(user, req.db) });
});

app.post('/api/license/upload', auth, upload.fields([
  { name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }
]), (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'not found' });
  const front = req.files && req.files.front && req.files.front[0];
  const back = req.files && req.files.back && req.files.back[0];
  if (!front || !back) return res.status(400).json({ error: 'Нужны обе стороны ВУ' });
  const issueYear = 2018 + Math.floor(Math.random() * 6);
  const ocr = {
    number: `${77 + Math.floor(Math.random() * 22)} ${String(Math.floor(Math.random() * 90 + 10))} ${String(Math.floor(Math.random() * 900000 + 100000))}`,
    fullName: user.fullName, category: 'B',
    issueDate: `${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}.${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}.${issueYear}`,
    expireDate: `${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}.${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}.${issueYear + 10}`
  };
  db.licenses[user.id] = {
    ...ocr,
    frontPhoto: '/uploads/' + path.basename(front.path),
    backPhoto: '/uploads/' + path.basename(back.path),
    status: 'pending', submittedAt: new Date().toISOString(), uploadedAt: new Date().toISOString()
  };
  saveDB(db);
  res.json({ ok: true, ocr });
});

app.post('/api/license/confirm', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.userId);
  const license = db.licenses[user.id];
  if (!license) return res.status(404).json({ error: 'ВУ не загружено' });
  const { number, fullName, category, issueDate, expireDate } = req.body || {};
  Object.assign(license, { number, fullName, category, issueDate, expireDate });
  saveDB(db);
  res.json({ ok: true, license });
});

app.post('/api/passport/upload', auth, upload.single('photo'), (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!req.file) return res.status(400).json({ error: 'Нужно фото паспорта' });
  const series = String(1000 + Math.floor(Math.random() * 9000));
  const number = String(100000 + Math.floor(Math.random() * 900000));
  db.passports[user.id] = {
    series, number, fullName: user.fullName, birthDate: '01.01.1995',
    photo: '/uploads/' + path.basename(req.file.path),
    status: 'pending', submittedAt: new Date().toISOString(), uploadedAt: new Date().toISOString()
  };
  saveDB(db);
  res.json({ ok: true, passport: db.passports[user.id] });
});

app.get('/api/cards', auth, (req, res) => {
  const cards = (req.db.cards[req.userId] || []).map(c => ({ id: c.id, maskedPan: c.maskedPan, brand: c.brand, expiry: c.expiry }));
  res.json({ cards });
});

app.post('/api/cards', auth, (req, res) => {
  const db = loadDB();
  const { number, expiry, cvc, holder } = req.body || {};
  const digits = (number || '').replace(/\s/g, '');
  if (!/^\d{16}$/.test(digits)) return res.status(400).json({ error: 'Номер карты должен содержать 16 цифр' });
  if (!/^\d{2}\/\d{2}$/.test(expiry || '')) return res.status(400).json({ error: 'Срок: ММ/ГГ' });
  if (!/^\d{3}$/.test(cvc || '')) return res.status(400).json({ error: 'CVC: 3 цифры' });
  const brand = digits.startsWith('4') ? 'VISA' : digits.startsWith('5') ? 'MasterCard' : digits.startsWith('2') ? 'МИР' : 'Card';
  const card = { id: crypto.randomUUID(), maskedPan: '•••• •••• •••• ' + digits.slice(-4), brand, expiry, holder: holder || '' };
  if (!db.cards[req.userId]) db.cards[req.userId] = [];
  db.cards[req.userId].push(card);
  saveDB(db);
  res.json({ ok: true, card });
});

app.delete('/api/cards/:id', auth, (req, res) => {
  const db = loadDB();
  const list = db.cards[req.userId] || [];
  db.cards[req.userId] = list.filter(c => c.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/cars', auth, (req, res) => {
  const db = loadDB();
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  let radius = parseFloat(req.query.radius) || 3;
  let cars = db.cars.filter(c => c.status === 'available');
  if (isFinite(lat) && isFinite(lon)) {
    const nearby = cars.filter(c => haversine(lat, lon, c.lat, c.lon) <= radius);
    if (nearby.length === 0) {
      const newCars = [];
      const models = [
        { brand: 'Kia', model: 'Rio', rate: 8 }, { brand: 'Hyundai', model: 'Solaris', rate: 8 },
        { brand: 'Volkswagen', model: 'Polo', rate: 9 }, { brand: 'Skoda', model: 'Rapid', rate: 9 },
        { brand: 'Toyota', model: 'Camry', rate: 14 }, { brand: 'BMW', model: '3 Series', rate: 18 }
      ];
      for (let i = 0; i < 8; i++) {
        const m = models[i % models.length];
        const angle = Math.random() * 2 * Math.PI;
        const r = (Math.random() * 0.8 + 0.1) * (radius / 111);
        newCars.push({
          id: crypto.randomUUID(), brand: m.brand, model: m.model, plate: generatePlate(),
          lat: lat + Math.cos(angle) * r,
          lon: lon + Math.sin(angle) * r / Math.cos(lat * Math.PI / 180),
          fuel: 40 + Math.floor(Math.random() * 60),
          ratePerMin: m.rate, deposit: 150, status: 'available', photo: null
        });
      }
      db.cars.push(...newCars);
      saveDB(db);
      cars = db.cars.filter(c => c.status === 'available');
    }
    cars = cars
      .map(c => ({ ...c, distance: haversine(lat, lon, c.lat, c.lon) }))
      .filter(c => c.distance <= radius * 3)
      .sort((a, b) => a.distance - b.distance);
    const NEAR_KM = 0.05;
    const hasNear = cars.some(c => c.distance <= NEAR_KM);
    if (!hasNear && cars.length > 0) {
      const closest = cars[0];
      const real = db.cars.find(c => c.id === closest.id);
      if (real) {
        const offsetMeters = 20 + Math.random() * 10;
        const angle = Math.random() * 2 * Math.PI;
        const dLat = (offsetMeters / 1000) / 111 * Math.cos(angle);
        const dLon = (offsetMeters / 1000) / 111 / Math.cos(lat * Math.PI / 180) * Math.sin(angle);
        real.lat = lat + dLat;
        real.lon = lon + dLon;
        saveDB(db);
        closest.lat = real.lat;
        closest.lon = real.lon;
        closest.distance = haversine(lat, lon, real.lat, real.lon);
        cars.sort((a, b) => a.distance - b.distance);
      }
    }
  }
  res.json({ cars });
});

app.get('/api/cars/:id', auth, (req, res) => {
  const car = req.db.cars.find(c => c.id === req.params.id);
  if (!car) return res.status(404).json({ error: 'not found' });
  res.json({ car });
});

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

app.post('/api/bookings', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.userId);
  if (user.status !== 'active') return res.status(403).json({ error: 'Аккаунт не активирован. Дождитесь проверки документов.' });
  if (!db.cards[req.userId] || db.cards[req.userId].length === 0) return res.status(402).json({ error: 'no_card', message: 'Привяжите банковскую карту' });
  const car = db.cars.find(c => c.id === req.body.carId);
  if (!car) return res.status(404).json({ error: 'Авто не найдено' });
  if (car.status !== 'available') return res.status(409).json({ error: 'Авто уже забронировано' });
  const now = Date.now();
  for (const b of db.bookings) {
    if (b.status === 'active' && new Date(b.expiresAt).getTime() < now) {
      b.status = 'expired';
      const oc = db.cars.find(c => c.id === b.carId);
      if (oc) oc.status = 'available';
    }
  }
  const booking = {
    id: crypto.randomUUID(), userId: req.userId, carId: car.id,
    cardId: db.cards[req.userId][0].id, depositHoldId: crypto.randomBytes(6).toString('hex'),
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: 'active'
  };
  db.bookings.push(booking);
  car.status = 'booked';
  saveDB(db);
  res.json({ ok: true, booking, car });
});

app.get('/api/bookings/active', auth, (req, res) => {
  const db = loadDB();
  const booking = db.bookings.find(b => b.userId === req.userId && b.status === 'active');
  if (!booking) return res.json({ booking: null });
  if (new Date(booking.expiresAt).getTime() < Date.now()) {
    booking.status = 'expired';
    const car = db.cars.find(c => c.id === booking.carId);
    if (car) car.status = 'available';
    saveDB(db);
    return res.json({ booking: null });
  }
  const car = db.cars.find(c => c.id === booking.carId);
  res.json({ booking, car });
});

app.delete('/api/bookings/:id', auth, (req, res) => {
  const db = loadDB();
  const booking = db.bookings.find(b => b.id === req.params.id && b.userId === req.userId);
  if (!booking) return res.status(404).json({ error: 'not found' });
  booking.status = 'cancelled';
  const car = db.cars.find(c => c.id === booking.carId);
  if (car) car.status = 'available';
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/trips/start', auth, upload.array('photos', 8), (req, res) => {
  const db = loadDB();
  const bookingId = req.body.bookingId;
  const lat = parseFloat(req.body.lat);
  const lon = parseFloat(req.body.lon);
  let checklist = {};
  try { checklist = req.body.checklist ? JSON.parse(req.body.checklist) : {}; } catch (_) {}
  const photos = (req.files || []).map(f => '/uploads/' + path.basename(f.path));
  if (photos.length < 4) return res.status(400).json({ error: 'Нужно загрузить минимум 4 фото авто (со всех сторон)' });
  const booking = db.bookings.find(b => b.id === bookingId && b.userId === req.userId);
  if (!booking || booking.status !== 'active') return res.status(404).json({ error: 'Бронь не найдена' });
  const car = db.cars.find(c => c.id === booking.carId);
  if (isFinite(lat) && isFinite(lon)) {
    const dist = haversine(lat, lon, car.lat, car.lon) * 1000;
    if (dist > 50) return res.status(400).json({ error: `Вы слишком далеко от авто (${Math.round(dist)} м). Подойдите ближе 50 м.` });
  }
  const trip = {
    id: crypto.randomUUID(), bookingId: booking.id, userId: req.userId, carId: car.id,
    startedAt: new Date().toISOString(), ratePerMin: car.ratePerMin,
    checklist, startPhotos: photos, status: 'active'
  };
  booking.status = 'in_trip';
  car.status = 'in_trip';
  db.trips.push(trip);
  saveDB(db);
  res.json({ ok: true, trip, car });
});

app.get('/api/trips/active', auth, (req, res) => {
  const db = loadDB();
  const trip = db.trips.find(t => t.userId === req.userId && t.status === 'active');
  if (!trip) return res.json({ trip: null });
  const car = db.cars.find(c => c.id === trip.carId);
  res.json({ trip, car });
});

app.post('/api/trips/:id/finish', auth, upload.array('photos', 8), (req, res) => {
  const db = loadDB();
  const trip = db.trips.find(t => t.id === req.params.id && t.userId === req.userId);
  if (!trip || trip.status !== 'active') return res.status(404).json({ error: 'Поездка не найдена' });
  const lat = parseFloat(req.body.lat);
  const lon = parseFloat(req.body.lon);
  const distance = parseFloat(req.body.distance);
  const endPhotos = (req.files || []).map(f => '/uploads/' + path.basename(f.path));
  if (endPhotos.length < 4) return res.status(400).json({ error: 'Нужно загрузить минимум 4 фото авто перед завершением' });
  trip.endPhotos = endPhotos;
  const car = db.cars.find(c => c.id === trip.carId);
  const finishedAt = new Date();
  const startedAt = new Date(trip.startedAt);
  const minutes = Math.max(1, Math.ceil((finishedAt - startedAt) / 60000));
  const cost = minutes * trip.ratePerMin;
  trip.finishedAt = finishedAt.toISOString();
  trip.minutes = minutes;
  trip.distanceKm = Number(distance) || +(Math.random() * 5 + 1).toFixed(1);
  trip.cost = cost;
  trip.status = 'finished';
  trip.paymentStatus = 'paid';
  if (car) {
    if (isFinite(lat) && isFinite(lon)) { car.lat = lat; car.lon = lon; }
    car.status = 'available';
    car.fuel = Math.max(5, car.fuel - Math.ceil(trip.distanceKm * 2));
  }
  const booking = db.bookings.find(b => b.id === trip.bookingId);
  if (booking) booking.status = 'finished';
  saveDB(db);
  res.json({ ok: true, trip });
});

app.get('/api/trips', auth, (req, res) => {
  const trips = req.db.trips
    .filter(t => t.userId === req.userId && t.status === 'finished')
    .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))
    .map(t => {
      const car = req.db.cars.find(c => c.id === t.carId);
      return { ...t, car: car ? { brand: car.brand, model: car.model, plate: car.plate } : null };
    });
  res.json({ trips });
});

// ==================== АДМИНКА ====================
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@carshare.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function adminAuth(req, res, next) {
  const token = req.cookies.aid;
  const db = loadDB();
  if (!db.adminSessions) db.adminSessions = {};
  if (!token || !db.adminSessions[token]) return res.status(401).json({ error: 'unauthorized' });
  req.db = db;
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const db = loadDB();
  if (!db.adminSessions) db.adminSessions = {};
  const token = crypto.randomBytes(24).toString('hex');
  db.adminSessions[token] = true;
  saveDB(db);
  res.cookie('aid', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, admin: { email: ADMIN_EMAIL } });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies.aid;
  if (token) { const db = loadDB(); if (db.adminSessions) delete db.adminSessions[token]; saveDB(db); }
  res.clearCookie('aid');
  res.json({ ok: true });
});

app.get('/api/admin/me', adminAuth, (req, res) => { res.json({ admin: { email: ADMIN_EMAIL } }); });

app.get('/api/admin/stats', adminAuth, (req, res) => {
  const db = req.db;
  const finishedTrips = db.trips.filter(t => t.status === 'finished');
  const totalRevenue = finishedTrips.reduce((sum, t) => sum + (t.cost || 0), 0);
  res.json({
    stats: {
      totalUsers: db.users.length,
      blockedUsers: db.users.filter(u => u.blocked).length,
      activeUsers: db.users.filter(u => u.status === 'active' && !u.blocked).length,
      totalCars: db.cars.length,
      availableCars: db.cars.filter(c => c.status === 'available').length,
      inTripCars: db.cars.filter(c => c.status === 'in_trip').length,
      bookedCars: db.cars.filter(c => c.status === 'booked').length,
      activeBookings: db.bookings.filter(b => b.status === 'active').length,
      activeTrips: db.trips.filter(t => t.status === 'active').length,
      totalTrips: finishedTrips.length,
      totalRevenue,
      avgTripCost: finishedTrips.length > 0 ? Math.round(totalRevenue / finishedTrips.length) : 0
    }
  });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  const db = req.db;
  const users = db.users.map(u => ({
    id: u.id, fullName: u.fullName, email: u.email, phone: u.phone,
    status: u.status, blocked: !!u.blocked, createdAt: u.createdAt,
    license: db.licenses[u.id] ? { number: db.licenses[u.id].number, status: db.licenses[u.id].status, expireDate: db.licenses[u.id].expireDate, submittedAt: db.licenses[u.id].submittedAt } : null,
    passport: db.passports[u.id] ? { series: db.passports[u.id].series, number: db.passports[u.id].number, status: db.passports[u.id].status, submittedAt: db.passports[u.id].submittedAt } : null,
    cardsCount: (db.cards[u.id] || []).length,
    tripsCount: db.trips.filter(t => t.userId === u.id && t.status === 'finished').length,
    totalSpent: db.trips.filter(t => t.userId === u.id && t.status === 'finished').reduce((s, t) => s + (t.cost || 0), 0)
  }));
  res.json({ users });
});

app.get('/api/admin/docs', adminAuth, (req, res) => {
  const db = req.db;
  const docs = [];
  db.users.forEach(u => {
    const lic = db.licenses[u.id];
    if (lic) docs.push({ userId: u.id, userName: u.fullName, userEmail: u.email, type: 'license', status: lic.status || 'pending', submittedAt: lic.submittedAt || lic.uploadedAt || null, number: lic.number, frontPhoto: lic.frontPhoto, backPhoto: lic.backPhoto });
    const pass = db.passports[u.id];
    if (pass) docs.push({ userId: u.id, userName: u.fullName, userEmail: u.email, type: 'passport', status: pass.status || 'pending', submittedAt: pass.submittedAt || pass.uploadedAt || null, number: `${pass.series} ${pass.number}`, photo: pass.photo });
  });
  docs.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));
  res.json({ docs });
});

app.post('/api/admin/users/:userId/docs/:docType/approve', adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const store = req.params.docType === 'license' ? db.licenses : db.passports;
  const doc = store[user.id];
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  doc.status = 'approved';
  doc.rejectReason = undefined;
  recomputeUserStatus(db, user);
  saveDB(db);
  res.json({ ok: true, status: user.status });
});

app.post('/api/admin/users/:userId/docs/:docType/reject', adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const store = req.params.docType === 'license' ? db.licenses : db.passports;
  const doc = store[user.id];
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  doc.status = 'rejected';
  doc.rejectReason = (req.body && req.body.reason) || '';
  recomputeUserStatus(db, user);
  saveDB(db);
  res.json({ ok: true, status: user.status });
});

app.post('/api/admin/users/:id/block', adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'not found' });
  user.blocked = true;
  for (const tok of Object.keys(db.sessions)) { if (db.sessions[tok] === user.id) delete db.sessions[tok]; }
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/unblock', adminAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'not found' });
  user.blocked = false;
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.users.splice(idx, 1);
  delete db.licenses[req.params.id];
  delete db.passports[req.params.id];
  delete db.cards[req.params.id];
  for (const tok of Object.keys(db.sessions)) { if (db.sessions[tok] === req.params.id) delete db.sessions[tok]; }
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/admin/cars', adminAuth, (req, res) => { res.json({ cars: req.db.cars }); });

app.post('/api/admin/cars', adminAuth, (req, res) => {
  const db = loadDB();
  const { brand, model, plate, lat, lon, fuel, ratePerMin, photo } = req.body || {};
  if (!brand || !model || !plate) return res.status(400).json({ error: 'Бренд, модель и гос. номер обязательны' });
  const car = {
    id: crypto.randomUUID(), brand, model, plate,
    lat: parseFloat(lat) || 55.7558, lon: parseFloat(lon) || 37.6173,
    fuel: parseInt(fuel) || 100, ratePerMin: parseInt(ratePerMin) || 8,
    deposit: 150, status: 'available', photo: photo || null
  };
  db.cars.push(car);
  saveDB(db);
  res.json({ ok: true, car });
});

app.put('/api/admin/cars/:id', adminAuth, (req, res) => {
  const db = loadDB();
  const car = db.cars.find(c => c.id === req.params.id);
  if (!car) return res.status(404).json({ error: 'not found' });
  const { brand, model, plate, lat, lon, fuel, ratePerMin, status, photo } = req.body || {};
  if (brand !== undefined) car.brand = brand;
  if (model !== undefined) car.model = model;
  if (plate !== undefined) car.plate = plate;
  if (lat !== undefined && lat !== '') car.lat = parseFloat(lat);
  if (lon !== undefined && lon !== '') car.lon = parseFloat(lon);
  if (fuel !== undefined && fuel !== '') car.fuel = parseInt(fuel);
  if (ratePerMin !== undefined && ratePerMin !== '') car.ratePerMin = parseInt(ratePerMin);
  if (status !== undefined) car.status = status;
  if (photo !== undefined) car.photo = photo;
  saveDB(db);
  res.json({ ok: true, car });
});

app.delete('/api/admin/cars/:id', adminAuth, (req, res) => {
  const db = loadDB();
  const idx = db.cars.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.cars.splice(idx, 1);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/admin/trips', adminAuth, (req, res) => {
  const trips = req.db.trips.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).map(t => {
    const user = req.db.users.find(u => u.id === t.userId);
    const car = req.db.cars.find(c => c.id === t.carId);
    return { ...t, user: user ? { fullName: user.fullName, email: user.email } : null, car: car ? { brand: car.brand, model: car.model, plate: car.plate } : null };
  });
  res.json({ trips });
});

app.get('/api/admin/bookings', adminAuth, (req, res) => {
  const bookings = req.db.bookings.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(b => {
    const user = req.db.users.find(u => u.id === b.userId);
    const car = req.db.cars.find(c => c.id === b.carId);
    return { ...b, user: user ? { fullName: user.fullName, email: user.email } : null, car: car ? { brand: car.brand, model: car.model, plate: car.plate } : null };
  });
  res.json({ bookings });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

seedCarsIfEmpty();
app.listen(PORT, () => { console.log(`\nCarShare запущен на http://localhost:${PORT}\n`); });