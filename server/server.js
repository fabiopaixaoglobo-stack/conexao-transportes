require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public'))); // Assuming we move frontend to public, or we just serve root?
app.use(express.static(path.join(__dirname, '../'))); // For now, serve root to avoid moving files during migration

// PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// APIs

app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', time: new Date() });
});

// GET All Collaborators
app.get('/api/collaborators', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM collaborators');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET All Accredited
app.get('/api/accredited', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM accredited');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET All Bookings
app.get('/api/bookings', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM bookings WHERE status != 'Cancelado'");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST Create Booking
app.post('/api/bookings/create', async (req, res) => {
    const { id, matricula, cpf, nome, cargo, departamento, diretoria, data, hora, origem, destino, tipo_servico, acompanhante, canal, uploaded_at } = req.body;
    try {
        const query = `
            INSERT INTO bookings (id, matricula, cpf, nome, cargo, departamento, diretoria, data, hora, origem, destino, tipo_servico, acompanhante, canal, uploaded_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `;
        const values = [id, matricula, cpf, nome, cargo, departamento, diretoria, data, hora, origem, destino, tipo_servico, acompanhante, canal, uploaded_at || new Date()];
        await pool.query(query, values);
        res.json({ success: true, id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// POST Bulk Bookings (Excel Uploads)
app.post('/api/bookings/bulk', async (req, res) => {
    const { bookings } = req.body;
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const b of bookings) {
                const query = `
                    INSERT INTO bookings (id, matricula, cpf, nome, cargo, departamento, diretoria, data, hora, origem, destino, tipo_servico, acompanhante, canal, uploaded_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    ON CONFLICT (id) DO NOTHING
                `;
                const values = [b.id, b.matricula, b.cpf, b.nome, b.cargo, b.departamento, b.diretoria, b.data, b.hora, b.origem, b.destino, b.tipo_servico, b.acompanhante, b.canal, b.uploaded_at || new Date()];
                await client.query(query, values);
            }
            await client.query('COMMIT');
            res.json({ success: true, count: bookings.length });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to insert bulk bookings' });
    }
});

// POST Cancel Booking
app.post('/api/bookings/cancel', async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query("UPDATE bookings SET status = 'Cancelado' WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});

// Serve index.html for all other routes (SPA fallback)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Conexão Transportes Backend running on port ${PORT}`);
});
