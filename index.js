const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
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

app.get('/health', async (req, res) => {
    try {
        const shardStatus = await db.getShardStatus();
        res.status(200).json({
            status: 'healthy',
            api_version: '1.0',
            shards: shardStatus
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

app.get('/shards/info', async (req, res) => {
    try {
        const shardInfo = await db.getShardInfo();
        res.status(200).json(shardInfo);
    } catch (error) {
        handleError(res, error);
    }
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
        const id = uuidv4();

        const result = await db.createTravelPlan(
            id, title, description, start_date, end_date, budget, currency, is_public
        );

        const parsedResult = parseBudgetToNumber(result.rows);
        console.log('SUCCESS: Travel plan created with ID:', parsedResult[0].id, 'on shard:', result.shard);
        res.status(201).json({
            ...parsedResult[0],
            shard: result.shard
        });
    } catch (err) {
        console.log('DATABASE ERROR:', err.code, err.message);
        if (err.code && (err.code.startsWith('22') || err.code === '23514')) {
            return res.status(400).json({ error: 'Validation error' });
        }
        handleError(res, err, 400, 'Validation error');
    }
});

app.get('/api/travel-plans', async (req, res) => {
    try {
        const result = await db.getAllTravelPlans();
        const parsedResult = parseBudgetToNumber(result.rows);
        res.status(200).json(parsedResult);
    } catch (err) {
        handleError(res, err, 500);
    }
});

app.get('/api/travel-plans/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const planResult = await db.getTravelPlanById(id);
        if (!planResult.rows || planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found.' });
        }

        const locationsResult = await db.getLocationsByTravelPlanId(id);

        const plan = parseBudgetToNumber(planResult.rows)[0];
        plan.locations = parseBudgetToNumber(locationsResult.rows);
        plan.shard = planResult.shard;

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
        const result = await db.updateTravelPlan(
            id, title, description, start_date, end_date, budget, currency, is_public, version
        );

        if (result.rowCount === 0) {
            const checkResult = await db.getTravelPlanById(id);
            if (!checkResult.rows || checkResult.rows.length === 0) {
                return res.status(404).json({ error: 'Plan not found.' });
            }

            return res.status(409).json({
                error: 'Conflict: Plan has been modified',
                current_version: checkResult.rows[0].version
            });
        }

        const parsedResult = parseBudgetToNumber(result.rows);
        res.status(200).json({
            ...parsedResult[0],
            shard: result.shard
        });
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
        const result = await db.deleteTravelPlan(id);
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

    try {
        const result = await db.createLocation(
            planId, name, address, latitude, longitude, arrival_date, departure_date, budget, notes
        );

        const parsedResult = parseBudgetToNumber(result.rows);
        res.status(201).json(parsedResult[0]);
    } catch (err) {
        if (err.code === '23505') {
            handleError(res, err, 409, 'Conflict: Could not determine unique visit order.');
        } else if (err.code && (err.code.startsWith('22') || err.code === '23514')) {
            return res.status(400).json({ error: 'Validation error' });
        } else if (err.message.includes('Travel Plan not found')) {
            return res.status(404).json({ error: 'Travel Plan not found.' });
        } else {
            handleError(res, err, 400, 'Validation error');
        }
    }
});

app.put('/api/locations/:id', async (req, res) => {
    const { id } = req.params;
    const { version, name, address, latitude, longitude, visit_order, arrival_date, departure_date, budget, notes } = req.body;

    let currentVersion = version;

    // Якщо версія не надана, отримуємо поточну
    if (currentVersion === undefined || currentVersion === null) {
        try {
            const versionResult = await db.getLocationById(id);
            if (!versionResult.rows || versionResult.rows.length === 0) {
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

        const result = await db.updateLocation(
            id, name, address, latitude, longitude, visit_order, arrival_date, departure_date, processedBudget, notes, currentVersion
        );

        if (result.rowCount === 0) {
            const checkResult = await db.getLocationById(id);
            if (!checkResult.rows || checkResult.rows.length === 0) {
                return res.status(404).json({ error: 'Location not found.' });
            }

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
        const result = await db.deleteLocation(id);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Location not found.' });
        res.status(204).send();
    } catch (err) {
        handleError(res, err, 500);
    }
});

app.listen(port, () => {
    console.log(`TravelerAPI running on http://localhost:${port}`);
});