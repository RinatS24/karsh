// Инициализация БД тестовыми данными.
// Использование: node seed.js
// ВНИМАНИЕ: перезаписывает data/db.json!

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Хелперы ----------
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const minutesAhead = (m) => new Date(Date.now() + m * 60000).toISOString();
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hash = (p) => bcrypt.hashSync(p, 8);

const PASSWORD = 'qwerty123';

function plate() {
  const letters = 'АВЕКМНОРСТУХ';
  const L = () => letters[randInt(0, letters.length - 1)];
  return `${L()}${randInt(0,9)}${randInt(0,9)}${randInt(0,9)}${L()}${L()}77`;
}

function maskedCard(last4, brand = 'VISA') {
  return { id: uid(), maskedPan: '•••• •••• •••• ' + last4, brand, expiry: '12/27', holder: 'TEST USER' };
}

// ---------- Парк автомобилей ----------
const center = { lat: 55.7558, lon: 37.6173 };
const carModels = [
  { brand: 'Kia', model: 'Rio', rate: 8 },
  { brand: 'Hyundai', model: 'Solaris', rate: 8 },
  { brand: 'Volkswagen', model: 'Polo', rate: 9 },
  { brand: 'Renault', model: 'Logan', rate: 7 },
  { brand: 'Skoda', model: 'Rapid', rate: 9 },
  { brand: 'Toyota', model: 'Camry', rate: 14 },
  { brand: 'BMW', model: '3 Series', rate: 18 },
  { brand: 'Mercedes-Benz', model: 'C-Class', rate: 19 },
  { brand: 'Lada', model: 'Vesta', rate: 6 },
  { brand: 'Nissan', model: 'Qashqai', rate: 11 },
  { brand: 'Tesla', model: 'Model 3', rate: 25 },
  { brand: 'Audi', model: 'A4', rate: 17 },
  { brand: 'Mazda', model: 'CX-5', rate: 13 },
  { brand: 'Ford', model: 'Focus', rate: 9 },
  { brand: 'Honda', model: 'Civic', rate: 10 }
];

const cars = carModels.map(m => ({
  id: uid(),
  brand: m.brand,
  model: m.model,
  plate: plate(),
  lat: center.lat + rand(-0.03, 0.03),
  lon: center.lon + rand(-0.05, 0.05),
  fuel: randInt(35, 99),
  ratePerMin: m.rate,
  deposit: 150,
  status: 'available',
  photo: null
}));

// ---------- Пользователи ----------
const users = [];
const licenses = {};
const passports = {};
const cardsMap = {};

function makeActiveUser({ fullName, email, phone, passwordHash, blocked = false, cardsLast = ['4242'] }) {
  const u = {
    id: uid(), fullName, email, phone, passwordHash,
    status: 'active', blocked, createdAt: daysAgo(randInt(10, 200))
  };
  users.push(u);
  licenses[u.id] = {
    number: `77 ${randInt(10, 99)} ${randInt(100000, 999999)}`,
    fullName,
    category: 'B',
    issueDate: `${String(randInt(1,28)).padStart(2,'0')}.${String(randInt(1,12)).padStart(2,'0')}.${randInt(2018, 2023)}`,
    expireDate: `${String(randInt(1,28)).padStart(2,'0')}.${String(randInt(1,12)).padStart(2,'0')}.${randInt(2030, 2034)}`,
    frontPhoto: null, backPhoto: null,
    status: 'approved', uploadedAt: u.createdAt
  };
  passports[u.id] = {
    series: String(randInt(1000, 9999)),
    number: String(randInt(100000, 999999)),
    fullName,
    birthDate: `${String(randInt(1,28)).padStart(2,'0')}.${String(randInt(1,12)).padStart(2,'0')}.${randInt(1980, 2002)}`,
    photo: null, status: 'approved', uploadedAt: u.createdAt
  };
  cardsMap[u.id] = cardsLast.map((l, i) => maskedCard(l, i === 0 ? 'VISA' : 'MasterCard'));
  return u;
}

const ph = hash(PASSWORD);

const ivan      = makeActiveUser({ fullName: 'Иванов Иван Иванович',     email: 'ivanov@example.com',     phone: '+7 999 100 00 01', passwordHash: ph });
const petrov    = makeActiveUser({ fullName: 'Петров Пётр Петрович',     email: 'petrov@example.com',     phone: '+7 999 100 00 02', passwordHash: ph, cardsLast: ['1234', '5678'] });
const sidorova  = makeActiveUser({ fullName: 'Сидорова Анна Сергеевна',  email: 'sidorova@example.com',   phone: '+7 999 100 00 03', passwordHash: ph });
const kuznetsov = makeActiveUser({ fullName: 'Кузнецов Алексей Олегович',email: 'kuznetsov@example.com',  phone: '+7 999 100 00 04', passwordHash: ph });
const blocked   = makeActiveUser({ fullName: 'Заблокированный Юзер',     email: 'blocked@example.com',    phone: '+7 999 100 00 05', passwordHash: ph, blocked: true });

users.push({
  id: uid(), fullName: 'Новичок Пустой', email: 'newbie@example.com',
  phone: '+7 999 100 00 06', passwordHash: ph,
  status: 'awaiting_license', blocked: false, createdAt: daysAgo(1)
});

const halfDoc = {
  id: uid(), fullName: 'Половинкин Док Вуевич', email: 'halfdoc@example.com',
  phone: '+7 999 100 00 07', passwordHash: ph,
  status: 'awaiting_passport', blocked: false, createdAt: daysAgo(3)
};
users.push(halfDoc);
licenses[halfDoc.id] = {
  number: `77 22 555111`, fullName: halfDoc.fullName, category: 'B',
  issueDate: '15.06.2020', expireDate: '15.06.2030',
  frontPhoto: null, backPhoto: null, status: 'approved', uploadedAt: halfDoc.createdAt
};

// ---------- Активная бронь ----------
const bookings = [];
const carForBooking = cars[0];
carForBooking.status = 'booked';
bookings.push({
  id: uid(),
  userId: ivan.id,
  carId: carForBooking.id,
  cardId: cardsMap[ivan.id][0].id,
  depositHoldId: crypto.randomBytes(6).toString('hex'),
  createdAt: minutesAgo(3),
  expiresAt: minutesAhead(12),
  status: 'active'
});

// ---------- Активная поездка ----------
const trips = [];
const carForTrip = cars[1];
carForTrip.status = 'in_trip';
const tripBooking = {
  id: uid(),
  userId: petrov.id,
  carId: carForTrip.id,
  cardId: cardsMap[petrov.id][0].id,
  depositHoldId: crypto.randomBytes(6).toString('hex'),
  createdAt: minutesAgo(20),
  expiresAt: minutesAhead(60),
  status: 'in_trip'
};
bookings.push(tripBooking);
trips.push({
  id: uid(),
  bookingId: tripBooking.id,
  userId: petrov.id,
  carId: carForTrip.id,
  startedAt: minutesAgo(15),
  ratePerMin: carForTrip.ratePerMin,
  checklist: { body: true, glass: true, interior: true, wheels: true },
  startPhotos: [],
  status: 'active'
});

// ---------- История поездок ----------
const tripUsers = [ivan, petrov, sidorova, kuznetsov];
for (let i = 0; i < 25; i++) {
  const user = pick(tripUsers);
  const car = pick(cars);
  const startedDaysAgo = randInt(0, 60);
  const startedMin = randInt(0, 1439);
  const startedAt = new Date(Date.now() - startedDaysAgo * 86400000 - startedMin * 60000);
  const minutes = randInt(5, 120);
  const finishedAt = new Date(startedAt.getTime() + minutes * 60000);
  const distance = +(rand(1, 35)).toFixed(1);
  const cost = minutes * car.ratePerMin;
  const bId = uid();
  bookings.push({
    id: bId, userId: user.id, carId: car.id,
    cardId: cardsMap[user.id][0].id,
    depositHoldId: crypto.randomBytes(6).toString('hex'),
    createdAt: new Date(startedAt.getTime() - 120000).toISOString(),
    expiresAt: new Date(startedAt.getTime() + 15 * 60000).toISOString(),
    status: 'finished'
  });
  trips.push({
    id: uid(),
    bookingId: bId,
    userId: user.id,
    carId: car.id,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    ratePerMin: car.ratePerMin,
    checklist: { body: true, glass: true, interior: true, wheels: true },
    startPhotos: [],
    endPhotos: [],
    minutes,
    distanceKm: distance,
    cost,
    status: 'finished',
    paymentStatus: 'paid'
  });
}
trips.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

// ---------- Запись ----------
const db = {
  users,
  pendingRegistrations: {},
  licenses,
  passports,
  cards: cardsMap,
  cars,
  bookings,
  trips,
  sessions: {},
  adminSessions: {}
};

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

console.log('\n✓ База инициализирована: ' + DB_FILE);
console.log('  Пользователей:    ' + users.length + ' (1 заблокирован, 2 без документов)');
console.log('  Машин:            ' + cars.length);
console.log('  Активных броней:  ' + bookings.filter(b => b.status === 'active').length);
console.log('  Активных поездок: ' + trips.filter(t => t.status === 'active').length);
console.log('  История поездок:  ' + trips.filter(t => t.status === 'finished').length);
console.log('\nТестовые входы (пароль у всех: ' + PASSWORD + '):');
console.log('  ivanov@example.com    — активный, есть бронь');
console.log('  petrov@example.com    — активный, в поездке прямо сейчас');
console.log('  sidorova@example.com  — активный');
console.log('  kuznetsov@example.com — активный');
console.log('  blocked@example.com   — ЗАБЛОКИРОВАН (для теста админки)');
console.log('  newbie@example.com    — без документов');
console.log('  halfdoc@example.com   — есть ВУ, нет паспорта');
console.log('\nАдмин: admin@carshare.local / admin123\n');