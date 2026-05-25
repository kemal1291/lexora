# LEXORA BACKEND

Backend API untuk aplikasi Lexora — Node.js + Express + Socket.io + PostgreSQL.

---

## 🏗️ Arsitektur

```
lexora-backend/
├── server.js                    # Entry point (HTTP + Socket.io)
├── src/
│   ├── app.js                   # Express app & routing
│   ├── config/
│   │   ├── database.js          # PostgreSQL connection pool
│   │   └── firebase.js          # Firebase Admin SDK
│   ├── middleware/
│   │   ├── auth.js              # JWT middleware
│   │   └── errorHandler.js      # Global error handler
│   ├── routes/
│   │   ├── auth.js              # Register, login, Google, OTP
│   │   ├── advocates.js         # Daftar & detail advokat
│   │   ├── complaints.js        # CRUD pengaduan
│   │   └── chat.js              # REST API chat rooms & messages
│   ├── socket/
│   │   └── chatHandler.js       # Socket.io real-time chat
│   └── db/
│       ├── schema.sql           # DDL database
│       ├── migrate.js           # Jalankan migration
│       └── seed.js              # Data awal (advokat + user test)
└── uploads/                     # File yang diupload user
```

---

## 🚀 Setup & Instalasi

### 1. Prasyarat
- Node.js 18+
- PostgreSQL 14+

### 2. Install dependencies
```bash
npm install
```

### 3. Konfigurasi environment
```bash
cp .env.example .env
# Edit .env dengan konfigurasi database Anda
```

### 4. Buat database PostgreSQL
```bash
createdb lexora_db
# atau via psql:
psql -U postgres -c "CREATE DATABASE lexora_db;"
```

### 5. Jalankan migration (buat tabel)
```bash
npm run db:migrate
```

### 6. Seed data awal (advokat + user test)
```bash
npm run db:seed
```

### 7. Jalankan server
```bash
# Development (hot reload)
npm run dev

# Production
npm start
```

Server berjalan di: `http://localhost:3000`

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/auth/register` | Daftar email & password |
| POST | `/api/auth/login` | Login email & password |
| POST | `/api/auth/google` | Login Google (Firebase token) |
| POST | `/api/auth/phone/verify` | Verifikasi OTP telepon |
| POST | `/api/auth/advocate/login` | Login advokat |
| GET | `/api/auth/me` | Profil saat ini 🔒 |
| PUT | `/api/auth/profile` | Update profil 🔒 |
| PUT | `/api/auth/change-password` | Ubah password 🔒 |

### Advocates
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/advocates` | Daftar advokat (search, filter) |
| GET | `/api/advocates/:id` | Detail advokat + ulasan |
| PUT | `/api/advocates/availability` | Update status 🔒👨‍⚖️ |
| POST | `/api/advocates/:id/review` | Beri ulasan 🔒 |

### Complaints
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/complaints` | Daftar pengaduan 🔒 |
| POST | `/api/complaints` | Buat pengaduan baru 🔒 |
| GET | `/api/complaints/:id` | Detail pengaduan 🔒 |
| PATCH | `/api/complaints/:id/status` | Update status 🔒👨‍⚖️ |
| PATCH | `/api/complaints/:id/assign` | Assign advokat 🔒 |

### Chat
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/chat/rooms` | Daftar chat room 🔒 |
| POST | `/api/chat/rooms` | Buat chat room baru 🔒 |
| GET | `/api/chat/rooms/:id/messages` | Riwayat pesan 🔒 |
| GET | `/api/chat/unread-count` | Badge notifikasi 🔒 |

> 🔒 = Perlu Authorization header  
> 👨‍⚖️ = Khusus advokat

---

## 🔌 Socket.io Events

### Client → Server (emit)
```javascript
// Bergabung ke room & muat pesan awal
socket.emit('room:join', { roomId }, (response) => {
  // response.messages = array pesan
})

// Kirim pesan
socket.emit('message:send', { roomId, content, messageType: 'text' }, (response) => {
  // response.message = pesan yang terkirim
})

// Indikator mengetik
socket.emit('typing:start', { roomId })
socket.emit('typing:stop', { roomId })

// Tandai pesan sebagai dibaca
socket.emit('messages:read', { roomId })

// Keluar dari room
socket.emit('room:leave', { roomId })
```

### Server → Client (on)
```javascript
socket.on('message:new', (message) => {})          // Pesan baru
socket.on('typing:start', (data) => {})            // Lawan sedang mengetik
socket.on('typing:stop', (data) => {})             // Lawan berhenti mengetik
socket.on('messages:read', (data) => {})           // Pesan sudah dibaca
socket.on('notification:message', (data) => {})    // Notif saat tidak di room
socket.on('user:online', (data) => {})             // User/advokat online
socket.on('user:offline', (data) => {})            // User/advokat offline
```

### Contoh koneksi dari Flutter (socket_io_client)
```dart
final socket = io.io('http://YOUR_IP:3000', OptionBuilder()
  .setTransports(['websocket'])
  .setAuth({'token': 'YOUR_JWT_TOKEN'})
  .build());
```

---

## 🧪 Testing API

### Register user baru
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Budi","email":"budi@test.com","password":"Budi1234!"}'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@lexora.id","password":"Test123!"}'
```

### Daftar advokat
```bash
curl http://localhost:3000/api/advocates?search=arief&available=true
```

### Buat pengaduan (ganti TOKEN)
```bash
curl -X POST http://localhost:3000/api/complaints \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Sengketa tanah","description":"Deskripsi minimal 50 karakter tentang masalah hukum saya...","category":"properti"}'
```

---

## 🔑 Akun Testing (setelah seed)

| Role | Email | Password |
|------|-------|----------|
| User | test@lexora.id | Test123! |
| Advokat | arief.kusuma@lexora.id | Advokat123! |
| Advokat | siti.rahmawati@lexora.id | Advokat123! |

---

## 📱 Konfigurasi Flutter

Di file `lib/services/api_service.dart`, ubah `_baseUrl`:
```dart
// Android Emulator
static const String _baseUrl = 'http://10.0.2.2:3000/api';

// iOS Simulator / Device fisik (gunakan IP komputer)
static const String _baseUrl = 'http://192.168.1.XXX:3000/api';
```

Di file `lib/services/chat_service.dart`, ubah URL socket:
```dart
_socket = io.io('http://10.0.2.2:3000', ...);
```

Tambahkan dependency ke `pubspec.yaml` Flutter:
```yaml
socket_io_client: ^2.0.3+1
http: ^1.2.1
```
