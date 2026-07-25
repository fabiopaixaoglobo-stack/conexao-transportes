-- Conexão Transportes - PostgreSQL Schema

CREATE TABLE IF NOT EXISTS collaborators (
    id SERIAL PRIMARY KEY,
    matricula VARCHAR(50) UNIQUE,
    cpf VARCHAR(20) UNIQUE,
    nome VARCHAR(255) NOT NULL,
    cargo TEXT,
    gerencia TEXT,
    departamento TEXT,
    diretoria TEXT,
    email VARCHAR(255),
    tipo_vinculo VARCHAR(50) DEFAULT 'GLOBO',
    empresa VARCHAR(255) DEFAULT 'Globo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accredited (
    id SERIAL PRIMARY KEY,
    documento VARCHAR(50) UNIQUE, -- CPF ou RG
    nome VARCHAR(255) NOT NULL,
    cargo TEXT,
    area TEXT,
    diretoria TEXT,
    empresa VARCHAR(255),
    tipo_vinculo VARCHAR(50) DEFAULT 'TERCEIRO',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR(50) PRIMARY KEY,
    matricula VARCHAR(50),
    cpf VARCHAR(20),
    nome VARCHAR(255),
    cargo TEXT,
    departamento TEXT,
    diretoria TEXT,
    data VARCHAR(20) NOT NULL,
    hora VARCHAR(10) NOT NULL,
    origem VARCHAR(100) NOT NULL,
    destino VARCHAR(100) NOT NULL,
    tipo_servico VARCHAR(100),
    acompanhante VARCHAR(50),
    canal VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Agendado',
    trip_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_at TIMESTAMP
);

-- Index para otimizar busca de passageiros por data (relatórios)
CREATE INDEX IF NOT EXISTS idx_bookings_data ON bookings(data);
CREATE INDEX IF NOT EXISTS idx_bookings_matricula ON bookings(matricula);
CREATE INDEX IF NOT EXISTS idx_bookings_cpf ON bookings(cpf);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(255) NOT NULL,
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
