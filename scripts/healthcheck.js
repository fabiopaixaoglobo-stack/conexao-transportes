require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runHealthCheck() {
    console.log("=== INICIANDO VERIFICAÇÃO DE INTEGRIDADE DO SISTEMA ===");
    const client = await pool.connect();
    let hasErrors = false;

    try {
        // 1. Verificar Conexão e Tabelas
        console.log("[1/4] Verificando conexão e tabelas principais...");
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        const requiredTables = ['collaborators', 'accredited', 'bookings'];
        
        const missingTables = requiredTables.filter(t => !tables.includes(t));
        if (missingTables.length > 0) {
            console.error(`❌ FALHA CRÍTICA: Tabelas ausentes no banco de dados: ${missingTables.join(', ')}`);
            hasErrors = true;
        } else {
            console.log(`✅ Todas as tabelas principais estão presentes.`);
        }

        if (!hasErrors) {
            // 2. Verificar Volume de Dados (Sinalizar se as bases base estiverem vazias)
            console.log("[2/4] Verificando volumetria das bases...");
            const colabCount = await client.query('SELECT COUNT(*) FROM collaborators');
            const accCount = await client.query('SELECT COUNT(*) FROM accredited');
            
            if (parseInt(colabCount.rows[0].count) === 0) {
                console.warn(`⚠️ ALERTA: A tabela 'collaborators' está vazia. Não será possível validar matrículas internas.`);
                hasErrors = true;
            }
            if (parseInt(accCount.rows[0].count) === 0) {
                console.warn(`⚠️ ALERTA: A tabela 'accredited' (Terceiros) está vazia.`);
                hasErrors = true;
            }

            // 3. Verificar Integridade dos Agendamentos
            console.log("[3/4] Verificando integridade relacional dos agendamentos...");
            const orphanBookings = await client.query(`
                SELECT b.id, b.matricula, b.cpf, b.nome 
                FROM bookings b
                LEFT JOIN collaborators c ON b.matricula = c.matricula OR b.cpf = c.cpf
                LEFT JOIN accredited a ON b.matricula = a.documento OR b.cpf = a.documento
                WHERE c.matricula IS NULL AND a.documento IS NULL
            `);

            if (orphanBookings.rows.length > 0) {
                console.warn(`⚠️ ALERTA: Encontrados ${orphanBookings.rows.length} agendamentos de passageiros que não constam nas bases de Colaboradores ou Terceiros.`);
                hasErrors = true;
                // Exibe no máximo 5 como exemplo
                console.log("   Exemplos de anomalias:", orphanBookings.rows.slice(0, 5));
            } else {
                console.log(`✅ Não há agendamentos órfãos. Todos os passageiros estão mapeados nas bases.`);
            }

            // 4. Verificar Status de Erro ou Duplicação
            console.log("[4/4] Verificando duplicação de agendamentos no mesmo dia/hora/sentido...");
            const duplicates = await client.query(`
                SELECT matricula, data, hora, origem, destino, COUNT(*) as qtd
                FROM bookings
                WHERE status != 'Cancelado'
                GROUP BY matricula, data, hora, origem, destino
                HAVING COUNT(*) > 1
            `);

            if (duplicates.rows.length > 0) {
                console.warn(`⚠️ ALERTA: Foram encontrados ${duplicates.rows.length} casos de agendamentos duplicados (mesmo passageiro, data, hora e trajeto).`);
                hasErrors = true;
                console.log("   Exemplos de duplicação:", duplicates.rows.slice(0, 5));
            } else {
                console.log(`✅ Sem agendamentos duplicados.`);
            }
        }

    } catch (e) {
        console.error("❌ FALHA AO EXECUTAR HEALTHCHECK:", e);
        hasErrors = true;
    } finally {
        client.release();
        pool.end();
    }

    console.log("=== RELATÓRIO FINAL ===");
    if (hasErrors) {
        console.log("🔴 STATUS: Foram detectadas anomalias ou alertas. O administrador deve investigar e corrigir a origem dos dados.");
        process.exit(1);
    } else {
        console.log("🟢 STATUS: Banco de dados ÍNTEGRO. Nenhuma falha detectada.");
        process.exit(0);
    }
}

runHealthCheck();
