-- Conexão Transportes - PostgreSQL Schema

CREATE TABLE IF NOT EXISTS collaborators (
    id SERIAL PRIMARY KEY,
    matricula VARCHAR(50) UNIQUE,
    cpf VARCHAR(20) UNIQUE,
    nome VARCHAR(150) NOT NULL,
    cargo VARCHAR(100),
    departamento VARCHAR(100),
    diretoria VARCHAR(100),
    email VARCHAR(150),
    tipo_vinculo VARCHAR(20) DEFAULT 'GLOBO',
    empresa VARCHAR(100) DEFAULT 'Globo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accredited (
    id SERIAL PRIMARY KEY,
    documento VARCHAR(50) UNIQUE, -- CPF ou RG
    nome VARCHAR(150) NOT NULL,
    cargo VARCHAR(100),
    area VARCHAR(100),
    diretoria VARCHAR(100),
    empresa VARCHAR(100),
    tipo_vinculo VARCHAR(20) DEFAULT 'TERCEIRO',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR(50) PRIMARY KEY,
    matricula VARCHAR(50),
    cpf VARCHAR(20),
    nome VARCHAR(150),
    cargo VARCHAR(100),
    departamento VARCHAR(100),
    diretoria VARCHAR(100),
    data VARCHAR(20) NOT NULL,
    hora VARCHAR(10) NOT NULL,
    origem VARCHAR(100) NOT NULL,
    destino VARCHAR(100) NOT NULL,
    tipo_servico VARCHAR(50),
    acompanhante VARCHAR(10),
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
