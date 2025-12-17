const { pool } = require('../db');
const fs = require('fs');

async function migrate() {
    const client = await pool.connect();
    try {
        const sql = fs.readFileSync('../docs/schema.sql', 'utf8');
        await client.query(sql);
        console.log('Міграція успішно завершена.');
    } catch (err) {
        console.error('Помилка міграції:', err);
    } finally {
        client.release();
        process.exit();
    }
}

migrate();