const express = require('express');
const { query } = require('../config/database');
const { authenticate, advocateOnly } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../middleware/errorHandler');

const router = express.Router();

// =============================================
// Helper: Format data advokat
// =============================================
const formatAdvocate = async (adv) => {
  const specs = await query(
    'SELECT name FROM advocate_specializations WHERE advocate_id = $1 ORDER BY created_at',
    [adv.id]
  );
  return {
    id: adv.id,
    name: adv.name,
    email: adv.email,
    phone: adv.phone,
    photoUrl: adv.photo_url,
    title: adv.title,
    firmName: adv.firm_name,
    bio: adv.bio,
    licenseNumber: adv.license_number,
    location: adv.location,
    experienceYears: adv.experience_years,
    consultationFee: adv.consultation_fee,
    complaintFee: adv.complaint_fee,       // ← tambahan
    isAvailable: adv.is_available,
    isVerified: adv.is_verified,
    rating: parseFloat(adv.rating) || 0,
    totalReviews: adv.total_reviews,
    totalCases: adv.total_cases,
    specializations: specs.rows.map(s => s.name),
  };
};

// =============================================
// GET /advocates
// Daftar semua advokat (dengan filter & search)
// =============================================
router.get('/', async (req, res, next) => {
  try {
    const {
      search,
      category,
      location,
      available,
      sort = 'rating',
      page = 1,
      limit = 10,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let whereConditions = ['a.is_active = true', 'a.is_verified = true'];

    if (search) {
      params.push(`%${search}%`);
      whereConditions.push(
        `(a.name ILIKE $${params.length} OR a.firm_name ILIKE $${params.length})`
      );
    }
    if (location) {
      params.push(`%${location}%`);
      whereConditions.push(`a.location ILIKE $${params.length}`);
    }
    if (available === 'true') {
      whereConditions.push('a.is_available = true');
    }
    if (category) {
      params.push(`%${category}%`);
      whereConditions.push(`
        EXISTS (
          SELECT 1 FROM advocate_specializations sp
          WHERE sp.advocate_id = a.id AND sp.name ILIKE $${params.length}
        )
      `);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const sortMap = {
      rating:     'a.rating DESC, a.total_reviews DESC',
      experience: 'a.experience_years DESC',
      fee_asc:    'a.consultation_fee ASC NULLS FIRST',
      fee_desc:   'a.consultation_fee DESC NULLS LAST',
    };
    const orderBy = sortMap[sort] || sortMap.rating;

    const countResult = await query(
      `SELECT COUNT(*) FROM advocates a ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await query(
      `SELECT a.* FROM advocates a
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const advocates = await Promise.all(result.rows.map(formatAdvocate));

    return sendSuccess(res, {
      advocates,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// ⚠️  ROUTE /me/* HARUS DI ATAS /:id
// Jika di bawah, Express akan tangkap "me" sebagai :id
// =============================================

// =============================================
// GET /advocates/me/profile
// Profil advokat yang sedang login + fee
// =============================================
router.get('/me/profile', authenticate, advocateOnly, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*, u.email
       FROM advocates a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [req.user.id]
    );

    if (!result.rows[0]) {
      return sendError(res, 'Profil advokat tidak ditemukan', 404);
    }

    const advocate = await formatAdvocate(result.rows[0]);
    return sendSuccess(res, { advocate });
  } catch (error) {
    next(error);
  }
});

// =============================================
// PUT /advocates/me/fee
// Update tarif konsultasi & pengaduan
// Body: { consultationFee: number|null, complaintFee: number|null }
// =============================================
router.put('/me/fee', authenticate, advocateOnly, async (req, res, next) => {
  try {
    const { consultationFee, complaintFee } = req.body;

    if (consultationFee !== null && consultationFee !== undefined) {
      if (!Number.isInteger(consultationFee) || consultationFee < 0) {
        return sendError(res, 'consultationFee harus bilangan bulat positif atau null', 400);
      }
    }
    if (complaintFee !== null && complaintFee !== undefined) {
      if (!Number.isInteger(complaintFee) || complaintFee < 0) {
        return sendError(res, 'complaintFee harus bilangan bulat positif atau null', 400);
      }
    }

    await query(
      `UPDATE advocates
       SET consultation_fee = $1,
           complaint_fee    = $2,
           updated_at       = NOW()
       WHERE id = $3`,
      [consultationFee ?? null, complaintFee ?? null, req.user.id]
    );

    return sendSuccess(res, {
      consultationFee: consultationFee ?? null,
      complaintFee:    complaintFee    ?? null,
    }, 'Tarif berhasil diperbarui');
  } catch (error) {
    next(error);
  }
});

// =============================================
// PUT /advocates/availability
// Update status online/offline
// =============================================
router.put('/availability', authenticate, advocateOnly, async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') {
      return sendError(res, 'isAvailable harus boolean', 400);
    }
    await query(
      'UPDATE advocates SET is_available = $1 WHERE id = $2',
      [isAvailable, req.user.id]
    );
    return sendSuccess(res, { isAvailable }, 'Status ketersediaan diperbarui');
  } catch (error) {
    next(error);
  }
});

// =============================================
// GET /advocates/:id
// Detail satu advokat — HARUS DI BAWAH /me/*
// =============================================
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM advocates WHERE id = $1 AND is_active = true',
      [req.params.id]
    );

    if (!result.rows[0]) {
      return sendError(res, 'Advokat tidak ditemukan', 404);
    }

    const advocate = await formatAdvocate(result.rows[0]);

    const reviews = await query(
      `SELECT r.*, u.name as user_name, u.photo_url as user_photo
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.advocate_id = $1
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [req.params.id]
    );

    return sendSuccess(res, {
      advocate,
      reviews: reviews.rows.map(r => ({
        id:        r.id,
        rating:    r.rating,
        comment:   r.comment,
        userName:  r.user_name,
        userPhoto: r.user_photo,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// POST /advocates/:id/review
// Beri ulasan — HARUS DI BAWAH /me/*
// =============================================
router.post('/:id/review', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'user') {
      return sendError(res, 'Hanya klien yang bisa memberi ulasan', 403);
    }

    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return sendError(res, 'Rating harus antara 1 dan 5', 400);
    }

    const advResult = await query(
      'SELECT id FROM advocates WHERE id = $1',
      [req.params.id]
    );
    if (!advResult.rows[0]) {
      return sendError(res, 'Advokat tidak ditemukan', 404);
    }

    await query(
      `INSERT INTO reviews (user_id, advocate_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, advocate_id) DO UPDATE
       SET rating = EXCLUDED.rating, comment = EXCLUDED.comment`,
      [req.user.id, req.params.id, rating, comment]
    );

    await query(
      `UPDATE advocates SET
         rating = (SELECT AVG(rating) FROM reviews WHERE advocate_id = $1),
         total_reviews = (SELECT COUNT(*) FROM reviews WHERE advocate_id = $1)
       WHERE id = $1`,
      [req.params.id]
    );

    return sendSuccess(res, {}, 'Ulasan berhasil disimpan', 201);
  } catch (error) {
    next(error);
  }
});

module.exports = router;