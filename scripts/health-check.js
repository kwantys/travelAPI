const { Client } = require('pg');
const mapping = require('../mapping.json');

async function checkAllShards() {
    console.log('🔍 Checking health of all database shards...\n');

    const results = [];
    let totalPlans = 0;
    let totalLocations = 0;

    for (const [dbName, connectionString] of Object.entries(mapping)) {
        const client = new Client({ connectionString });

        try {
            await client.connect();

            const plansResult = await client.query('SELECT COUNT(*) as count FROM travel_plans');
            const locationsResult = await client.query('SELECT COUNT(*) as count FROM locations');
            const tablesResult = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('travel_plans', 'locations')
            `);

            const planCount = parseInt(plansResult.rows[0].count);
            const locationCount = parseInt(locationsResult.rows[0].count);
            const tableCount = tablesResult.rows.length;

            totalPlans += planCount;
            totalLocations += locationCount;

            results.push({
                shard: dbName,
                status: '✅ HEALTHY',
                tables: tableCount,
                travel_plans: planCount,
                locations: locationCount,
                connection: '✅ OK'
            });

            console.log(`✅ ${dbName}: OK (${planCount} plans, ${locationCount} locations)`);

        } catch (error) {
            results.push({
                shard: dbName,
                status: '❌ ERROR',
                tables: 0,
                travel_plans: 0,
                locations: 0,
                connection: `❌ ${error.message}`
            });

            console.log(`❌ ${dbName}: ERROR - ${error.message}`);
        } finally {
            try {
                await client.end();
            } catch (error) {
            }
        }
    }

    console.log('\n📊 DETAILED SHARD HEALTH REPORT:');
    console.log('=' .repeat(80));

    for (const result of results) {
        console.log(`\n🔸 Shard: ${result.shard}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Connection: ${result.connection}`);
        console.log(`   Tables found: ${result.tables}/2`);
        console.log(`   Travel plans: ${result.travel_plans}`);
        console.log(`   Locations: ${result.locations}`);
    }

    console.log('\n' + '=' .repeat(80));
    console.log('📈 SUMMARY:');
    console.log(`   Total shards: ${Object.keys(mapping).length}`);
    console.log(`   Healthy shards: ${results.filter(r => r.status === '✅ HEALTHY').length}`);
    console.log(`   Failed shards: ${results.filter(r => r.status === '❌ ERROR').length}`);
    console.log(`   Total travel plans: ${totalPlans}`);
    console.log(`   Total locations: ${totalLocations}`);

    const allHealthy = results.every(r => r.status === '✅ HEALTHY');
    const expectedTables = 2;

    const tablesHealthy = results.every(r => r.tables === expectedTables);

    if (allHealthy && tablesHealthy) {
        console.log('\n🎉 ALL SHARDS ARE HEALTHY!');
        process.exit(0);
    } else {
        console.log('\n⚠️  SOME SHARDS HAVE ISSUES:');

        if (!allHealthy) {
            const failedShards = results.filter(r => r.status === '❌ ERROR').map(r => r.shard);
            console.log(`   - Connection issues: ${failedShards.join(', ')}`);
        }

        if (!tablesHealthy) {
            const missingTables = results.filter(r => r.tables < expectedTables).map(r =>
                `${r.shard} (${r.tables}/${expectedTables} tables)`
            );
            console.log(`   - Missing tables: ${missingTables.join(', ')}`);
        }

        process.exit(1);
    }
}

async function checkSingleShard(dbName) {
    const connectionString = mapping[dbName];

    if (!connectionString) {
        console.error(`Shard ${dbName} not found in mapping.json`);
        process.exit(1);
    }

    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log(`🔍 Checking shard: ${dbName}`);

        await client.query('SELECT 1');

        const plansResult = await client.query('SELECT COUNT(*) as count FROM travel_plans');
        const locationsResult = await client.query('SELECT COUNT(*) as count FROM locations');

        console.log('✅ Shard is healthy');
        console.log(`   Travel plans: ${plansResult.rows[0].count}`);
        console.log(`   Locations: ${locationsResult.rows[0].count}`);

    } catch (error) {
        console.error(`❌ Shard ${dbName} is unhealthy:`, error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

const args = process.argv.slice(2);

if (args.length === 0) {
    checkAllShards();
} else if (args.length === 1 && args[0].startsWith('db_')) {
    checkSingleShard(args[0]);
} else {
    console.log('Usage:');
    console.log('  node health-check.js           - Check all shards');
    console.log('  node health-check.js db_0      - Check specific shard');
    process.exit(1);
}