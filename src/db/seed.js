require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/database');

async function seed() {
  console.log('🌱 Seeding database...\n');

  try {
    // =============================================
    // SEED ADVOCATES
    // =============================================
    const advocates = [
      {
        name: 'Dr. Arief Kusuma, S.H., M.H.',
        email: 'arief.kusuma@lexora.id',
        phone: '+628111000001',
        password: 'Advokat123!',
        photo_url: 'https://i.pravatar.cc/150?img=11',
        title: 'Senior Partner',
        firm_name: 'Kusuma & Rekan Law Firm',
        bio: 'Dr. Arief Kusuma adalah advokat senior dengan pengalaman lebih dari 20 tahun dalam menangani kasus hukum pidana dan bisnis kompleks.',
        license_number: 'PERADI/DKI/2004/0892',
        location: 'Jakarta Selatan',
        experience_years: 20,
        consultation_fee: 500000,
        is_available: true,
        is_verified: true,
        specializations: ['Hukum Pidana', 'Hukum Bisnis', 'Arbitrase'],
      },
      {
        name: 'Siti Rahmawati, S.H., LL.M.',
        email: 'siti.rahmawati@lexora.id',
        phone: '+628111000002',
        password: 'Advokat123!',
        photo_url: 'https://i.pravatar.cc/150?img=5',
        title: 'Partner',
        firm_name: 'Rahmawati Law Partners',
        bio: 'Siti Rahmawati adalah advokat spesialis hukum keluarga dan waris dengan pengalaman 12 tahun.',
        license_number: 'PERADI/JKT/2012/1245',
        location: 'Jakarta Pusat',
        experience_years: 12,
        consultation_fee: 350000,
        is_available: true,
        is_verified: true,
        specializations: ['Hukum Keluarga', 'Hukum Waris', 'Hukum Perkawinan'],
      },
      {
        name: 'Budi Santoso, S.H.',
        email: 'budi.santoso@lexora.id',
        phone: '+628111000003',
        password: 'Advokat123!',
        photo_url: 'https://i.pravatar.cc/150?img=15',
        title: 'Associate',
        firm_name: 'Santoso Legal Consulting',
        bio: 'Budi Santoso adalah advokat yang berfokus pada sengketa properti dan hukum pertanahan dengan 7 tahun pengalaman.',
        license_number: 'PERADI/JKT/2017/3401',
        location: 'Tangerang',
        experience_years: 7,
        consultation_fee: 250000,
        is_available: false,
        is_verified: true,
        specializations: ['Hukum Properti', 'Hukum Kontrak', 'Sengketa Tanah'],
      },
      {
        name: 'Prof. Dewi Anggraini, S.H., Ph.D.',
        email: 'dewi.anggraini@lexora.id',
        phone: '+628111000004',
        password: 'Advokat123!',
        photo_url: 'https://i.pravatar.cc/150?img=9',
        title: 'Senior Counsel',
        firm_name: 'Anggraini & Associates',
        bio: 'Prof. Dewi Anggraini adalah profesor hukum dan praktisi senior di bidang hukum ketenagakerjaan dengan 25 tahun pengalaman.',
        license_number: 'PERADI/DKI/2000/0211',
        location: 'Jakarta Barat',
        experience_years: 25,
        consultation_fee: null,
        is_available: true,
        is_verified: true,
        specializations: ['Hukum Ketenagakerjaan', 'Hukum Perburuhan', 'Industrial Relations'],
      },
      {
        name: 'Rizky Pratama, S.H., M.Kn.',
        email: 'rizky.pratama@lexora.id',
        phone: '+628111000005',
        password: 'Advokat123!',
        photo_url: 'https://i.pravatar.cc/150?img=18',
        title: 'Associate',
        firm_name: 'Pratama Digital Law',
        bio: 'Rizky Pratama adalah advokat spesialis hukum digital dan perlindungan konsumen dengan latar belakang teknologi informasi.',
        license_number: 'PERADI/JKT/2019/5502',
        location: 'Jakarta Utara',
        experience_years: 5,
        consultation_fee: 200000,
        is_available: true,
        is_verified: true,
        specializations: ['Hukum Konsumen', 'Perlindungan Data', 'E-Commerce'],
      },
    ];

    console.log('📋 Menyimpan data advokat...');

    for (const adv of advocates) {
      const passwordHash = await bcrypt.hash(adv.password, 12);

      // Insert advocate
      const result = await query(
        `INSERT INTO advocates (
          name, email, phone, password_hash, photo_url, title, firm_name,
          bio, license_number, location, experience_years, consultation_fee,
          is_available, is_verified, rating, total_reviews, total_cases
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          is_verified = EXCLUDED.is_verified
        RETURNING id`,
        [
          adv.name, adv.email, adv.phone, passwordHash,
          adv.photo_url, adv.title, adv.firm_name, adv.bio,
          adv.license_number, adv.location, adv.experience_years,
          adv.consultation_fee, adv.is_available, adv.is_verified,
          (4.5 + Math.random() * 0.5).toFixed(1),
          Math.floor(80 + Math.random() * 350),
          Math.floor(100 + Math.random() * 700),
        ]
      );

      const advocateId = result.rows[0].id;

      // Insert specializations
      await query(
        'DELETE FROM advocate_specializations WHERE advocate_id = $1',
        [advocateId]
      );
      for (const spec of adv.specializations) {
        await query(
          'INSERT INTO advocate_specializations (advocate_id, name) VALUES ($1, $2)',
          [advocateId, spec]
        );
      }

      console.log(`  ✅ ${adv.name}`);
    }

    // =============================================
    // SEED TEST USER
    // =============================================
    console.log('\n👤 Menyimpan user testing...');

    const testUserHash = await bcrypt.hash('Test123!', 12);
    await query(
      `INSERT INTO users (name, email, phone, password_hash, nik, address, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO NOTHING`,
      [
        'Ahmad Fauzi',
        'test@lexora.id',
        '+628123456789',
        testUserHash,
        '3275011234567890',
        'Jl. Merdeka No. 12, Jakarta Selatan',
        true,
      ]
    );
    console.log('  ✅ test@lexora.id (password: Test123!)');

    console.log('\n✨ Seeding selesai!');
    console.log('\n📌 Akun testing:');
    console.log('  User    → email: test@lexora.id | password: Test123!');
    console.log('  Advokat → email: arief.kusuma@lexora.id | password: Advokat123!');

  } catch (error) {
    console.error('❌ Seed error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
