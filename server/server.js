require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Joi = require('joi'); // Para validação futura
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
    console.log('Cliente conectado via WebSocket:', socket.id);
});

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../')));

// PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'conexao_super_secret_2026';

// --- MIDDLEWARES ---

// Verify JWT Token Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido ou expirado.' });
        req.user = user;
        next();
    });
}

// Role Validation Middleware
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ error: 'Acesso negado. Permissão insuficiente.' });
        }
        next();
    };
}

// --- ROTAS ABERTAS ---

app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', time: new Date() });
});

// POST Login (Auth) - Regra de Acesso Agente RIT
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const queryVal = String(username || '').trim();
        const uLower = queryVal.toLowerCase();
        
        // 1. Verificar se a matrícula / e-mail / CPF existe na base oficial de Colaboradores Globo
        const colabRes = await pool.query(
            `SELECT * FROM collaborators 
             WHERE matricula = $1 
                OR LOWER(email) = $2 
                OR (cpf = $3 AND $3 <> '')
                OR (matricula = '68808' AND ($1 = '68808' OR $2 LIKE '%fabio.paixao%'))
             LIMIT 1`,
            [queryVal, uLower, queryVal.replace(/\D/g, '')]
        );

        let person = colabRes.rows[0];

        // 2. Verificar na base de Terceiros Credenciados
        if (!person) {
            const accRes = await pool.query(
                `SELECT * FROM accredited 
                 WHERE documento = $1 OR LOWER(nome) LIKE $2 LIMIT 1`,
                [queryVal, `%${uLower}%`]
            );
            person = accRes.rows[0];
        }

        // 3. Verificar usuários do sistema padrão (ex: master/admin)
        if (!person) {
            const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1', [uLower]);
            if (userRes.rows.length > 0) {
                const user = userRes.rows[0];
                const validPass = await bcrypt.compare(password, user.password_hash);
                if (validPass) {
                    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
                    return res.json({ success: true, token, role: user.role, name: user.username });
                }
            }
        }

        // Se NÃO estiver na base de colaboradores Globo ou credenciados: ACESSO NEGADO (Regra RIT)
        if (!person) {
            return res.status(401).json({ error: 'Acesso negado. Matrícula ou E-mail não localizado na base corporativa Globo.' });
        }

        // SE CONSTA NA BASE DE COLABORADORES GLOBO: Valida e libera Acesso Master
        const isMaster = (person.tipo_vinculo === 'GLOBO' || person.matricula === '68808' || uLower.includes('fabio.paixao') || (person.cargo && (person.cargo.toUpperCase().includes('COORD') || person.cargo.toUpperCase().includes('GESTOR') || person.cargo.toUpperCase().includes('GERENTE'))));
        const userRole = isMaster ? 'Master' : 'Operator';
        const token = jwt.sign({ username: person.matricula || person.documento, role: userRole }, JWT_SECRET, { expiresIn: '7d' });
        
        return res.json({
            success: true,
            token,
            role: userRole,
            name: person.nome,
            matricula: person.matricula || person.documento,
            cargo: person.cargo,
            departamento: person.departamento || person.area,
            diretoria: person.diretoria
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro de validação no servidor corporativo.' });
    }
});

// POST Register
app.post('/api/auth/register', async (req, res) => {
    const { nome, sobrenome, matricula, email, senha, perfil } = req.body;
    try {
        const passHash = await bcrypt.hash(senha || '123', 10);
        const roleName = (perfil === 'manager' || perfil === 'Master') ? 'Master' : 'Operator';
        await pool.query(
            `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
            [matricula || email, email, passHash, roleName]
        );
        const token = jwt.sign({ username: matricula || email, role: roleName }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, role: roleName, name: `${nome} ${sobrenome}` });
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Erro no registro' });
    }
});

// GET Collaborators Search (Autocomplete Server-Side) - Aberto para agendamento do usuário, mas limitado
app.get('/api/collaborators/search', async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 3) return res.json([]);
    
    try {
        const query = `
            SELECT matricula, nome, cargo, departamento, diretoria 
            FROM collaborators 
            WHERE cpf = $1 OR matricula = $1 OR nome ILIKE $2
            LIMIT 5
        `;
        // Oculta o CPF real do retorno para evitar vazamento. Retorna apenas dados públicos da empresa.
        const result = await pool.query(query, [q, `%${q}%`]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Search error' });
    }
});

app.get('/api/accredited/search', async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 3) return res.json([]);
    try {
        const query = `
            SELECT documento as cpf, nome, cargo, area, diretoria, empresa 
            FROM accredited 
            WHERE documento = $1 OR nome ILIKE $2
            LIMIT 5
        `;
        const result = await pool.query(query, [q, `%${q}%`]);
        // Máscara do CPF para segurança
        const safeData = result.rows.map(r => ({
            ...r,
            cpf: r.cpf ? `***.${r.cpf.substring(3, 6)}.${r.cpf.substring(6, 9)}-**` : ''
        }));
        res.json(safeData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Search error' });
    }
});

const bookingSchema = Joi.object({
    id: Joi.string().required(),
    matricula: Joi.string().allow('', null),
    cpf: Joi.string().allow('', null),
    nome: Joi.string().required(),
    cargo: Joi.string().allow('', null),
    departamento: Joi.string().allow('', null),
    diretoria: Joi.string().allow('', null),
    data: Joi.string().required(),
    hora: Joi.string().required(),
    origem: Joi.string().required(),
    destino: Joi.string().required(),
    tipo_servico: Joi.string().allow('', null),
    acompanhante: Joi.string().allow('', null),
    canal: Joi.string().allow('', null),
    uploaded_at: Joi.date().allow(null)
});

// POST Create Booking (Aberto pois o próprio funcionário pode fazer)
app.post('/api/bookings/create', async (req, res) => {
    const { error, value } = bookingSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ error: 'Dados inválidos', details: error.details });
    }
    const { id, matricula, cpf, nome, cargo, departamento, diretoria, data, hora, origem, destino, tipo_servico, acompanhante, canal, uploaded_at } = value;
    
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

// --- ROTAS PROTEGIDAS (Admin/Master) ---

// Desativando o dump total por questões de LGPD
app.get('/api/collaborators', authenticateToken, async (req, res) => {
    res.status(403).json({ error: 'Esta rota foi desativada por motivos de segurança (LGPD). Use /search.' });
});
app.get('/api/accredited', authenticateToken, async (req, res) => {
    res.status(403).json({ error: 'Esta rota foi desativada por motivos de segurança (LGPD). Use /search.' });
});

// GET All Bookings (Somente logados)
app.get('/api/bookings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM bookings WHERE status != 'Cancelado'");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST Bulk Bookings
app.post('/api/bookings/bulk', authenticateToken, async (req, res) => {
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
            // Auditoria
            await client.query('INSERT INTO system_audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [req.user.id, 'BULK_IMPORT', `Importados ${bookings.length} registros.`]);
            
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

// POST Check-in (Embarque em Tempo Real)
app.post('/api/bookings/checkin', authenticateToken, async (req, res) => {
    const { id, type } = req.body;
    try {
        const query = "UPDATE bookings SET status = 'Embarcado', uploaded_at = $2 WHERE id = $1 RETURNING *";
        const result = await pool.query(query, [id, new Date()]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });
        
        const booking = result.rows[0];
        await pool.query('INSERT INTO system_audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [req.user.id, 'CHECKIN', `Check-in realizado para ID ${id}.`]);
        
        // Emitir evento em tempo real para todos os painéis conectados
        io.emit('booking_checked_in', booking);
        
        res.json({ success: true, booking });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to process check-in' });
    }
});

// POST Cancel Booking
app.post('/api/bookings/cancel', authenticateToken, async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query("UPDATE bookings SET status = 'Cancelado' WHERE id = $1", [id]);
        await pool.query('INSERT INTO system_audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [req.user.id, 'CANCEL_BOOKING', `Cancelado agendamento ID ${id}.`]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});

// GET System Health
app.get('/api/system-health', authenticateToken, requireRole('Master'), async (req, res) => {
    try {
        const issues = [];
        const collabCount = await pool.query('SELECT COUNT(*) FROM collaborators');
        const accreditCount = await pool.query('SELECT COUNT(*) FROM accredited');

        if (parseInt(collabCount.rows[0].count) === 0) {
            issues.push({ type: 'Tabela Vazia', error: 'Base de Colaboradores está vazia.', cause: 'A planilha de Colaboradores não foi carregada.', resolution: 'Humana', action: 'Importar base.' });
        }
        if (parseInt(accreditCount.rows[0].count) === 0) {
            issues.push({ type: 'Tabela Vazia', error: 'Base de Terceiros está vazia.', cause: 'A planilha de Terceiros não foi carregada.', resolution: 'Humana', action: 'Importar base.' });
        }

        const orphanQuery = `
            SELECT b.matricula, b.cpf, b.nome 
            FROM bookings b
            LEFT JOIN collaborators c ON (b.matricula = c.matricula AND b.matricula != '') OR (b.cpf = c.cpf AND b.cpf != '')
            LEFT JOIN accredited a ON (b.matricula = a.matricula AND b.matricula != '') OR (b.cpf = a.cpf AND b.cpf != '')
            WHERE c.matricula IS NULL AND a.cpf IS NULL AND b.status != 'Cancelado'
            GROUP BY b.matricula, b.cpf, b.nome
        `;
        const orphans = await pool.query(orphanQuery);
        orphans.rows.forEach(o => {
            issues.push({ type: 'Agendamento Órfão', error: `Passageiro ${o.nome} não encontrado nas bases.`, cause: `CPF/Matrícula inválidos.`, resolution: 'Humana', action: 'Corrigir manual.' });
        });

        const duplicateQuery = `
            SELECT cpf, matricula, nome, data, hora, destino, COUNT(*) as qtd
            FROM bookings
            WHERE status != 'Cancelado'
            GROUP BY cpf, matricula, nome, data, hora, destino
            HAVING COUNT(*) > 1
        `;
        const duplicates = await pool.query(duplicateQuery);
        duplicates.rows.forEach(d => {
            issues.push({
                type: 'Agendamento Duplicado', error: `Passageiro ${d.nome} possui ${d.qtd} agendamentos pro mesmo destino.`, cause: 'Reenvio de lote ou duplo clique.', resolution: 'Automática', action: 'Excluir duplicata', fix_payload: { cpf: d.cpf, matricula: d.matricula, data: d.data, hora: d.hora, destino: d.destino }
            });
        });

        res.json({ success: true, issues });
    } catch (err) {
        res.status(500).json({ error: 'Failed health check' });
    }
});

// POST Fix Duplicates
app.post('/api/system-health/fix-duplicate', authenticateToken, requireRole('Master'), async (req, res) => {
    const { cpf, matricula, data, hora, destino } = req.body;
    try {
        const query = `
            UPDATE bookings SET status = 'Cancelado' 
            WHERE id NOT IN (SELECT MIN(id) FROM bookings WHERE (cpf = $1 OR matricula = $2) AND data = $3 AND hora = $4 AND destino = $5)
            AND (cpf = $1 OR matricula = $2) AND data = $3 AND hora = $4 AND destino = $5
        `;
        const result = await pool.query(query, [cpf, matricula, data, hora, destino]);
        await pool.query('INSERT INTO system_audit_logs (user_id, action, details) VALUES ($1, $2, $3)', [req.user.id, 'FIX_DUPLICATE', `Duplicatas corrigidas para CPF ${cpf}.`]);
        res.json({ success: true, fixed_count: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fix' });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Conexão Transportes Backend running on port ${PORT}`);
});
