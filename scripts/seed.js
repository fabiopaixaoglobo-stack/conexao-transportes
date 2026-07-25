require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runSeed() {
    console.log("Iniciando migração e seed do banco de dados...");
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Criar Tabelas
        const schemaPath = path.join(__dirname, '../server/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        console.log("Executando schema.sql...");
        await client.query(schema);

        // 2. Limpar Tabelas existentes (para garantir frescor)
        console.log("Limpando dados antigos de colaboradores e terceiros...");
        await client.query('TRUNCATE TABLE collaborators RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE accredited RESTART IDENTITY CASCADE');

        // 3. Ler Colaboradores
        console.log("Lendo Base de Colaboradores...");
        const colabFile = path.join(__dirname, '../Base de Colaboradores Globo - Julho 2026 v2.xlsx');
        if (fs.existsSync(colabFile)) {
            const wb = xlsx.readFile(colabFile);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = xlsx.utils.sheet_to_json(sheet);
            
            console.log(`Inserindo ${rows.length} colaboradores...`);
            for (let r of rows) {
                const query = `
                    INSERT INTO collaborators (matricula, cpf, nome, cargo, gerencia, departamento, diretoria, email, tipo_vinculo, empresa)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GLOBO', 'Globo')
                    ON CONFLICT (matricula) DO UPDATE SET 
                        email = EXCLUDED.email,
                        nome = EXCLUDED.nome,
                        cargo = EXCLUDED.cargo,
                        gerencia = EXCLUDED.gerencia,
                        departamento = EXCLUDED.departamento,
                        diretoria = EXCLUDED.diretoria,
                        tipo_vinculo = 'GLOBO',
                        empresa = 'Globo'
                `;
                const values = [
                    String(r['Matricula'] || ''),
                    String(r['CPF'] || '').replace(/\D/g, ''),
                    r['Nome Funcionário'] || '',
                    r['Cargo'] || '',
                    r['Gerência'] || '', // Coluna G: Gerência (ex: LOGISTICA E TRANSPORTE)
                    r['Departamento'] || '',
                    r['N1'] || r['Diretoria Executiva'] || '',
                    String(r['E-mail'] || r['email'] || '').toLowerCase().trim()
                ];
                await client.query(query, values);
            }
        } else {
            console.log("Arquivo de Colaboradores não encontrado, pulando...");
        }

        // 4. Ler Terceiros
        console.log("Lendo Base de Terceiros...");
        const tercFile = path.join(__dirname, '../Base de Terceiros Globo - Julho 2026.xlsx');
        if (fs.existsSync(tercFile)) {
            const wb = xlsx.readFile(tercFile);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = xlsx.utils.sheet_to_json(sheet);

            console.log(`Inserindo ${rows.length} terceiros...`);
            for (let r of rows) {
                const query = `
                    INSERT INTO accredited (documento, nome, cargo, area, diretoria, empresa)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (documento) DO NOTHING
                `;
                // As colunas no arquivo: cpf/documento, nomeFuncionario, Cargo, Área, Diretoria Central, Empresa
                const documento = String(r['cpf'] || r['documento'] || '').replace(/\D/g, '');
                if (!documento) continue;
                
                const values = [
                    documento,
                    r['nomeFuncionario'] || '',
                    r['Cargo'] || '',
                    r['Área'] || '',
                    r['Diretoria Central'] || '',
                    r['Empresa'] || ''
                ];
                await client.query(query, values);
            }
        } else {
            console.log("Arquivo de Terceiros não encontrado, pulando...");
        }

        // 5. Inserir Usuário Master
        console.log("Criando usuário master padrão...");
        const masterPassHash = await bcrypt.hash('master123', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (username) DO NOTHING
        `, ['master', masterPassHash, 'Master']);

        await client.query('COMMIT');
        console.log("Migração e Seed finalizados com sucesso!");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Erro durante o seed:", e);
    } finally {
        client.release();
        pool.end();
    }
}

runSeed();
