const { Client } = require('pg');
const mapping = require('../mapping.json');

async function createAllDatabases() {
    console.log('🚀 Creating 16 databases across 4 PostgreSQL servers...\n');

    // Базові підключення без назви бази даних (підключаємося до стандартної postgres бази)
    const baseConnections = [
        'postgresql://admin:traveler123@postgres_00:5432/postgres',
        'postgresql://admin:traveler123@postgres_01:5432/postgres',
        'postgresql://admin:traveler123@postgres_02:5432/postgres',
        'postgresql://admin:traveler123@postgres_03:5432/postgres'
    ];

    const createdDatabases = [];
    const errors = [];

    try {
        for (const baseConn of baseConnections) {
            const client = new Client({ connectionString: baseConn });

            try {
                await client.connect();
                console.log(`📡 Connected to server: ${baseConn.split('@')[1].split('/')[0]}`);

                // Отримуємо бази даних для цього сервера з mapping
                const serverDbs = Object.entries(mapping)
                    .filter(([_, connStr]) => connStr.includes(baseConn.split('@')[1].split('/')[0]))
                    .map(([dbName]) => dbName);

                console.log(`   Creating databases: ${serverDbs.join(', ')}`);

                for (const dbName of serverDbs) {
                    try {
                        await client.query(`CREATE DATABASE ${dbName}`);
                        createdDatabases.push(dbName);
                        console.log(`   ✅ Created database ${dbName}`);
                    } catch (error) {
                        if (error.code === '42P04') { // база даних вже існує
                            console.log(`   ⚠️  Database ${dbName} already exists`);
                            createdDatabases.push(dbName);
                        } else {
                            errors.push({ dbName, error: error.message });
                            console.log(`   ❌ Failed to create ${dbName}: ${error.message}`);
                        }
                    }
                }

                await client.end();
                console.log('');

            } catch (error) {
                errors.push({ server: baseConn, error: error.message });
                console.log(`❌ Failed to connect to server: ${baseConn}`);
                console.log(`   Error: ${error.message}\n`);
            }
        }

        // Звіт
        console.log('=' .repeat(50));
        console.log('📊 INITIALIZATION REPORT:');
        console.log('=' .repeat(50));

        console.log(`✅ Successfully created/verified: ${createdDatabases.length} databases`);
        if (createdDatabases.length > 0) {
            console.log(`   Databases: ${createdDatabases.sort().join(', ')}`);
        }

        if (errors.length > 0) {
            console.log(`❌ Errors: ${errors.length}`);
            for (const err of errors) {
                if (err.dbName) {
                    console.log(`   - ${err.dbName}: ${err.error}`);
                } else {
                    console.log(`   - ${err.server}: ${err.error}`);
                }
            }
        }

        if (createdDatabases.length === 16) {
            console.log('\n🎉 SUCCESS: All 16 databases are ready!');
            process.exit(0);
        } else if (createdDatabases.length > 0) {
            console.log(`\n⚠️  PARTIAL SUCCESS: ${createdDatabases.length}/16 databases ready`);
            process.exit(1);
        } else {
            console.log('\n💥 FAILED: No databases were created');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n💥 UNEXPECTED ERROR:', error);
        process.exit(1);
    }
}

// Додаткова функція для створення конкретної бази даних
async function createSingleDatabase(dbName) {
    const connectionString = mapping[dbName];

    if (!connectionString) {
        console.error(`Database ${dbName} not found in mapping.json`);
        process.exit(1);
    }

    // Отримуємо базове підключення до сервера
    const serverUrl = connectionString.split('/').slice(0, -1).join('/') + '/postgres';

    const client = new Client({ connectionString: serverUrl });

    try {
        await client.connect();
        console.log(`Creating database: ${dbName}`);

        await client.query(`CREATE DATABASE ${dbName}`);
        console.log(`✅ Database ${dbName} created successfully`);

    } catch (error) {
        if (error.code === '42P04') {
            console.log(`⚠️  Database ${dbName} already exists`);
        } else {
            console.error(`❌ Failed to create ${dbName}:`, error.message);
            process.exit(1);
        }
    } finally {
        await client.end();
    }
}

// Обробка аргументів командного рядка
const args = process.argv.slice(2);

if (args.length === 0) {
    // Створюємо всі бази даних
    createAllDatabases();
} else if (args.length === 1 && args[0].startsWith('db_')) {
    // Створюємо конкретну базу даних
    createSingleDatabase(args[0]);
} else {
    console.log('Usage:');
    console.log('  node init-databases.js           - Create all 16 databases');
    console.log('  node init-databases.js db_0      - Create specific database');
    process.exit(1);
}