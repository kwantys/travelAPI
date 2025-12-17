const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const mapping = require('../mapping.json');

async function executeScriptOnAllDatabases(scriptFile) {
    if (!scriptFile) {
        console.error('Usage: node migrate-all.js <script-file>');
        process.exit(1);
    }

    if (!fs.existsSync(scriptFile)) {
        console.error(`Script file not found: ${scriptFile}`);
        process.exit(1);
    }

    const script = fs.readFileSync(scriptFile, 'utf8');
    const connections = [];

    console.log('Starting migration on all databases...');
    console.log(`Script: ${scriptFile}`);
    console.log('---');

    try {
        for (const [dbName, connectionString] of Object.entries(mapping)) {
            const client = new Client({ connectionString });
            connections.push({ dbName, client });
        }

        for (const { dbName, client } of connections) {
            try {
                await client.connect();
                console.log(`✓ Connected to ${dbName}`);
            } catch (error) {
                console.error(`✗ Failed to connect to ${dbName}:`, error.message);
                throw error;
            }
        }

        const results = [];
        for (const { dbName, client } of connections) {
            try {
                console.log(`Executing migration on ${dbName}...`);

                await client.query('BEGIN');
                await client.query(script);
                await client.query('COMMIT');

                console.log(`✓ Success on ${dbName}`);
                results.push({ dbName, status: 'success' });
            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`✗ Error on ${dbName}:`, error.message);
                results.push({ dbName, status: 'error', error: error.message });

                throw new Error(`Migration failed on ${dbName}: ${error.message}`);
            }
        }

        console.log('\n---');
        console.log('Migration completed successfully on all databases!');

        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount = results.filter(r => r.status === 'error').length;
        console.log(`Results: ${successCount} successful, ${errorCount} failed`);

    } catch (error) {
        console.error('\n---');
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {

        for (const { client } of connections) {
            try {
                await client.end();
            } catch (error) {
                console.error('Error closing connection:', error.message);
            }
        }
    }
}

const scriptFile = process.argv[2];
executeScriptOnAllDatabases(scriptFile);