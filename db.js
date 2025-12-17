const { Pool } = require('pg');
const mapping = require('./mapping.json');

class ShardingManager {
    constructor() {
        this.connections = new Map();
        this.setupConnections();
    }

    setupConnections() {
        for (const [dbName, connectionString] of Object.entries(mapping)) {
            this.connections.set(dbName, new Pool({
                connectionString,
                max: 5,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
            }));
        }
    }

    getDbNameFromId(id) {
        const lastChar = id[id.length - 1].toLowerCase();
        return `db_${lastChar}`;
    }

    getConnection(id) {
        const dbName = this.getDbNameFromId(id);
        const pool = this.connections.get(dbName);

        if (!pool) {
            throw new Error(`No connection found for ID: ${id}, DB: ${dbName}`);
        }

        return { pool, dbName };
    }

    async queryById(id, sql, params = []) {
        const { pool, dbName } = this.getConnection(id);
        const result = await pool.query(sql, params);
        result.shard = dbName;
        return result;
    }

    async queryAll(sql, params = []) {
        const allResults = [];

        for (const [dbName, pool] of this.connections) {
            try {
                const result = await pool.query(sql, params);
                allResults.push(...result.rows);
            } catch (error) {
                console.error(`Error querying ${dbName}:`, error.message);
            }
        }

        return { rows: allResults };
    }

    async getShardStatus() {
        const status = {};

        for (const [dbName, pool] of this.connections) {
            try {
                const client = await pool.connect();
                const result = await client.query(`
          SELECT 
            COUNT(*) as total_plans,
            COUNT(*) FILTER (WHERE is_public = true) as public_plans,
            MAX(created_at) as last_created
          FROM travel_plans
        `);

                status[dbName] = {
                    status: 'healthy',
                    total_plans: parseInt(result.rows[0].total_plans),
                    public_plans: parseInt(result.rows[0].public_plans),
                    last_created: result.rows[0].last_created
                };

                client.release();
            } catch (error) {
                status[dbName] = {
                    status: 'error',
                    error: error.message
                };
            }
        }

        return status;
    }

    async getShardInfo() {
        const info = {
            total_shards: this.connections.size,
            shards: []
        };

        for (const [dbName, pool] of this.connections) {
            try {
                const client = await pool.connect();
                const plansCount = await client.query('SELECT COUNT(*) FROM travel_plans');
                const locationsCount = await client.query('SELECT COUNT(*) FROM locations');

                info.shards.push({
                    name: dbName,
                    status: 'healthy',
                    travel_plans: parseInt(plansCount.rows[0].count),
                    locations: parseInt(locationsCount.rows[0].count)
                });

                client.release();
            } catch (error) {
                info.shards.push({
                    name: dbName,
                    status: 'error',
                    error: error.message
                });
            }
        }

        return info;
    }

    async createTravelPlan(id, title, description, start_date, end_date, budget, currency, is_public) {
        const sql = `
      INSERT INTO travel_plans (id, title, description, start_date, end_date, budget, currency, is_public)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, title, description, to_char(start_date, 'YYYY-MM-DD') as start_date,
                to_char(end_date, 'YYYY-MM-DD') as end_date, budget,
                currency, is_public, version, created_at, updated_at, version as current_version
    `;
        return await this.queryById(id, sql, [id, title, description, start_date, end_date, budget, currency, is_public]);
    }

    async getTravelPlanById(id) {
        const sql = `
      SELECT id, title, description, to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date, budget,
             currency, is_public, version, created_at, updated_at
      FROM travel_plans WHERE id = $1
    `;
        return await this.queryById(id, sql, [id]);
    }

    async getAllTravelPlans() {
        const sql = `
      SELECT id, title, to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date, budget, currency, is_public
      FROM travel_plans ORDER BY created_at DESC
    `;
        return await this.queryAll(sql);
    }

    async updateTravelPlan(id, title, description, start_date, end_date, budget, currency, is_public, version) {
        const sql = `
      UPDATE travel_plans
      SET title=COALESCE($1, title), 
          description=COALESCE($2, description), 
          start_date=COALESCE($3, start_date), 
          end_date=COALESCE($4, end_date), 
          budget=COALESCE($5, budget),
          currency=COALESCE($6, currency), 
          is_public=COALESCE($7, is_public), 
          version=version+1
      WHERE id=$8 AND version=$9
      RETURNING id, title, description, to_char(start_date,'YYYY-MM-DD') as start_date,
                to_char(end_date,'YYYY-MM-DD') as end_date, budget,
                currency, is_public, version, created_at, updated_at, version as current_version
    `;
        return await this.queryById(id, sql, [title, description, start_date, end_date, budget, currency, is_public, id, version]);
    }

    async deleteTravelPlan(id) {
        const sql = 'DELETE FROM travel_plans WHERE id = $1';
        return await this.queryById(id, sql, [id]);
    }

    async getLocationsByTravelPlanId(planId) {
        const sql = `
      SELECT *, version as current_version 
      FROM locations 
      WHERE travel_plan_id = $1 
      ORDER BY visit_order
    `;
        return await this.queryById(planId, sql, [planId]);
    }

    async createLocation(planId, name, address, latitude, longitude, arrival_date, departure_date, budget, notes) {
        const { pool, dbName } = this.getConnection(planId);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const planCheck = await client.query('SELECT 1 FROM travel_plans WHERE id=$1 FOR UPDATE', [planId]);
            if (planCheck.rowCount === 0) {
                await client.query('ROLLBACK');
                throw new Error('Travel Plan not found');
            }

            const maxOrderResult = await client.query(
                'SELECT MAX(visit_order) as max_order FROM locations WHERE travel_plan_id=$1',
                [planId]
            );
            const newOrder = (maxOrderResult.rows[0].max_order || 0) + 1;

            const insertResult = await client.query(
                `INSERT INTO locations (travel_plan_id, name, address, latitude, longitude, visit_order,
                               arrival_date, departure_date, budget, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, travel_plan_id, name, address, latitude, longitude, visit_order,
                   arrival_date, departure_date, budget, notes, version, created_at, updated_at, version as current_version`,
                [planId, name, address, latitude, longitude, newOrder, arrival_date, departure_date, budget, notes]
            );

            await client.query('COMMIT');

            const result = insertResult;
            result.shard = dbName;
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getLocationById(locationId) {
        for (const [dbName, pool] of this.connections) {
            try {
                const result = await pool.query('SELECT * FROM locations WHERE id = $1', [locationId]);
                if (result.rows.length > 0) {
                    result.shard = dbName;
                    return result;
                }
            } catch (error) {
                // Continue searching
            }
        }

        return { rows: [] };
    }

    async updateLocation(id, name, address, latitude, longitude, visit_order, arrival_date, departure_date, budget, notes, version) {
        const locationResult = await this.getLocationById(id);
        if (locationResult.rows.length === 0) {
            throw new Error('Location not found');
        }

        const sql = `
      UPDATE locations
      SET name=COALESCE($1, name),
          address=COALESCE($2, address),
          latitude=COALESCE($3, latitude),
          longitude=COALESCE($4, longitude),
          visit_order=COALESCE($5, visit_order),
          arrival_date=COALESCE($6, arrival_date),
          departure_date=COALESCE($7, departure_date),
          budget=COALESCE($8, budget),
          notes=COALESCE($9, notes),
          version=version+1
      WHERE id=$10 AND version=$11
      RETURNING id, travel_plan_id, name, address, latitude, longitude, visit_order, 
                arrival_date, departure_date, budget, notes, version, created_at, updated_at, version as current_version
    `;

        return await this.queryById(locationResult.rows[0].travel_plan_id, sql,
            [name, address, latitude, longitude, visit_order, arrival_date, departure_date, budget, notes, id, version]);
    }

    async deleteLocation(locationId) {
        const locationResult = await this.getLocationById(locationId);
        if (locationResult.rows.length === 0) {
            return { rowCount: 0 };
        }

        const sql = 'DELETE FROM locations WHERE id = $1';
        return await this.queryById(locationResult.rows[0].travel_plan_id, sql, [locationId]);
    }
}

// Створюємо екземпляр і експортуємо методи окремо
const shardingManager = new ShardingManager();

// Експортуємо всі методи окремо
module.exports = {
    getShardStatus: shardingManager.getShardStatus.bind(shardingManager),
    getShardInfo: shardingManager.getShardInfo.bind(shardingManager),
    createTravelPlan: shardingManager.createTravelPlan.bind(shardingManager),
    getTravelPlanById: shardingManager.getTravelPlanById.bind(shardingManager),
    getAllTravelPlans: shardingManager.getAllTravelPlans.bind(shardingManager),
    updateTravelPlan: shardingManager.updateTravelPlan.bind(shardingManager),
    deleteTravelPlan: shardingManager.deleteTravelPlan.bind(shardingManager),
    getLocationsByTravelPlanId: shardingManager.getLocationsByTravelPlanId.bind(shardingManager),
    createLocation: shardingManager.createLocation.bind(shardingManager),
    getLocationById: shardingManager.getLocationById.bind(shardingManager),
    updateLocation: shardingManager.updateLocation.bind(shardingManager),
    deleteLocation: shardingManager.deleteLocation.bind(shardingManager)
};