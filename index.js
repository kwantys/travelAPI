const express = require('express');
const { query, pool } = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());
const port = 3000;

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.log('VALIDATION FAILED: Malformed JSON');
        return res.status(400).json({ error: 'Validation error' });
    }
    next(err);
});

const handleError = (res, err, status = 500, message = 'Internal Server Error') => {
    console.error(err);
    res.status(status).json({ error: message });
};

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const isValidNumber = (val) => {
    if (val === undefined || val === null || val === '') return true;
    const num = Number(val);
    return !isNaN(num) && isFinite(num);
};

const isValidDate = (dateString) => {
    if (!dateString) return true;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && date.toISOString().slice(0,10) === dateString;
};

const isValidCoordinate = (coord, type) => {
    if (coord === undefined || coord === null) return true;
    if (!isValidNumber(coord)) return false;
    const num = Number(coord);
    if (type === 'latitude') return num >= -90 && num <= 90;
    if (type === 'longitude') return num >= -180 && num <= 180;
    return true;
};

const parseBudgetToNumber = (rows) => {
    return rows.map(row => {
        if (row.budget !== null && row.budget !== undefined) {
            row.budget = Number(row.budget);
        }
        if (row.latitude !== null && row.latitude !== undefined) {
            row.latitude = Number(row.latitude);
        }
        if (row.longitude !== null && row.longitude !== undefined) {
            row.longitude = Number(row.longitude);
        }
        return row;
    });
};

app.post('/api/travel-plans', async (req, res) => {
    const { title, description, start_date, end_date, budget, currency, is_public } = req.body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
        console.log('VALIDATION FAILED: Title is invalid');
        return res.status(400).json({ error: 'Validation error' });
    }

    if (title.length > 200) {
        console.log('VALIDATION FAILED: Title too long');
        return res.status(400).json({ error: 'Validation error' });
    }

    if (start_date && !isValidDate(start_date)) {
        console.log('VALIDATION FAILED: Start date invalid');
        return res.status(400).json({ error: 'Validation error' });
    }
    if (end_date && !isValidDate(end_date)) {
        console.log('VALIDATION FAILED: End date invalid');
        return res.status(400).json({ error: 'Validation error' });
    }
    if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        console.log('VALIDATION FAILED: Start date after end date');
        return res.status(400).json({ error: 'Validation error' });
    }

    if (budget !== undefined && budget !== null) {
        if (!isValidNumber(budget)) {
            console.log('VALIDATION FAILED: Budget not a number');
            return res.status(400).json({ error: 'Validation error' });
        }
        if (Number(budget) < 0) {
            console.log('VALIDATION FAILED: Budget negative');
            return res.status(400).json({ error: 'Validation error' });
        }
        const budgetStr = String(budget);
        if (budgetStr.includes('.') && budgetStr.split('.')[1].length > 2) {
            console.log('VALIDATION FAILED: Budget has more than 2 decimal places');
            return res.status(400).json({ error: 'Validation error' });
        }
    }

    if (currency !== undefined && currency !== null) {
        console.log('Currency validation:', {
            type: typeof currency,
            length: currency.length,
            isUpperCase: currency === currency.toUpperCase(),
            value: currency
        });

        if (typeof currency !== 'string') {
            console.log('VALIDATION FAILED: Currency not a string');
            return res.status(400).json({ error: 'Validation error' });
        }
        if (currency.length !== 3) {
            console.log('VALIDATION FAILED: Currency not exactly 3 characters');
            return res.status(400).json({ error: 'Validation error' });
        }
        if (currency !== currency.toUpperCase()) {
            console.log('VALIDATION FAILED: Currency not uppercase. Received:', currency, 'Expected uppercase:', currency.toUpperCase());
            return res.status(400).json({ error: 'Validation error' });
        }
        if (!/^[A-Z]+$/.test(currency)) {
            console.log('VALIDATION FAILED: Currency contains non-letter characters');
            return res.status(400).json({ error: 'Validation error' });
        }
    }

    if (is_public !== undefined && is_public !== null && typeof is_public !== 'boolean') {
        console.log('VALIDATION FAILED: Is_public not boolean');
        return res.status(400).json({ error: 'Validation error' });
    }

    try {
        const result = await query(
            `INSERT INTO travel_plans (title, description, start_date, end_date, budget, currency, is_public)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, title, description, to_char(start_date, 'YYYY-MM-DD') as start_date,
                 to_char(end_date, 'YYYY-MM-DD') as end_date, budget,
                 currency, is_public, version, created_at, updated_at, version as current_version`,
            [title, description, start_date, end_date, budget, currency, is_public]
        );

        const parsedResult = parseBudgetToNumber(result.rows);
        console.log('SUCCESS: Travel plan created with ID:', parsedResult[0].id);
        res.status(201).json(parsedResult[0]);
    } catch (err) {
        console.log('DATABASE ERROR:', err.code, err.message);
        if (err.code && (err.code.startsWith('22') || err.code === '23514')) {
            return res.status(400).json({ error: 'Validation error' });
        }
        handleError(res, err, 400, 'Validation error');
    }
});

app.get('/api/travel-plans/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const planResult = await query(
            `SELECT id, title, description, to_char(start_date, 'YYYY-MM-DD') as start_date,
                    to_char(end_date, 'YYYY-MM-DD') as end_date, budget,
                    currency, is_public, version, created_at, updated_at
             FROM travel_plans WHERE id = $1`,
            [id]
        );
        if (planResult.rowCount === 0) return res.status(404).json({ error: 'Plan not found.' });

        const locationsResult = await query(
            'SELECT *, version as current_version FROM locations WHERE travel_plan_id = $1 ORDER BY visit_order',
            [id]
        );

        const plan = parseBudgetToNumber(planResult.rows)[0];
        plan.locations = parseBudgetToNumber(locationsResult.rows);

        res.status(200).json(plan);
    } catch (err) {
        handleError(res, err, 500);
    }
});

app.put('/api/travel-plans/:id', async (req, res) => {
    const { id } = req.params;
    const { title, description, start_date, end_date, budget, currency, is_public, version } = req.body;

    if (version === undefined || version === null) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (!isValidNumber(version) || Number(version) <= 0) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (title !== undefined && (typeof title !== 'string' || title.trim() === '' || title.length > 200)) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (currency !== undefined && currency !== null) {
        if (typeof currency !== 'string' || currency.length !== 3 || currency !== currency.toUpperCase() || !/^[A-Z]+$/.test(currency)) {
            return res.status(400).json({ error: 'Validation error' });
        }
    }

    if (budget !== undefined && budget !== null) {
        if (!isValidNumber(budget) || Number(budget) < 0) {
            return res.status(400).json({ error: 'Validation error' });
        }
    }

    if (is_public !== undefined && is_public !== null && typeof is_public !== 'boolean') {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (!isValidDate(start_date) || !isValidDate(end_date)) {
        return res.status(400).json({ error: 'Validation error' });
    }
    if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ error: 'Validation error' });
    }

    try {
        const result = await query(
            `UPDATE travel_plans
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
                 currency, is_public, version, created_at, updated_at, version as current_version`,
            [title, description, start_date, end_date, budget, currency, is_public, id, version]
        );

        if (result.rowCount === 0) {
            const checkResult = await query('SELECT version FROM travel_plans WHERE id=$1', [id]);
            if (checkResult.rowCount === 0) return res.status(404).json({ error: 'Plan not found.' });

            return res.status(409).json({
                error: 'Conflict: Plan has been modified',
                current_version: checkResult.rows[0].version
            });
        }

        const parsedResult = parseBudgetToNumber(result.rows);
        res.status(200).json(parsedResult[0]);
    } catch (err) {
        if (err.code && (err.code.startsWith('22') || err.code === '23514')) {
            return res.status(400).json({ error: 'Validation error' });
        }
        handleError(res, err, 400, 'Validation error');
    }
});

app.delete('/api/travel-plans/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM travel_plans WHERE id=$1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Plan not found.' });
        res.status(204).send();
    } catch (err) {
        handleError(res, err, 500);
    }
});

app.post('/api/travel-plans/:id/locations', async (req, res) => {
    const planId = req.params.id;
    const { name, address, latitude, longitude, arrival_date, departure_date, budget, notes } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (name.length > 200) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (!isValidCoordinate(latitude, 'latitude')) {
        return res.status(400).json({ error: 'Validation error' });
    }
    if (!isValidCoordinate(longitude, 'longitude')) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (budget !== undefined && budget !== null && !isValidNumber(budget)) {
        return res.status(400).json({ error: 'Validation error' });
    }
    if (budget !== undefined && budget !== null && Number(budget) < 0) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (arrival_date && departure_date && new Date(arrival_date) > new Date(departure_date)) {
        return res.status(400).json({ error: 'Validation error' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const planCheck = await client.query('SELECT 1 FROM travel_plans WHERE id=$1 FOR UPDATE', [planId]);
        if (planCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Travel Plan not found.' });
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

        const parsedResult = parseBudgetToNumber(insertResult.rows);
        res.status(201).json(parsedResult[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            handleError(res, err, 409, 'Conflict: Could not determine unique visit order.');
        } else if (err.code && (err.code.startsWith('22') || err.code === '23514')) {
            return res.status(400).json({ error: 'Validation error' });
        } else {
            handleError(res, err, 400, 'Validation error');
        }
    } finally {
        client.release();
    }
});

app.put('/api/locations/:id', async (req, res) => {
    const { id } = req.params;
    const { version, name, address, latitude, longitude, visit_order, arrival_date, departure_date, budget, notes } = req.body;

    let currentVersion = version;

    if (currentVersion === undefined || currentVersion === null) {
        try {
            const versionResult = await query('SELECT version FROM locations WHERE id = $1', [id]);
            if (versionResult.rowCount === 0) {
                return res.status(404).json({ error: 'Location not found.' });
            }
            currentVersion = versionResult.rows[0].version;
        } catch (err) {
            return res.status(400).json({ error: 'Validation error' });
        }
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
        return res.status(400).json({ error: 'Validation error' });
    }
    if (name !== undefined && name.length > 200) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (latitude !== undefined && !isValidCoordinate(latitude, 'latitude')) {
        return res.status(400).json({ error: 'Validation error' });
    }
    if (longitude !== undefined && !isValidCoordinate(longitude, 'longitude')) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (budget !== undefined && budget !== null && !isValidNumber(budget)) {
        return res.status(400).json({ error: 'Validation error' });
    }
    if (budget !== undefined && budget !== null && Number(budget) < 0) {
        return res.status(400).json({ error: 'Validation error' });
    }

    if (arrival_date && departure_date && new Date(arrival_date) > new Date(departure_date)) {
        return res.status(400).json({ error: 'Validation error' });
    }

    try {
        const processedBudget = budget !== undefined ? Number(budget) : undefined;

        const result = await query(
            `UPDATE locations
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
                       arrival_date, departure_date, budget, notes, version, created_at, updated_at, version as current_version`,
            [name, address, latitude, longitude, visit_order, arrival_date, departure_date, processedBudget, notes, id, currentVersion]
        );

        if (result.rowCount === 0) {
            const checkResult = await query('SELECT version FROM locations WHERE id=$1', [id]);
            if (checkResult.rowCount === 0) return res.status(404).json({ error: 'Location not found.' });

            return res.status(409).json({
                error: 'Conflict: Location has been modified',
                current_version: checkResult.rows[0].version
            });
        }

        const parsedResult = parseBudgetToNumber(result.rows);
        res.status(200).json(parsedResult[0]);
    } catch (err) {
        if (err.code === '23505') {
            handleError(res, err, 409, 'Conflict: Visit order already exists for this plan.');
        } else if (err.code && (err.code.startsWith('22') || err.code === '23514')) {
            return res.status(400).json({ error: 'Validation error' });
        } else {
            handleError(res, err, 400, 'Validation error');
        }
    }
});

app.delete('/api/locations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('DELETE FROM locations WHERE id=$1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Location not found.' });
        res.status(204).send();
    } catch (err) {
        handleError(res, err, 500);
    }
});

app.listen(port, () => {
    console.log(`TravelerAPI running on http://localhost:${port}`);
});