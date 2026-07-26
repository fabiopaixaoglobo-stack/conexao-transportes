
function saveBookingsLocal() {
    try {
        if (db && db.bookings) {
            safeStorage.local.setItem('rig_bookings', JSON.stringify(db.bookings));
        }
    } catch(e) { console.error('Error saving bookings to localStorage:', e); }
}

// Conexão Transportes - Application Engine
// Lógica do Front-end e Gerenciamento de Estado (Persistência via localStorage)

document.addEventListener('DOMContentLoaded', () => {
    // Clear old localStorage mock database to ensure fresh fetch from PostgreSQL
    try { window.localStorage.removeItem('conexao_transportes_db'); } catch(e) {}
});

let db = {};

// Safe localStorage/sessionStorage wrapper for file:// protocol support in corporate networks
const safeStorage = {
    session: {
        getItem(key) {
            try { return window.sessionStorage.getItem(key); } catch(e) { return this[key] || null; }
        },
        setItem(key, val) {
            try { window.sessionStorage.setItem(key, val); } catch(e) { this[key] = String(val); }
        },
        removeItem(key) {
            try { window.sessionStorage.removeItem(key); } catch(e) { delete this[key]; }
        }
    },
    local: {
        getItem(key) {
            try { return window.localStorage.getItem(key); } catch(e) { return this[key] || null; }
        },
        setItem(key, val) {
            try { window.localStorage.setItem(key, val); } catch(e) { this[key] = String(val); }
        },
        removeItem(key) {
            try { window.localStorage.removeItem(key); } catch(e) { delete this[key]; }
        }
    }
};

// --- ESTADO GLOBAL DA APLICA�!ÒO ---
// let db = null;
let currentTab = 'passenger';
let currentSubTab = 'graphs';
let currentRegional = 'RJ';
let currentEvent = 'RIR'; // RIR = Rock in Rio 2026, CARNAVAL = Carnaval 2026
let currentDirection = 'VAI'; // VAI (Globo -> Evento), VEM (Evento -> Globo)

// --- ESTADO DE RESERVAS PENDENTES (REVISÒO INTERATIVA) ---
let pendingBookings = [];
let pendingBookingSource = ''; // 'pre' (individual), 'pass' (totem check-in), 'bulk' (excel import)
let pendingBookingServiceType = '';
let pendingBookingAccompany = '';
let isProcessingBooking = false;

// Instâncias dos Gráficos (Chart.js)
let jbChartInstance = null;
let egChartInstance = null;
let ionChartInstance = null;

// --- INICIALIZA�!ÒO ---
document.addEventListener("DOMContentLoaded", async () => {
    await initDatabase();
    checkTestEnvironment();
    setupEventHandlers();
    
    // Check URL parameters for direct driver role access
    checkUrlRoleParameter();
    
    // Configura��es iniciais de telas
    let savedRole = safeStorage.session.getItem('conexao_role');
    const token = safeStorage.local.getItem('rig_token');
    const userJson = safeStorage.local.getItem('rig_user');

    if (!savedRole && token && userJson) {
        try {
            const user = JSON.parse(userJson);
            savedRole = (user.perfil && (user.perfil.toLowerCase() === 'master' || user.perfil.toLowerCase() === 'manager')) ? 'manager' : 'operator';
            safeStorage.session.setItem('conexao_role', savedRole);
        } catch(e) {}
    }

    if (savedRole) {
        selectRole(savedRole);
        
        // If driver role is active, check profile authentication state
        if (savedRole === 'driver') {
            const profileJson = safeStorage.local.getItem('conexao_driver_profile');
            if (profileJson) {
                const profile = JSON.parse(profileJson);
                loadDriverConfigFromProfile(profile);
                document.getElementById('driver-cpf-panel').classList.add('hidden');
                document.getElementById('driver-config-form').classList.remove('hidden');
            } else {
                document.getElementById('driver-cpf-panel').classList.remove('hidden');
                document.getElementById('driver-config-form').classList.add('hidden');
            }
        }
    } else {
        const welcome = document.getElementById('welcome-portal');
        if (welcome) welcome.classList.remove('hidden');
    }
    
    // Load completed trips log on CCO side
    updateCompletedTripsList();
    
    populateDateSelectors();
    updateEventLabels();
    
    // Atualizar horários dos agendamentos
    updatePreBookingTimes();
    updateAvailableTimes();
    
    // Renderizar checklists de replicação
    renderReplicationCheckboxes();
    
    // Gerar QR codes do Totem Modal
    generateTotemQRCodes();
    
    // Check local SMTP backend status
    checkBackendStatus();
    
    // Setup file drag and drop listeners
    setupFileDropListeners();
    
    // Render initial database tables
    renderCollaboratorDatabaseTable();
    renderAccreditedDatabaseTable();
    
    // Check for checkin or ticket parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const checkinId = urlParams.get('checkin');
    const ticketId = urlParams.get('ticket');
    
    if (checkinId) {
        setTimeout(() => {
            handleQuickCheckinUrl(checkinId);
        }, 800);
    } else if (ticketId) {
        setTimeout(() => {
            showTicketFromUrl(ticketId);
        }, 800);
    }
});

// --- HELPER DE CONSULTA DE DADOS DE EVENTOS ---
function getEventDates() {
    if (currentEvent === 'RIR') {
        return ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-11', '2026-09-12', '2026-09-13'];
    } else {
        return ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-21'];
    }
}

function getAvailableHours(direction, event, base) {
    const evt = event || currentEvent;
    if (evt === 'RIR') {
        if (direction === 'VAI') {
            const b = base || 'EG';
            if (b === 'EG') {
                return ['10:00', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30', '19:00'];
            } else {
                return ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
            }
        } else {
            return ['19:30', '20:30', '21:30', '22:30', '23:30', '00:30', '01:30', '02:30', '03:30', '04:30', '05:30'];
        }
    } else {
        if (direction === 'VAI') {
            return ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
        } else {
            return ['23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00'];
        }
    }
}

function getEventLocationName() {
    return currentEvent === 'RIR' ? 'Rock in Rio' : 'Carnaval';
}

function updateEventLabels() {
    const name = getEventLocationName();
    document.querySelectorAll('.event-local-label').forEach(el => {
        el.value = name;
    });
}

// Habilitar/Desabilitar campos de Ida e Volta na tela
function toggleLegInputs(prefix, leg) {
    const isChecked = document.getElementById(`${prefix}-enable-${leg}`).checked;
    const inputsContainer = document.getElementById(`${prefix}-${leg}-inputs`);
    
    if (inputsContainer) {
        if (isChecked) {
            inputsContainer.classList.remove('opacity-40', 'pointer-events-none');
            inputsContainer.querySelectorAll('select').forEach(s => s.removeAttribute('disabled'));
        } else {
            inputsContainer.classList.add('opacity-40', 'pointer-events-none');
            inputsContainer.querySelectorAll('select').forEach(s => s.setAttribute('disabled', 'true'));
        }
    }
    
    if (prefix === 'pre') {
        updatePreBookingTimes();
    } else if (prefix === 'pass') {
        updateAvailableTimes();
    }
}

// Limpa matrículas e CPFs para busca precisa (remove .0, espaços, pontos e traços)
// Limpa matrículas e CPFs para busca precisa (remove .0, espaços, pontos e traços)
let collaboratorsMapMat = new Map();
let collaboratorsMapCpf = new Map();
let accreditedMapMat = new Map();
let accreditedMapCpf = new Map();

function rebuildDatabaseMaps() {
    collaboratorsMapMat.clear();
    collaboratorsMapCpf.clear();
    accreditedMapMat.clear();
    accreditedMapCpf.clear();
    
    if (db && db.collaborators) {
        db.collaborators.forEach(c => {
            if (c.matricula) {
                const matClean = String(c.matricula).split('.')[0].trim();
                collaboratorsMapMat.set(matClean, c);
            }
            if (c.cpf) {
                const cpfClean = String(c.cpf).replace(/\D/g, '').trim();
                collaboratorsMapCpf.set(cpfClean, c);
            }
        });
    }
    
    if (db && db.accredited) {
        db.accredited.forEach(a => {
            if (a.matricula) {
                const matClean = String(a.matricula).split('.')[0].trim();
                accreditedMapMat.set(matClean, a);
            }
            if (a.cpf) {
                const cpfClean = String(a.cpf).replace(/\D/g, '').trim();
                accreditedMapCpf.set(cpfClean, a);
            }
        });
    }
}

function findCollaborator(id) {
    if (!id) return null;
    const cleanId = String(id).trim().replace(/\D/g, '');
    const normalId = String(id).trim().split('.')[0];
    
    return collaboratorsMapMat.get(normalId) || 
           collaboratorsMapCpf.get(cleanId) || 
           collaboratorsMapMat.get(cleanId) || 
           collaboratorsMapCpf.get(normalId) || null;
}

function findAccredited(id) {
    if (!id) return null;
    const cleanId = String(id).trim().replace(/\D/g, '');
    const normalId = String(id).trim().split('.')[0];
    
    return accreditedMapMat.get(normalId) || 
           accreditedMapCpf.get(cleanId) || 
           accreditedMapMat.get(cleanId) || 
           accreditedMapCpf.get(normalId) || null;
}

function findPerson(id) {
    return findCollaborator(id) || findAccredited(id);
}

function getN1Area(person) {
    if (!person) return 'OUTROS';
    let val = person.gerencia || person.departamento || person.n1 || person.diretoria || person.area || 'OUTROS';
    let raw = String(val).toUpperCase().trim();
    if (raw.includes('FINANCAS') || raw.includes('FINANÇAS')) {
        if (raw.includes('JURIDICO') || raw.includes('JURÍDICO') || raw.includes('INFRA')) {
            return 'FINANÇAS, JURÍDICO E INFRAESTRUTURA';
        }
    }
    return raw;
}

function isValidBookingForReports(b) {
    if (b.status === 'Cancelado') return false;
    // Removido o filtro rígido de >= 20/07 para permitir exibir o histórico/base importada
    return true;
}

// Exibe badge flutuante se estiver rodando em ambiente de testes ou local
function checkTestEnvironment() {
    const host = window.location.hostname;
    if (host.includes('teste') || host === 'localhost' || host === '127.0.0.1') {
        const badge = document.createElement('div');
        badge.id = 'test-environment-badge';
        badge.style.position = 'fixed';
        badge.style.bottom = '15px';
        badge.style.right = '15px';
        badge.style.backgroundColor = '#d97706'; // Amber-600
        badge.style.color = '#ffffff';
        badge.style.padding = '8px 16px';
        badge.style.borderRadius = '30px';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = 'bold';
        badge.style.zIndex = '999999';
        badge.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -2px rgba(0,0,0,0.15)';
        badge.style.border = '2px solid #f59e0b';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '8px';
        badge.style.pointerEvents = 'none'; // não atrapalha cliques por trás
        badge.style.fontFamily = 'sans-serif';
        badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #fef08a;"></i> AMBIENTE DE TESTES';
        document.body.appendChild(badge);
    }
}

// --- CONTROLE DE BANCO DE DADOS (LOCALSTORAGE MOCK) ---
async function initDatabase() {
    // 1. Load static structure
    db = {};
    if (!db.trips) db.trips = [];
    if (!db.drivers) db.drivers = [];
    if (!db.vehicles) db.vehicles = [];
    if (!db.companies) db.companies = [];
    if (!db.sessions) db.sessions = [];
    if (!db.users) db.users = [];
    
    const adminExists = db.users.some(u => u.email === 'admin@globo.com' || u.matricula === '123456');
    if (!adminExists) {
        db.users.push({
            nome: 'Admin', sobrenome: 'Master', matricula: '123456', email: 'admin@globo.com', senha: 'admin123', perfil: 'manager'
        });
    }

    const fabioExists = db.users.some(u => u.email === 'fabio.paixao@g.globo' || u.email === 'fabio.paixao@globo.com' || u.matricula === '68808');
    if (!fabioExists) {
        db.users.push({
            nome: 'Fábio', sobrenome: 'Paixão dos Santos', matricula: '68808', email: 'fabio.paixao@g.globo', senha: '123', perfil: 'manager'
        });
    }
    if (!db.collaborators) db.collaborators = [];
    let fabioCollab = db.collaborators.find(c => String(c.matricula).trim() === '68808');
    if (!fabioCollab) {
        fabioCollab = { matricula: '68808' };
        db.collaborators.push(fabioCollab);
    }
    Object.assign(fabioCollab, {
        matricula: '68808',
        nome: 'FABIO PAIXAO DOS SANTOS',
        cargo: 'COORD OPERACAO TRANSPORTES',
        gerencia: 'LOGISTICA E TRANSPORTE',
        departamento: 'TRANSPORTES RJ',
        n1: 'FINANCAS JURIDICO E INFRAESTRUTURA',
        diretoria: 'SUPRIMENTOS SERVICOS E LOGISTICA',
        email: 'fabio.paixao@g.globo',
        tipo_vinculo: 'GLOBO',
        empresa: 'Globo'
    });

    if (!db.authorized_solicitants) db.authorized_solicitants = [];
    if (!db.booking_logs) db.booking_logs = [];

    // 2. Fetch from Backend
    try {
        const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://localhost:8000/api'
            : '/api'; // Use relative path on production

        console.log("Fetching data from backend...");
        const token = safeStorage.local.getItem('rig_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

        db.collaborators = [fabioCollab]; // Preserva cadastro Master local (Fábio Paixão)
        db.accredited = []; // Autocomplete para credenciados
        rebuildDatabaseMaps();

        const bookRes = await fetch(`${API_URL}/bookings`, { headers });
        if (bookRes.ok) {
            db.bookings = await bookRes.json();
        } else {
            console.warn("Sem token ou erro ao buscar bookings.");
            db.bookings = [];
        }
        
    } catch (err) {
        console.error("Backend unreachable, using empty arrays fallback", err);
        db.collaborators = [];
        db.accredited = [];
        db.bookings = [];
    }

    // Adicionar por padrão o administrador e colaboradores de tecnologia como autorizados
    if (db.authorized_solicitants.length === 0) {
        db.authorized_solicitants.push({
            matricula: '123456',
            nome: 'Admin Master',
            cargo: 'Administrador',
            departamento: 'TECNOLOGIA'
        });

        const techCollabs = (db.collaborators || []).filter(c => {
            const dept = (c.departamento || c.diretoria || '').toUpperCase();
            return dept.includes('TECNOLOGIA') || dept.includes('TRANSPORTES');
        }).slice(0, 5);

        techCollabs.forEach(tc => {
            db.authorized_solicitants.push({
                matricula: tc.matricula,
                nome: tc.nome,
                cargo: tc.cargo,
                departamento: tc.departamento
            });
        });
    }
    
    // Constr�i mapas indexados para buscas O(1)
    rebuildDatabaseMaps();
} // <--- Fechar initDatabase aqui

// --- INTEGRA�!ÒO BACKEND ---
function getApiUrl() {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:8000/api'
        : '/api';
}

function syncBookingCreate(booking) {
    // Create continua aberto no backend para uso dos funcionários.
    fetch(`${getApiUrl()}/bookings/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(booking)
    }).catch(console.error);
}

function syncBookingBulk(bookings) {
    const token = safeStorage.local.getItem('rig_token');
    fetch(`${getApiUrl()}/bookings/bulk`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ bookings })
    }).catch(console.error);
}

function syncBookingCancel(id) {
    const token = safeStorage.local.getItem('rig_token');
    fetch(`${getApiUrl()}/bookings/cancel`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ id })
    }).catch(console.error);
}

function syncBookingCheckin(id, type) {
    const token = safeStorage.local.getItem('rig_token');
    fetch(`${getApiUrl()}/bookings/checkin`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ id, type })
    }).catch(console.error);
}


function saveDatabase() {
    if (db) {
        // Exclude collaborators and accredited to keep localStorage small
        const baseCol = [];
        const baseColMapMat = new Map();
        const baseColMapCpf = new Map();
        baseCol.forEach(row => {
            const rowMat = String(row[0] || '').trim();
            const rowCpf = String(row[2] || '').trim();
            if (rowMat) baseColMapMat.set(rowMat, row);
            if (rowCpf) baseColMapCpf.set(rowCpf, row);
        });
        
        const customCol = db.collaborators.filter(c => {
            const mat = String(c.matricula || '').trim();
            const cpf = String(c.cpf || '').trim();
            const found = (mat && baseColMapMat.get(mat)) || (cpf && baseColMapCpf.get(cpf));
            if (!found) return true;
            return found[1] !== c.nome || found[3] !== c.cargo || found[4] !== c.diretoria || found[5] !== c.tipo_vinculo;
        });
        
        const baseAcc = [];
        const baseAccMapMat = new Map();
        const baseAccMapCpf = new Map();
        baseAcc.forEach(row => {
            const rowMat = String(row.matricula || '').trim();
            const rowCpf = String(row.cpf || '').trim();
            if (rowMat) baseAccMapMat.set(rowMat, row);
            if (rowCpf) baseAccMapCpf.set(rowCpf, row);
        });

        const customAcc = db.accredited.filter(c => {
            const mat = String(c.matricula || '').trim();
            const cpf = String(c.cpf || '').trim();
            const found = (mat && baseAccMapMat.get(mat)) || (cpf && baseAccMapCpf.get(cpf));
            if (!found) return true;
            return found.nome !== c.nome || found.cargo !== c.cargo || found.diretoria !== c.diretoria;
        });
        
        const baseColIds = new Set(baseCol.map(row => String(row[0] || row[2] || '').trim()));
        const baseAccIds = new Set(baseAcc.map(row => String(row.matricula || row.cpf || '').trim()));
        
        const activeColIds = new Set(db.collaborators.map(c => String(c.matricula || c.cpf || '').trim()));
        const activeAccIds = new Set(db.accredited.map(c => String(c.matricula || c.cpf || '').trim()));

        const deletedCol = [...baseColIds].filter(id => !activeColIds.has(id));
        const deletedAcc = [...baseAccIds].filter(id => !activeAccIds.has(id));
        
        const clone = { ...db };
        delete clone.collaborators;
        delete clone.accredited;
        
        clone.custom_collaborators = customCol;
        clone.custom_accredited = customAcc;
        clone.deleted_collaborators = deletedCol;
        clone.deleted_accredited = deletedAcc;
        
        safeStorage.local.setItem('conexao_transportes_db', JSON.stringify(clone));
        rebuildDatabaseMaps();
    }
}

function resetDatabase() {
    if (confirm("Deseja realmente restaurar o banco de dados original? Todas as alterações, check-ins e agendamentos recentes serão perdidos.")) {
        safeStorage.local.removeItem('conexao_transportes_db');
        initDatabase();
        
        // Reset inputs
        resetPassengerForm();
        resetPreBookingForm();
        
        // Reset Event & Date dropdowns
        document.getElementById('event-selector').value = 'RIR';
        currentEvent = 'RIR';
        populateDateSelectors();
        updateEventLabels();
        renderReplicationCheckboxes();
        updatePreBookingTimes();
        updateAvailableTimes();
        
        if (currentTab === 'operation') {
            refreshOperationList();
        } else if (currentTab === 'management') {
            updateDashboard();
        }
        
        showToast("Banco de dados restaurado", "O banco de dados do Carnaval 2026 e credenciais do RIR 26 foram reiniciados.", "info");
    }
}

// Garante que o banco de dados local contenha registros equivalentes para o Rock in Rio 2026
function ensureRirDataExists() {
    const rirDates = ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-11', '2026-09-12', '2026-09-13'];
    const carnaDates = ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-21'];
    
    // Verifica se já temos viagens no ano de 2026 no mês 09
    const hasRirTrips = db.trips.some(t => t.data.startsWith('2026-09'));
    if (!hasRirTrips) {
        console.log("Gerando dados de viagens e agendamentos para o RIR 2026...");
        
        // Copiar e mapear viagens
        const newTrips = [];
        db.trips.forEach(t => {
            if (t.data.startsWith('2026')) {
                const dateIdx = carnaDates.indexOf(t.data);
                if (dateIdx !== -1) {
                    const targetIdxs = [dateIdx];
                    if (dateIdx < 3) {
                        targetIdxs.push(dateIdx + 4);
                    }
                    
                    targetIdxs.forEach(tIdx => {
                        const targetDate = rirDates[tIdx];
                        const rirTripId = t.id.replace(t.data, targetDate);
                        newTrips.push({
                            ...t,
                            id: rirTripId,
                            data: targetDate
                        });
                    });
                }
            }
        });
        db.trips.push(...newTrips);
        
        // Copiar e mapear agendamentos para credenciados do RIR
        const newBookings = [];
        db.bookings.forEach(b => {
            if (b.data.startsWith('2026')) {
                const dateIdx = carnaDates.indexOf(b.data);
                if (dateIdx !== -1) {
                    const targetIdxs = [dateIdx];
                    if (dateIdx < 3) {
                        targetIdxs.push(dateIdx + 4);
                    }
                    
                    targetIdxs.forEach(tIdx => {
                        const targetDate = rirDates[tIdx];
                        const rirTripId = b.trip_id.replace(b.data, targetDate);
                        const rirBookingId = b.id.replace(b.data.replace(/-/g, ''), targetDate.replace(/-/g, ''));
                        
                        // Seleciona um credenciado do RIR de forma pseudo-aleatória
                        const rirPerson = db.accredited[Math.floor(Math.random() * db.accredited.length)];
                        
                        newBookings.push({
                            ...b,
                            id: rirBookingId,
                            matricula: rirPerson.matricula || "",
                            cpf: rirPerson.cpf || "",
                            nome: rirPerson.nome,
                            cargo: rirPerson.cargo || "Credenciado",
                            departamento: rirPerson.departamento || rirPerson.diretoria || "TRANSPORTES",
                            data: targetDate,
                            trip_id: rirTripId
                        });
                    });
                }
            }
        });
        db.bookings.push(...newBookings);
        syncBookingBulk(newBookings);
        
        saveDatabase();
        console.log("Dados do Rock in Rio 2026 criados com sucesso!");
    }
}

// --- SETUP EVENT HANDLERS ---
function setupEventHandlers() {
    // Selector regional
    document.getElementById('regional-selector').addEventListener('change', (e) => {
        currentRegional = e.target.value;
        showToast(`Regional Alterada`, `Operação sincronizada para a regional ${currentRegional}.`, "info");
        
        if (currentTab === 'operation') refreshOperationList();
        if (currentTab === 'management') updateDashboard();
    });

    // Selector evento
    document.getElementById('event-selector').addEventListener('change', (e) => {
        currentEvent = e.target.value;
        showToast(`Evento Alterado`, `Carregando dados específicos do evento selecionado.`, "info");
        
        populateDateSelectors();
        updateEventLabels();
        renderReplicationCheckboxes();
        updatePreBookingTimes();
        updateAvailableTimes();
        
        if (currentTab === 'operation') {
            populateOperationFilters();
            refreshOperationList();
        }
        if (currentTab === 'management') updateDashboard();
    });

    // Reset DB button
    document.getElementById('btn-reset-db').addEventListener('click', resetDatabase);

    // Listeners de mudança de base nos formulários para atualizar os horários
    const pvo = document.getElementById('pre-vai-origin');
    if (pvo) pvo.addEventListener('change', updatePreBookingTimes);
    const pvd = document.getElementById('pre-vem-destination');
    if (pvd) pvd.addEventListener('change', updatePreBookingTimes);

    const avo = document.getElementById('pass-vai-origin');
    if (avo) avo.addEventListener('change', updateAvailableTimes);
    const avd = document.getElementById('pass-vem-destination');
    if (avd) avd.addEventListener('change', updateAvailableTimes);
}

// --- CONTROLE DE NAVEGA�!ÒO DE TABS ---
function switchTab(tabId) {
    currentTab = tabId;
    
    const tabs = ['booking-portal', 'passenger', 'operation', 'management', 'collaborators', 'bulk-booking', 'fleet', 'driver-portal', 'access-management', 'tutorials'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const content = document.getElementById(`view-${t}`);
        
        if (t === tabId) {
            if (btn) btn.className = "tab-btn active flex items-center space-x-2 px-4 py-2.5 rounded-xl border border-transparent text-sm font-semibold transition-all duration-300 text-white";
            if (content) {
                content.classList.remove('hidden');
                content.classList.add('opacity-100');
            }
        } else {
            if (btn) btn.className = "tab-btn flex items-center space-x-2 px-4 py-2.5 rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-900 text-sm font-semibold transition-all duration-300 text-gray-300 hover:text-white";
            if (content) {
                content.classList.add('hidden');
                content.classList.remove('opacity-100');
            }
        }
    });

    // Ações ao trocar de aba
    if (tabId === 'passenger') {
        updateAvailableTimes();
    } else if (tabId === 'operation') {
        populateOperationFilters();
        refreshOperationList();
    } else if (tabId === 'management') {
        switchSubTab(currentSubTab);
    } else if (tabId === 'fleet') {
        switchFleetSubTab(currentFleetSubTab || 'drivers');
    } else if (tabId === 'driver-portal') {
        populateDriverPortalSelectors();
    } else if (tabId === 'access-management') {
        updateAccessManagement();
    } else if (tabId === 'tutorials') {
        switchTutorial('driver');
    }
}

// --- CONTROLE DE SUB-TABS (GESTÒO & ANALYTICS) ---
function switchSubTab(subTabId) {
    currentSubTab = subTabId;
    
    const subtabs = ['graphs', 'adherence', 'loss-sim', 'van-simulator', 'audit', 'drivers', 'tracking', 'upload-panel', 'db-viewer', 'robot-audit'];
    subtabs.forEach(st => {
        const btn = document.getElementById(`subtab-${st}`);
        const content = document.getElementById(`subtab-content-${st}`);
        
        if (st === subTabId) {
            if (btn) btn.className = "subtab-btn active text-xs font-bold uppercase tracking-wider text-blue-500 pb-2 border-b-2 border-blue-500 transition duration-200";
            if (content) content.classList.remove('hidden');
        } else {
            if (btn) btn.className = "subtab-btn text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-300 pb-2 transition duration-200";
            if (content) content.classList.add('hidden');
        }
    });

    // Recarregar dados da subtab ativa
    updateDashboard();
    
    if (subTabId === 'tracking') {
        setTimeout(initTrackingMap, 50);
    } else if (subTabId === 'van-simulator') {
        setTimeout(recalculateVanSimulation, 50);
    }
}

// --- DINAMIZA�!ÒO DE SELETORES DE DATA ---
function populateDateSelectors() {
    const dates = getEventDates();
    
    const fillSelect = (selectId) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const currVal = select.value;
        select.innerHTML = '';
        dates.forEach((d, idx) => {
            const opt = document.createElement('option');
            opt.value = d;
            const parts = d.split('-');
            const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
            opt.textContent = `${formattedDate} - Dia ${idx + 1}`;
            select.appendChild(opt);
        });
        if (currVal && dates.includes(currVal)) {
            select.value = currVal;
        }
    };
    
    fillSelect('pre-date');
    fillSelect('sim-van-date');
}

// --- RENDERIZAR CHECKLISTS DE REPLICA�!ÒO ---
function renderReplicationCheckboxes() {
    const dates = getEventDates();
    
    const fillCheckboxes = (containerId, prefix) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        dates.forEach((d, idx) => {
            const parts = d.split('-');
            const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
            
            const div = document.createElement('div');
            div.className = "flex items-center space-x-1.5";
            div.innerHTML = `
                <input type="checkbox" id="${prefix}-day-${d}" value="${d}" class="rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-0 cursor-pointer">
                <label for="${prefix}-day-${d}" class="cursor-pointer select-none text-[11px] text-gray-300">${dateStr} (Dia ${idx + 1})</label>
            `;
            container.appendChild(div);
        });
    };
    
    fillCheckboxes('pre-repl-days-container', 'pre');
    fillCheckboxes('pass-repl-days-container', 'pass');
}

// Define escolha de replicação (Sim/Não)
function setReplicationChoice(prefix, choice) {
    const input = document.getElementById(`${prefix}-repl-choice`);
    if (!input) return;
    input.value = choice;

    const btnSim = document.getElementById(`${prefix}-btn-repl-sim`);
    const btnNao = document.getElementById(`${prefix}-btn-repl-nao`);
    const btnCustom = document.getElementById(`${prefix}-btn-repl-custom`);
    const checklist = document.getElementById(`${prefix}-repl-days-checklist`);

    [btnSim, btnNao, btnCustom].forEach(btn => {
        if (btn) {
            btn.className = "flex-grow bg-gray-800 text-gray-300 font-bold py-1.5 rounded-lg text-xs transition border border-gray-700";
        }
    });

    let activeBtn = btnNao;
    if (choice === 'sim') activeBtn = btnSim;
    else if (choice === 'custom') activeBtn = btnCustom;

    if (activeBtn) {
        activeBtn.className = "flex-grow bg-blue-600 text-white font-bold py-1.5 rounded-lg text-xs transition";
    }

    if (choice === 'custom') {
        if (checklist) checklist.classList.remove('hidden');
    } else {
        if (checklist) checklist.classList.add('hidden');
    }
}

// --- PORTAL DE PR�0-AGENDAMENTO ---
function updatePreBookingRoutes() {
    // Deprecated in favor of dual leg boxes
}

function updatePreBookingTimes() {
    const enableVai = document.getElementById('pre-enable-vai').checked;
    const enableVem = document.getElementById('pre-enable-vem').checked;
    const timeSelect = document.getElementById('pre-time');
    const vemTimeSelect = document.getElementById('pre-vem-time');
    const vemTimeContainer = document.getElementById('pre-vem-time-container');

    if (!timeSelect) return;

    const currentVal = timeSelect.value;

    timeSelect.innerHTML = '';
    if (enableVai) {
        const base = document.getElementById('pre-vai-origin').value;
        getAvailableHours('VAI', currentEvent, base).forEach(h => timeSelect.appendChild(createOption(h, h)));
    } else if (enableVem) {
        const base = document.getElementById('pre-vem-destination').value;
        getAvailableHours('VEM', currentEvent, base).forEach(h => timeSelect.appendChild(createOption(h, h)));
    }

    if (currentVal && Array.from(timeSelect.options).some(opt => opt.value === currentVal)) {
        timeSelect.value = currentVal;
    }

    if (enableVai && enableVem) {
        if (vemTimeContainer) vemTimeContainer.classList.remove('hidden');
        if (vemTimeSelect) {
            const currentVemVal = vemTimeSelect.value;
            vemTimeSelect.innerHTML = '';
            const base = document.getElementById('pre-vem-destination').value;
            getAvailableHours('VEM', currentEvent, base).forEach(h => vemTimeSelect.appendChild(createOption(h, h)));
            if (currentVemVal && Array.from(vemTimeSelect.options).some(opt => opt.value === currentVemVal)) {
                vemTimeSelect.value = currentVemVal;
            }
        }
    } else {
        if (vemTimeContainer) vemTimeContainer.classList.add('hidden');
    }
}

function togglePreBookingPassengerList(serviceType) {
    const listDiv = document.getElementById('pre-div-passenger-list');
    const textarea = document.getElementById('pre-list');
    if (listDiv) listDiv.classList.add('hidden');
    if (textarea) textarea.removeAttribute('required');
}

async function fetchAndCachePerson(q) {
    if (q.length < 3) return false;
    try {
        const res = await fetch(`${getApiUrl()}/collaborators/search?q=${q}`);
        if (!res.ok) return false;
        const data = await res.json();
        let updated = false;
        data.forEach(c => {
            if (!db.collaborators.find(x => x.matricula === c.matricula)) {
                db.collaborators.push(c);
                if (c.cpf) collaboratorsMapCpf.set(String(c.cpf).replace(/\D/g, ''), c);
                if (c.matricula) collaboratorsMapMat.set(String(c.matricula).trim(), c);
                updated = true;
            }
        });
        const accRes = await fetch(`${getApiUrl()}/accredited/search?q=${q}`);
        if (accRes.ok) {
            const accData = await accRes.json();
            accData.forEach(a => {
                if (!db.accredited.find(x => x.cpf === a.cpf)) {
                    db.accredited.push(a);
                    if (a.cpf) accreditedMapCpf.set(String(a.cpf).replace(/\D/g, ''), a);
                    if (a.matricula) accreditedMapMat.set(String(a.matricula).trim(), a);
                    updated = true;
                }
            });
        }
        return updated;
    } catch(err) { console.error(err); return false; }
}

async function lookupPreBookingCollaborator(idVal) {
    if (idVal.trim().length >= 3) await fetchAndCachePerson(idVal.trim());
    const id = idVal.trim();
    const msg = document.getElementById('pre-lookup-msg');
    const fields = document.getElementById('pre-details-fields');
    const savedContainer = document.getElementById('pre-saved-bookings-container');
    
    if (id.length < 3) {
        msg.classList.add('hidden');
        fields.classList.add('hidden');
        if (savedContainer) savedContainer.classList.add('hidden');
        return;
    }
    
    const person = findPerson(id);
    if (person) {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] mt-1 text-emerald-400 font-semibold";
        msg.textContent = "Colaborador ativo encontrado";
        
        fields.classList.remove('hidden');
        document.getElementById('lbl-pre-name').textContent = person.nome;
        document.getElementById('lbl-pre-cargo').textContent = person.cargo || "Funcionário";
        document.getElementById('lbl-pre-dept').textContent = getN1Area(person);
        
        const existingBookings = getCollaboratorEventBookings(person.matricula, person.cpf);
        if (existingBookings.length > 0) {
            msg.className = "text-[10px] mt-1 text-amber-400 font-bold";
            msg.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Atenção: Colaborador já possui agendamento ativo neste evento. Veja abaixo:';
        }
        
        const companyLabel = document.getElementById('lbl-pre-company');
        if (companyLabel) {
            const isTerceiro = person.tipo_vinculo === 'TERCEIRO' || person.empresa === 'Terceiro' || person.is_accredited;
            companyLabel.textContent = isTerceiro ? 'Terceiro' : 'Globo';
        }
        
        updatePreBookingSavedList(person);
    } else {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] mt-1 text-red-400 font-bold";
        msg.textContent = "Acesso Negado: Colaborador não encontrado na base de colaboradores ou terceiros";
        fields.classList.add('hidden');
    }
}

function selectPreBookingTarget(type) {
    const btnSelf = document.getElementById('pre-btn-target-self');
    const btnOther = document.getElementById('pre-btn-target-other');
    const targetInput = document.getElementById('pre-target-type');
    const labelTitle = document.getElementById('lbl-pre-id-title');
    const divSolicitant = document.getElementById('div-pre-solicitant-id');
    const inputSolicitant = document.getElementById('pre-solicitant-id');
    const inputPassenger = document.getElementById('pre-id');

    if (!btnSelf || !btnOther || !targetInput) return;

    targetInput.value = type;

    // Reset fields to avoid mixing data
    inputPassenger.value = '';
    document.getElementById('pre-lookup-msg').classList.add('hidden');
    document.getElementById('pre-details-fields').classList.add('hidden');
    const savedContainer = document.getElementById('pre-saved-bookings-container');
    if (savedContainer) savedContainer.classList.add('hidden');

    if (type === 'self') {
        // Estilo botões
        btnSelf.className = "bg-blue-600 text-white font-bold py-2 rounded-xl text-xs transition border border-blue-500 shadow-md flex items-center justify-center gap-1.5";
        btnOther.className = "bg-gray-900 text-gray-400 font-bold py-2 rounded-xl text-xs transition border border-gray-800 hover:bg-gray-800 flex items-center justify-center gap-1.5";
        
        if (labelTitle) labelTitle.textContent = "Sua Matrícula ou CPF";
        if (divSolicitant) divSolicitant.classList.add('hidden');
        if (inputSolicitant) {
            inputSolicitant.required = false;
            inputSolicitant.value = '';
        }
        document.getElementById('pre-solicitant-lookup-msg').classList.add('hidden');
        document.getElementById('pre-solicitant-details').classList.add('hidden');
    } else {
        // Estilo botões
        btnSelf.className = "bg-gray-900 text-gray-400 font-bold py-2 rounded-xl text-xs transition border border-gray-800 hover:bg-gray-800 flex items-center justify-center gap-1.5";
        btnOther.className = "bg-blue-600 text-white font-bold py-2 rounded-xl text-xs transition border border-blue-500 shadow-md flex items-center justify-center gap-1.5";
        
        if (labelTitle) labelTitle.textContent = "Matrícula ou CPF do Passageiro";
        if (divSolicitant) divSolicitant.classList.remove('hidden');
        if (inputSolicitant) inputSolicitant.required = true;
    }
}

async function lookupPreBookingSolicitant(idVal) {
    if (idVal.trim().length >= 3) await fetchAndCachePerson(idVal.trim());
    const id = idVal.trim();
    const msg = document.getElementById('pre-solicitant-lookup-msg');
    const details = document.getElementById('pre-solicitant-details');
    
    if (id.length < 3) {
        if (msg) msg.classList.add('hidden');
        if (details) details.classList.add('hidden');
        return;
    }
    
    const person = findPerson(id);
    if (person) {
        if (msg) {
            msg.classList.remove('hidden');
            msg.className = "text-[10px] mt-1 text-emerald-400 font-semibold";
            msg.textContent = "�S Solicitante encontrado na base";
        }
        
        if (details) {
            details.classList.remove('hidden');
            document.getElementById('lbl-solicitant-name').textContent = person.nome;
            document.getElementById('lbl-solicitant-dept').textContent = getN1Area(person);
            
            const badge = document.getElementById('lbl-solicitant-badge');
            if (badge) {
                // Verificar se é autorizado
                const isAuthorized = isSolicitantAuthorized(person);
                if (isAuthorized) {
                    badge.className = "px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
                    badge.textContent = "Autorizado";
                    if (msg) msg.textContent = "�S Solicitante autorizado para cadastrar terceiros";
                } else {
                    badge.className = "px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30";
                    badge.textContent = "Não Autorizado";
                    if (msg) {
                        msg.className = "text-[10px] mt-1 text-amber-400 font-bold";
                        msg.textContent = "�a�️ Solicitante sem permissão para cadastrar terceiros";
                    }
                }
            }
        }
    } else {
        if (msg) {
            msg.classList.remove('hidden');
            msg.className = "text-[10px] mt-1 text-red-400 font-bold";
            msg.textContent = "�S Acesso Negado: Solicitante não credenciado";
        }
        if (details) details.classList.add('hidden');
    }
}

// Verifica se um solicitante é autorizado a realizar agendamento para terceiros
function isSolicitantAuthorized(person) {
    if (!person) return false;
    
    // 1. Verificar se está explicitamente na lista de autorizados
    const isExplicit = (db.authorized_solicitants || []).some(s => 
        (s.matricula && s.matricula === person.matricula) || (s.cpf && s.cpf === person.cpf)
    );
    if (isExplicit) return true;
    
    // 2. Verificar se é usuário cadastrado com perfil Master/Manager
    const isSystemUser = (db.users || []).some(u => 
        (u.matricula && u.matricula === person.matricula) || (u.email && u.email.toLowerCase() === (person.email || '').toLowerCase())
    );
    if (isSystemUser) return true;
    
    // 3. Verificar se pertence a departamentos operacionais críticos (Tecnologia, Transportes, CCO)
    const dept = (person.departamento || person.diretoria || '').toUpperCase();
    if (dept.includes('TECNOLOGIA') || dept.includes('TRANSPORTES') || dept.includes('CCO') || dept.includes('GERENCIA')) {
        return true;
    }
    
    return false;
}

function logBookingAction(passenger, solicitant, action, date, serviceType, canal) {
    if (!db.booking_logs) db.booking_logs = [];
    
    const newLog = {
        timestamp: new Date().toISOString(),
        acao: action, // 'Agendado', 'Cancelado', 'Tentativa Negada'
        passageiro_nome: passenger ? passenger.nome : 'Desconhecido',
        passageiro_id: passenger ? (passenger.matricula || passenger.cpf) : '-',
        solicitante_nome: solicitant ? solicitant.nome : 'O Próprio',
        solicitante_id: solicitant ? (solicitant.matricula || solicitant.cpf) : '-',
        autorizado: solicitant ? (isSolicitantAuthorized(solicitant) ? 'Sim' : 'Não') : 'Sim (Autocadastro)',
        data_viagem: date || '-',
        servico: serviceType || '-',
        canal: canal || 'Site'
    };
    
    db.booking_logs.push(newLog);
    
    // Limitar histórico de logs para não estourar armazenamento (últimos 300)
    if (db.booking_logs.length > 300) {
        db.booking_logs.shift();
    }
    
    saveDatabase();
}

function updatePreBookingSavedList(person) {
    const container = document.getElementById('pre-saved-bookings-container');
    const listDiv = document.getElementById('pre-saved-bookings-list');
    if (!container || !listDiv) return;

    listDiv.innerHTML = '';
    const bookings = getCollaboratorEventBookings(person.matricula, person.cpf);
    
    if (bookings.length > 0) {
        container.classList.remove('hidden');
        
        // Agrupar por data
        const grouped = {};
        bookings.forEach(b => {
            if (!grouped[b.data]) {
                grouped[b.data] = { vai: null, vem: null };
            }
            if (b.destino === getEventLocationName()) {
                grouped[b.data].vai = b;
            } else {
                grouped[b.data].vem = b;
            }
        });
        
        // Renderizar cada data
        Object.keys(grouped).sort().forEach(date => {
            const parts = date.split('-');
            const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
            
            const g = grouped[date];
            let info = '';
            if (g.vai) {
                info += `VAI (${g.vai.origem} às ${g.vai.hora})`;
            }
            if (g.vem) {
                if (info) info += ' | ';
                info += `VEM (${g.vem.destino} às ${g.vem.hora})`;
            }
            
            const item = document.createElement('div');
            item.className = "flex justify-between items-center text-[10px] text-gray-300 py-0.5 border-b border-gray-950/40 last:border-b-0";
            item.innerHTML = `
                <span class="font-semibold text-white">${formattedDate}</span>
                <span class="text-gray-400">${info}</span>
            `;
            listDiv.appendChild(item);
        });
    } else {
        container.classList.add('hidden');
    }
}

// Cria agendamento individual e garante a estrutura no banco
function createBooking(person, origin, dest, serviceType, accompany, date, time, canal_entrada, solicitantPerson = null) {
    const escopo = (dest === getEventLocationName()) ? 'VAI' : 'VEM';
    const trip_id = `${origin}_${escopo}_${date}_${time.replace(':', '')}`;
    const idBooking = `${person.matricula || person.cpf}${origin}x${dest}${date.replace(/-/g, '')}${time.replace(':', '')}`;
    
    // Evita duplicados ativos
    const existing = db.bookings.find(b => b.id === idBooking && b.status !== 'Cancelado');
    if (existing) {
        return false;
    }

    // Auto-criação de viagens/trips se não existirem
    let trip = db.trips.find(t => t.id === trip_id);
    if (!trip) {
        trip = {
            id: trip_id,
            site: origin,
            escopo: escopo,
            hora: time,
            data: date,
            capacidade: serviceType === 'Vai e Vem Van' ? 15 : 4,
            planejado: 0,
            real: 0,
            tipo_atendimento: serviceType,
            empresa_transporte: "Top Service"
        };
        db.trips.push(trip);
    }
    
    const newBooking = {
        id: idBooking,
        matricula: person.matricula || "",
        cpf: person.cpf || "",
        nome: person.nome,
        origem: origin,
        destino: dest,
        data: date,
        hora: time,
        trip_id: trip_id,
        status: 'Agendado',
        canal_entrada: canal_entrada,
        telefone: person.telefone || "",
        cargo: person.cargo || "",
        departamento: getN1Area(person),
        accompany: accompany,
        service_type: serviceType,
        uploaded_at: new Date().toISOString(),
        solicitante_id: solicitantPerson ? (solicitantPerson.matricula || solicitantPerson.cpf) : "",
        solicitante_nome: solicitantPerson ? solicitantPerson.nome : "",
        uploaded_by: (function() {
            if (solicitantPerson) {
                return `Solicitante: ${solicitantPerson.nome} (Matrícula/CPF: ${solicitantPerson.matricula || solicitantPerson.cpf})`;
            }
            const savedUser = safeStorage.local.getItem('rig_user');
            if (savedUser) {
                try {
                    const uObj = JSON.parse(savedUser);
                    return `${uObj.nome} ${uObj.sobrenome} (Matrícula: ${uObj.matricula})`;
                } catch(e) {}
            }
            if (typeof representativeFixedArea !== 'undefined' && representativeFixedArea) {
                return `Representante: ${representativeFixedArea}`;
            }
            return canal_entrada || 'Sistema';
        })(),
        last_updated_at: new Date().toISOString(),
        validado_transporte: false
    };
    
    db.bookings.push(newBooking);
    saveBookingsLocal();
    syncBookingCreate(newBooking);
    trip.planejado += 1;

    // Registrar no log de auditoria
    logBookingAction(person, solicitantPerson, 'Agendado', date, serviceType, canal_entrada);

    return true;
}

// Lida com replicação de múltiplos dias
function handleLegReplication(prefix, leg, person, origin, dest, serviceType, accompany, selectedDate, time, canal, solicitantPerson = null) {
    const choice = document.getElementById(`${prefix}-repl-choice`).value;
    const allDates = getEventDates();
    let targetDates = [];

    if (choice === 'sim') {
        // Replica para todos os dias do evento exceto o atual
        targetDates = allDates.filter(d => d !== selectedDate);
    } else {
        // Obtém apenas os dias selecionados no checklist
        allDates.forEach(d => {
            const cb = document.getElementById(`${prefix}-day-${d}`);
            if (cb && cb.checked && d !== selectedDate) {
                targetDates.push(d);
            }
        });
    }

    let count = 0;
    targetDates.forEach(d => {
        const ok = createBooking(person, origin, dest, serviceType, accompany, d, time, canal, solicitantPerson);
        if (ok) count++;
    });

    return count;
}

function handlePreBookingSubmit() {
    if (isProcessingBooking) return;
    isProcessingBooking = true;

    const id = document.getElementById('pre-id').value.trim();
    const serviceType = document.getElementById('pre-service-type').value;
    const accompany = "";
    const date = document.getElementById('pre-date').value;

    const person = findPerson(id);
    if (!person) {
        alert("Erro: O colaborador informado não foi encontrado na base de colaboradores ou terceiros.");
        isProcessingBooking = false;
        return;
    }

    // Rastreabilidade e validação de solicitante (autocadastro vs terceiro)
    const targetType = document.getElementById('pre-target-type').value;
    let solicitantPerson = null;

    if (targetType === 'other') {
        const solicitantId = document.getElementById('pre-solicitant-id').value.trim();
        if (!solicitantId) {
            alert("Erro: Informe a matrícula ou CPF de quem está realizando o agendamento (Solicitante).");
            isProcessingBooking = false;
            return;
        }

        if (solicitantId === id) {
            // Se digitou o próprio CPF/Matrícula do passageiro, é autocadastro
            solicitantPerson = null;
        } else {
            solicitantPerson = findPerson(solicitantId);
            if (!solicitantPerson) {
                alert("Erro: O solicitante informado não foi encontrado na base de colaboradores ou terceiros.");
                isProcessingBooking = false;
                return;
            }

            // Verificar autorização do solicitante
            if (!isSolicitantAuthorized(solicitantPerson)) {
                // Registrar log de tentativa negada
                logBookingAction(
                    person,
                    solicitantPerson,
                    'Tentativa Negada (Não Autorizado)',
                    date,
                    serviceType,
                    'Site'
                );

                alert(`Acesso Negado: O solicitante ${solicitantPerson.nome} (Matrícula/CPF: ${solicitantId}) não possui autorização para agendar para terceiros. O agendamento foi bloqueado para auditoria.`);
                isProcessingBooking = false;
                return;
            }
        }
    }

    const enableVai = document.getElementById('pre-enable-vai').checked;
    const enableVem = document.getElementById('pre-enable-vem').checked;

    if (!enableVai && !enableVem) {
        alert("Erro: Selecione pelo menos uma das opções de viagem (Ida ou Retorno).");
        isProcessingBooking = false;
        return;
    }

    const vaiOrigin = enableVai ? document.getElementById('pre-vai-origin').value : 'EG';
    const vaiTime = enableVai ? document.getElementById('pre-time').value : '17:00';
    const vemDest = enableVem ? document.getElementById('pre-vem-destination').value : 'EG';
    const vemTime = enableVem ? (enableVai ? document.getElementById('pre-vem-time').value : document.getElementById('pre-time').value) : '23:00';

    const targetDates = getReplicationTargetDates('pre', date);

    // Validação de agendamentos existentes (conflitos)
    const conflictingDates = [];
    targetDates.forEach(d => {
        const hasConflictingVai = enableVai && db.bookings.some(b => 
            ((b.matricula && b.matricula === person.matricula) || (person.cpf && b.cpf === person.cpf)) && 
            b.data === d && 
            b.destino === getEventLocationName() && 
            b.status !== 'Cancelado'
        );
        const hasConflictingVem = enableVem && db.bookings.some(b => 
            ((b.matricula && b.matricula === person.matricula) || (person.cpf && b.cpf === person.cpf)) && 
            b.data === d && 
            b.origem === getEventLocationName() && 
            b.status !== 'Cancelado'
        );
        if (hasConflictingVai || hasConflictingVem) {
            const parts = d.split('-');
            const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
            conflictingDates.push(formattedDate);
        }
    });

    if (conflictingDates.length > 0) {
        const confirmMsg = `Atenção: Você já possui agendamento de transporte active para o(s) dia(s) ${conflictingDates.join(', ')}.\nDeseja alterar a opção selecionada anteriormente por estas novas?`;
        if (!confirm(confirmMsg)) {
            isProcessingBooking = false;
            return;
        }
    }

    pendingBookings = [];
    targetDates.forEach(d => {
        pendingBookings.push({
            person: person,
            date: d,
            enableVai: enableVai,
            vaiOrigin: vaiOrigin,
            vaiTime: vaiTime,
            enableVem: enableVem,
            vemDest: vemDest,
            vemTime: vemTime,
            serviceType: serviceType,
            accompany: accompany,
            canal: 'Site',
            solicitant: solicitantPerson // repassa o solicitante
        });
    });

    if (targetDates.length === 1) {
        pendingBookingSource = 'pre';
        pendingBookingServiceType = serviceType || '';
        pendingBookingAccompany = accompany || '';
        commitPendingBookings();
    } else {
        openReplicationReviewModal('pre', person, serviceType, accompany, date, 'Site');
    }
}

function resetPreBookingInstructions() {
    document.getElementById('pre-booking-instructions-active').classList.add('hidden');
    document.getElementById('pre-booking-instructions-empty').classList.remove('hidden');
    resetPreBookingForm();
}

// Reset do formulário de agendamento
function resetPreBookingForm() {
    document.getElementById('form-pre-booking').reset();
    document.getElementById('pre-lookup-msg').classList.add('hidden');
    document.getElementById('pre-details-fields').classList.add('hidden');
    document.getElementById('pre-div-passenger-list').classList.add('hidden');
    
    document.getElementById('pre-enable-vai').checked = true;
    document.getElementById('pre-enable-vem').checked = true;
    toggleLegInputs('pre', 'vai');
    toggleLegInputs('pre', 'vem');
    setReplicationChoice('pre', 'nao');

    const savedContainer = document.getElementById('pre-saved-bookings-container');
    if (savedContainer) savedContainer.classList.add('hidden');
    const savedList = document.getElementById('pre-saved-bookings-list');
    if (savedList) savedList.innerHTML = '';

    const preInput = document.getElementById('pre-id');
    if (preInput && !passengerFixedCpf) {
        preInput.readOnly = false;
        preInput.style.pointerEvents = '';
        preInput.style.opacity = '';
    }
}

// Download de planilha modelo de agendamento (Simulação de geração CSV)
function downloadAgendamentoModelCSV() {
    const csvContent = "MATRICULA;CPF;NOME_COMPLETO;TELEFONE;DIRETORIA;DEPARTAMENTO;CARGO;ORIGEM;DESTINO;DATA_VIAGEM;HORA_VIAGEM;TIPO_ATENDIMENTO;ACOMPANHANTES;REPLICAR_DIAS\n" +
                       "82093;;Juliana Gonçalves da Silva;21994073626;FINAN�!AS_JURIDICO_E_INFRA;TRANSPORTES;ANL SERVICOS I;EG;Sambodromo;2026-02-15;17:00;Vai e Vem Van;;Sim\n" +
                       ";11536422711;Juliana Terceiro;21994073626;PRESTADOR DE SERVI�!OS;TRANSPORTES;Prestador;JB;Sambodromo;2026-02-15;18:00;Executivo;João Silva (Editor);Não";
                       
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `Modelo_Agendamento_CCO_Eventos.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function simulateBulkBookingUpload() {
    const allDates = getEventDates();
    const masterList = [...(db.collaborators || []), ...(db.accredited || [])];
    const candidates = masterList.filter(ac => !db.bookings.some(b => (b.matricula === ac.matricula || b.cpf === ac.cpf) && b.status !== 'Cancelado')).slice(0, 5);
    
    if (candidates.length === 0) {
        alert("Aviso: Todos os credenciados disponíveis já possuem agendamentos ativos.");
        return;
    }
    
    pendingBookings = [];
    pendingBookingSource = 'bulk';
    
    candidates.forEach((ac, idx) => {
        const isReplicated = idx % 2 === 0;
        const baseDate = allDates[0];
        const site = idx % 2 === 0 ? 'EG' : 'JB';
        
        pendingBookings.push({
            person: ac,
            date: baseDate,
            enableVai: true,
            vaiOrigin: site,
            vaiTime: '17:00',
            enableVem: true,
            vemDest: site,
            vemTime: '23:00',
            serviceType: 'Vai e Vem Van',
            accompany: '',
            canal: 'Importação'
        });
        
        if (isReplicated) {
            allDates.forEach(d => {
                if (d !== baseDate) {
                    pendingBookings.push({
                        person: ac,
                        date: d,
                        enableVai: true,
                        vaiOrigin: site,
                        vaiTime: '17:00',
                        enableVem: true,
                        vemDest: site,
                        vemTime: '23:00',
                        serviceType: 'Vai e Vem Van',
                        accompany: '',
                        canal: 'Importação'
                    });
                }
            });
        }
    });
    
    openReplicationReviewModal('bulk');
}

function simulateInstructionsWhatsApp() {
    toggleWhatsappModal(true, 'pre');
} 



// --- TOTEM QR CODE SIMULATOR ---
function generateTotemQRCodes() {
    const renderQR = (canvasId, data) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        canvas.width = 110;
        canvas.height = 110;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 110, 110);
        
        // Desenha caixas de calibração do QR
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(10, 10, 30, 30);
        ctx.fillRect(70, 10, 30, 30);
        ctx.fillRect(10, 70, 30, 30);
        ctx.fillStyle = '#000000';
        ctx.fillRect(15, 15, 20, 20);
        ctx.fillRect(75, 15, 20, 20);
        ctx.fillRect(15, 75, 20, 20);
        
        // Pontos aleatórios
        ctx.fillStyle = '#ffffff';
        for (let x = 10; x < 100; x += 5) {
            for (let y = 10; y < 100; y += 5) {
                if ((x < 45 && y < 45) || (x > 65 && y < 45) || (x < 45 && y > 65)) continue;
                if (Math.random() > 0.4) {
                    ctx.fillRect(x, y, 4, 4);
                }
            }
        }
    };
    renderQR('totem-qr-eg', 'EG');
    renderQR('totem-qr-jb', 'JB');
    renderQR('totem-qr-ion', 'ION');
}

function toggleTotemModal(show) {
    const modal = document.getElementById('modal-totem');
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function simulateTotemScan(base) {
    toggleTotemModal(false);
    switchTab('passenger');
    
    // Configura o totem nas caixas de agendamento móvel
    const vaiOrigin = document.getElementById('pass-vai-origin');
    if (vaiOrigin) vaiOrigin.value = base;
    
    const vemDest = document.getElementById('pass-vem-destination');
    if (vemDest) vemDest.value = base;
    
    // Ativa ambas as viagens por padrão
    const checkVai = document.getElementById('pass-enable-vai');
    if (checkVai) {
        checkVai.checked = true;
        toggleLegInputs('pass', 'vai');
    }
    const checkVem = document.getElementById('pass-enable-vem');
    if (checkVem) {
        checkVem.checked = true;
        toggleLegInputs('pass', 'vem');
    }
    
    // Focus matricula
    document.getElementById('pass-id').focus();
    
    showToast("Totem Escaneado", `Celular do passageiro conectado ao Totem da base ${base === 'EG' ? 'Estúdios Globo' : (base === 'JB' ? 'Jardim Botânico' : 'Íon (Barra)')}.`, "success");
}

// --- DINAMIZA�!ÒO DE SELETORES DE CHECK-IN (PASSAGEIRO) ---
function updatePassengerRoutes() {
    // Deprecated in favor of dual leg boxes
}

function updateAvailableTimes() {
    const enableVai = document.getElementById('pass-enable-vai').checked;
    const enableVem = document.getElementById('pass-enable-vem').checked;
    const timeSelect = document.getElementById('pass-time');
    const vemTimeSelect = document.getElementById('pass-vem-time');
    const vemTimeContainer = document.getElementById('pass-vem-time-container');

    if (!timeSelect) return;

    const currentVal = timeSelect.value;

    timeSelect.innerHTML = '';
    if (enableVai) {
        const base = document.getElementById('pass-vai-origin').value;
        getAvailableHours('VAI', currentEvent, base).forEach(h => timeSelect.appendChild(createOption(h, h)));
    } else if (enableVem) {
        const base = document.getElementById('pass-vem-destination').value;
        getAvailableHours('VEM', currentEvent, base).forEach(h => timeSelect.appendChild(createOption(h, h)));
    }

    if (currentVal && Array.from(timeSelect.options).some(opt => opt.value === currentVal)) {
        timeSelect.value = currentVal;
    }

    if (enableVai && enableVem) {
        if (vemTimeContainer) vemTimeContainer.classList.remove('hidden');
        if (vemTimeSelect) {
            const currentVemVal = vemTimeSelect.value;
            vemTimeSelect.innerHTML = '';
            const base = document.getElementById('pass-vem-destination').value;
            getAvailableHours('VEM', currentEvent, base).forEach(h => vemTimeSelect.appendChild(createOption(h, h)));
            if (currentVemVal && Array.from(vemTimeSelect.options).some(opt => opt.value === currentVemVal)) {
                vemTimeSelect.value = currentVemVal;
            }
        }
    } else {
        if (vemTimeContainer) vemTimeContainer.classList.add('hidden');
    }
}

function togglePassengerListField(serviceType) {
    const listDiv = document.getElementById('div-passenger-list');
    const textarea = document.getElementById('pass-list');
    if (listDiv) listDiv.classList.add('hidden');
    if (textarea) textarea.removeAttribute('required');
}

// Popula o seletor de check-in apenas com as datas que possuem agendamento ativo
function populatePassengerDates(person) {
    const select = document.getElementById('pass-date');
    if (!select) return [];
    
    const bookings = getCollaboratorEventBookings(person.matricula, person.cpf);
    const uniqueDates = [...new Set(bookings.map(b => b.data))].sort();
    
    select.innerHTML = '';
    
    if (uniqueDates.length === 0) {
        return [];
    }
    
    uniqueDates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        const parts = d.split('-');
        opt.textContent = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
        select.appendChild(opt);
    });
    
    return uniqueDates;
}

// Sincroniza os checkboxes e horários do formulário de check-in de acordo com o agendamento da data selecionada
function updatePassengerFormForSelectedDate() {
    const passId = document.getElementById('pass-id').value.trim();
    const date = document.getElementById('pass-date').value;
    
    if (!passId || !date) return;
    
    const person = findPerson(passId);
    if (!person) return;
    
    const bookings = db.bookings.filter(b => 
        (b.status === 'Agendado' || b.status === 'Embarcado') && 
        (b.matricula === person.matricula || (person.cpf && b.cpf === person.cpf)) && 
        b.data === date
    );
    
    const hasVai = bookings.some(b => b.origem !== getEventLocationName());
    const hasVem = bookings.some(b => b.origem === getEventLocationName());
    
    const chkVai = document.getElementById('pass-enable-vai');
    const chkVem = document.getElementById('pass-enable-vem');
    
    chkVai.checked = hasVai;
    chkVem.checked = hasVem;
    
    toggleLegInputs('pass', 'vai');
    toggleLegInputs('pass', 'vem');
    
    if (hasVai) {
        const vaiBooking = bookings.find(b => b.origem !== getEventLocationName());
        document.getElementById('pass-vai-origin').value = vaiBooking.origem;
        updateAvailableTimes();
        document.getElementById('pass-time').value = vaiBooking.hora;
    }
    
    if (hasVem) {
        const vemBooking = bookings.find(b => b.origem === getEventLocationName());
        document.getElementById('pass-vem-destination').value = vemBooking.destino;
        updateAvailableTimes();
        const vemTimeSelect = document.getElementById('pass-vem-time');
        if (vemTimeSelect) {
            vemTimeSelect.value = vemBooking.hora;
        }
    }
}

async function lookupCollaborator(idVal) {
    if (idVal.trim().length >= 3) await fetchAndCachePerson(idVal.trim());
    const id = idVal.trim();
    const msg = document.getElementById('pass-lookup-msg');
    const fields = document.getElementById('pass-details-fields');
    
    if (id.length < 3) {
        msg.classList.add('hidden');
        fields.classList.add('hidden');
        return;
    }
    
    const person = findPerson(id);
    if (person) {
        const activeDates = populatePassengerDates(person);
        
        if (activeDates.length === 0) {
            msg.classList.remove('hidden');
            msg.className = "text-[11px] mt-1 text-red-500 font-bold leading-normal";
            msg.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> Acesso Negado: Nenhum agendamento ativo encontrado para este colaborador neste evento.`;
            fields.classList.add('hidden');
            return;
        }
        
        msg.classList.remove('hidden');
        msg.className = "text-[11px] mt-1 text-emerald-400 font-semibold";
        msg.textContent = "�S Colaborador Credenciado";
        
        fields.classList.remove('hidden');
        document.getElementById('lbl-pass-name').textContent = person.nome;
        document.getElementById('lbl-pass-cargo').textContent = person.cargo || "Funcionário";
        document.getElementById('lbl-pass-dept').textContent = getN1Area(person);
        
        const companyLabel = document.getElementById('lbl-pass-company');
        if (companyLabel) {
            companyLabel.textContent = person.empresa || (person.tipo_vinculo === 'GLOBO' ? 'Globo' : 'Terceiro');
        }
        
        updatePassengerFormForSelectedDate();
    } else {
        msg.classList.remove('hidden');
        msg.className = "text-[11px] mt-1 text-red-400 font-bold";
        msg.textContent = "�S Acesso Negado: Não credenciado para o evento";
        fields.classList.add('hidden');
    }
}

// --- SUBMISSÒO E VALIDA�!ÒO DE CHECK-IN (PASSAGEIRO) ---
function handlePassengerSubmit() {
    const passId = document.getElementById('pass-id').value.trim();
    const serviceType = document.getElementById('pass-service-type').value;
    const accompany = "";
    const date = document.getElementById('pass-date').value;

    const person = findPerson(passId);
    if (!person) {
        alert("Erro: Este colaborador não está credenciado no evento.");
        return;
    }

    const enableVai = document.getElementById('pass-enable-vai').checked;
    const enableVem = document.getElementById('pass-enable-vem').checked;

    if (!enableVai && !enableVem) {
        alert("Erro: Selecione pelo menos uma das opções de viagem (Ida ou Retorno).");
        return;
    }

    // Validações
    if (enableVai) {
        const origin = document.getElementById('pass-vai-origin').value;
        const dest = getEventLocationName();
        let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === passId || b.cpf === passId) && b.data === date && b.origem === origin && b.destino === dest);
        if (!booking) {
            document.getElementById('pass-lookup-msg').classList.remove('hidden');
            document.getElementById('pass-lookup-msg').className = "text-[11px] mt-1 text-red-500 font-bold leading-normal";
            document.getElementById('pass-lookup-msg').innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> Acesso Negado: Nenhum agendamento ativo para Ida (Vai) encontrado neste horário. Procure o Operador no guichê.`;
            alert("Atenção: Você não possui agendamento ativo para a Ida (Vai) neste horário. Dirija-se ao Operador.");
            return;
        }
    }

    if (enableVem && !enableVai) {
        const dest = document.getElementById('pass-vem-destination').value;
        const origin = getEventLocationName();
        let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === passId || b.cpf === passId) && b.data === date && b.origem === origin && b.destino === dest);
        if (!booking) {
            document.getElementById('pass-lookup-msg').classList.remove('hidden');
            document.getElementById('pass-lookup-msg').className = "text-[11px] mt-1 text-red-500 font-bold leading-normal";
            document.getElementById('pass-lookup-msg').innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> Acesso Negado: Nenhum agendamento ativo para Volta (Vem) encontrado neste horário. Procure o Operador.`;
            alert("Atenção: Você não possui agendamento ativo para a Volta (Vem) neste horário. Dirija-se ao Operador.");
            return;
        }
    }

    const vaiOrigin = enableVai ? document.getElementById('pass-vai-origin').value : 'EG';
    const vaiTime = enableVai ? document.getElementById('pass-time').value : '17:00';
    const vemDest = enableVem ? document.getElementById('pass-vem-destination').value : 'EG';
    const vemTime = enableVem ? (enableVai ? document.getElementById('pass-vem-time').value : document.getElementById('pass-time').value) : '23:00';

    const targetDates = getReplicationTargetDates('pass', date);
    pendingBookings = [];

    targetDates.forEach(d => {
        pendingBookings.push({
            person: person,
            date: d,
            enableVai: enableVai,
            vaiOrigin: vaiOrigin,
            vaiTime: vaiTime,
            enableVem: enableVem,
            vemDest: vemDest,
            vemTime: vemTime,
            serviceType: serviceType,
            accompany: accompany,
            canal: 'QR Code'
        });
    });

    openReplicationReviewModal('pass', person, serviceType, accompany, date, 'QR Code');
}

// Helper para pegar o local do evento baseado na data da viagem
function getEventLocationNameFromDate(dateStr) {
    if (dateStr && (dateStr.startsWith('2026-09') || dateStr.startsWith('2024'))) {
        return 'Rock in Rio';
    }
    return 'Carnaval';
}

// Helper para buscar todos os agendamentos ativos do colaborador no evento atual
function getCollaboratorEventBookings(matricula, cpf) {
    const dates = getEventDates();
    return db.bookings.filter(b => 
        ((matricula && b.matricula === matricula) || (cpf && b.cpf === cpf)) && 
        b.status !== 'Cancelado' && 
        dates.includes(b.data)
    ).sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));
}

// Renderiza a listagem de datas e horários confirmados no cartão de embarque
function renderDatesList(containerId, listId, bookings) {
    const box = document.getElementById(containerId);
    const list = document.getElementById(listId);
    if (!box || !list) return;
    
    list.innerHTML = '';
    
    if (bookings.length === 0) {
        box.classList.add('hidden');
        return;
    }
    
    // Agrupa as pernas por data
    const groups = {};
    bookings.forEach(b => {
        if (!groups[b.data]) {
            groups[b.data] = { vai: null, vem: null, vaiOrigem: '', vemDestino: '' };
        }
        if (b.origem === getEventLocationName()) {
            groups[b.data].vem = b.hora;
            groups[b.data].vemDestino = b.destino;
        } else {
            groups[b.data].vai = b.hora;
            groups[b.data].vaiOrigem = b.origem;
        }
    });
    
    const dates = Object.keys(groups).sort();
    
    dates.forEach(d => {
        const parts = d.split('-');
        const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
        const g = groups[d];
        
        let legs = [];
        if (g.vai) {
            legs.push(`<span class="text-blue-400 font-semibold">Vai (${g.vaiOrigem || 'EG'} x Evento):</span> ${g.vai}`);
        }
        if (g.vem) {
            legs.push(`<span class="text-indigo-400 font-semibold">Vem (Evento x ${g.vemDestino || 'EG'}):</span> ${g.vem}`);
        }
        
        const div = document.createElement('div');
        div.className = "flex justify-between items-center py-1 border-b border-gray-900/45 last:border-b-0 text-[10px]";
        div.innerHTML = `
            <span class="font-bold text-white"><i class="fa-solid fa-calendar-day mr-1 text-gray-500"></i>${dateStr}</span>
            <span class="space-x-2 text-gray-300">${legs.join(' | ')}</span>
        `;
        list.appendChild(div);
    });
    
    box.classList.remove('hidden');
}

// Renderiza o Ticket/Cartão de Embarque Digital
function renderTicket(booking) {
    document.getElementById('passenger-booking-pane').classList.add('hidden');
    const ticketPane = document.getElementById('passenger-ticket-pane');
    ticketPane.classList.remove('hidden');

    const eventLoc = getEventLocationNameFromDate(booking.data);

    document.getElementById('ticket-route-from-sig').textContent = booking.origem === getEventLocationName() ? (eventLoc === 'Rock in Rio' ? 'RIR' : 'SAMB') : booking.origem;
    document.getElementById('ticket-route-from').textContent = booking.origem === 'EG' ? 'Estúdios Globo' : (booking.origem === 'JB' ? 'Jardim Botânico' : (booking.origem === 'ION' ? 'Íon (Barra)' : eventLoc));
    
    document.getElementById('ticket-route-to-sig').textContent = booking.destino === getEventLocationName() ? (eventLoc === 'Rock in Rio' ? 'RIR' : 'SAMB') : booking.destino;
    document.getElementById('ticket-route-to').textContent = booking.destino === getEventLocationName() ? eventLoc : (booking.destino === 'EG' ? 'Estúdios Globo' : (booking.destino === 'JB' ? 'Jardim Botânico' : 'Íon (Barra)'));

    const svcBadge = document.getElementById('ticket-service-badge');
    svcBadge.textContent = booking.service_type || 'Van';

    // Ajusta dinamicamente o ícone do transporte (Van ou Carro Passeio/Executivo)
    const isVan = (booking.service_type || '').includes('Van');
    const iconEl = document.getElementById('ticket-vehicle-icon');
    if (iconEl) {
        iconEl.className = isVan ? "fa-solid fa-van-shuttle text-sm opacity-80" : "fa-solid fa-car text-sm opacity-80";
    }

    document.getElementById('ticket-passenger-name').textContent = booking.nome;
    document.getElementById('ticket-passenger-id').textContent = booking.matricula || booking.cpf;
    
    const parts = booking.data.split('-');
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}` : booking.data;
    document.getElementById('ticket-date-time').textContent = `${dateStr} | ${booking.hora}`;
    
    document.getElementById('ticket-localizador').textContent = booking.id;

    const accBox = document.getElementById('ticket-accompany-box');
    const accList = document.getElementById('ticket-accompany-list');
    if (booking.accompany && booking.accompany.trim() !== '') {
        accBox.classList.remove('hidden');
        accList.textContent = booking.accompany;
    } else {
        accBox.classList.add('hidden');
    }

    // Renderiza a lista de todas as datas e horários confirmados
    const userBookings = getCollaboratorEventBookings(booking.matricula, booking.cpf);
    renderDatesList('ticket-dates-box', 'ticket-dates-list', userBookings);

    // Geração dinâmica do QR Code com fallback
    const qrContainer = document.getElementById('ticket-qrcode');
    qrContainer.innerHTML = '';
    
    if (window.QRCode) {
        const checkinUrl = window.location.origin + window.location.pathname + "?ticket=" + encodeURIComponent(booking.id);
        new QRCode(qrContainer, {
            text: checkinUrl,
            width: 100,
            height: 100,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    } else {
        qrContainer.innerHTML = `<div style="width: 100px; height: 100px; background-color: #333; color: white; display: flex; align-items: center; justify-content: center; font-size: 8px;">QR Code Fallback</div>`;
    }
}

// Renderiza o Ticket/Cartão de Agendamento Digital para Pré-Agendamento
function renderPreTicket(booking) {
    document.getElementById('pre-booking-instructions-empty').classList.add('hidden');
    document.getElementById('pre-booking-instructions-active').classList.remove('hidden');

    const eventLoc = getEventLocationNameFromDate(booking.data);

    document.getElementById('pre-ticket-route-from-sig').textContent = booking.origem === getEventLocationName() ? (eventLoc === 'Rock in Rio' ? 'RIR' : 'SAMB') : booking.origem;
    document.getElementById('pre-ticket-route-from').textContent = booking.origem === 'EG' ? 'Estúdios Globo' : (booking.origem === 'JB' ? 'Jardim Botânico' : (booking.origem === 'ION' ? 'Íon (Barra)' : eventLoc));
    
    document.getElementById('pre-ticket-route-to-sig').textContent = booking.destino === getEventLocationName() ? (eventLoc === 'Rock in Rio' ? 'RIR' : 'SAMB') : booking.destino;
    document.getElementById('pre-ticket-route-to').textContent = booking.destino === getEventLocationName() ? eventLoc : (booking.destino === 'EG' ? 'Estúdios Globo' : (booking.destino === 'JB' ? 'Jardim Botânico' : 'Íon (Barra)'));

    const svcBadge = document.getElementById('pre-ticket-service-badge');
    svcBadge.textContent = booking.service_type || 'Van';

    // Ajusta dinamicamente o ícone do transporte (Van ou Carro Passeio/Executivo)
    const isVan = (booking.service_type || '').includes('Van');
    const iconEl = document.getElementById('pre-ticket-vehicle-icon');
    if (iconEl) {
        iconEl.className = isVan ? "fa-solid fa-van-shuttle text-sm opacity-80" : "fa-solid fa-car text-sm opacity-80";
    }

    document.getElementById('pre-ticket-passenger-name').textContent = booking.nome;
    document.getElementById('pre-ticket-passenger-id').textContent = booking.matricula || booking.cpf;
    
    const parts = booking.data.split('-');
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}` : booking.data;
    document.getElementById('pre-ticket-date-time').textContent = `${dateStr} | ${booking.hora}`;
    
    document.getElementById('pre-ticket-localizador').textContent = booking.id;

    const accBox = document.getElementById('pre-ticket-accompany-box');
    const accList = document.getElementById('pre-ticket-accompany-list');
    if (booking.accompany && booking.accompany.trim() !== '') {
        accBox.classList.add('hidden');
        accList.textContent = booking.accompany;
    } else {
        accBox.classList.add('hidden');
    }

    // Renderiza a lista de todas as datas e horários confirmados
    const userBookings = getCollaboratorEventBookings(booking.matricula, booking.cpf);
    renderDatesList('pre-ticket-dates-box', 'pre-ticket-dates-list', userBookings);

    // Geração dinâmica do QR Code com fallback
    const qrContainer = document.getElementById('pre-ticket-qrcode');
    qrContainer.innerHTML = '';
    
    if (window.QRCode) {
        const checkinUrl = window.location.origin + window.location.pathname + "?ticket=" + encodeURIComponent(booking.id);
        new QRCode(qrContainer, {
            text: checkinUrl,
            width: 100,
            height: 100,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    } else {
        qrContainer.innerHTML = `<div style="width: 100px; height: 100px; background-color: #333; color: white; display: flex; align-items: center; justify-content: center; font-size: 8px;">QR Code Fallback</div>`;
    }
}

function editCurrentPreBooking() {
    const id = document.getElementById('pre-ticket-passenger-id').textContent;
    if (!id || id === '-') {
        alert("Erro: Nenhum colaborador selecionado para edição.");
        return;
    }
    
    const person = findPerson(id);
    if (!person) {
        alert("Erro: Colaborador não encontrado.");
        return;
    }
    
    const bookings = getCollaboratorEventBookings(person.matricula, person.cpf);
    if (bookings.length === 0) {
        alert("Erro: Nenhum agendamento ativo encontrado para este colaborador.");
        return;
    }
    
    document.getElementById('pre-id').value = id;
    lookupPreBookingCollaborator(id);
    
    const vaiB = bookings.find(b => b.destino === getEventLocationName());
    const vemB = bookings.find(b => b.origem === getEventLocationName());
    const firstB = bookings[0];
    
    if (vaiB) {
        document.getElementById('pre-enable-vai').checked = true;
        document.getElementById('pre-vai-origin').value = vaiB.origem;
        document.getElementById('pre-time').value = vaiB.hora;
        toggleLegInputs('pre', 'vai');
    } else {
        document.getElementById('pre-enable-vai').checked = false;
        toggleLegInputs('pre', 'vai');
    }
    
    if (vemB) {
        document.getElementById('pre-enable-vem').checked = true;
        document.getElementById('pre-vem-destination').value = vemB.destino;
        if (vaiB) {
            document.getElementById('pre-vem-time').value = vemB.hora;
        } else {
            document.getElementById('pre-time').value = vemB.hora;
        }
        toggleLegInputs('pre', 'vem');
    } else {
        document.getElementById('pre-enable-vem').checked = false;
        toggleLegInputs('pre', 'vem');
    }
    
    const serviceType = firstB.service_type || 'Vai e Vem Van';
    document.getElementById('pre-service-type').value = serviceType;
    togglePreBookingPassengerList(serviceType);
    
    document.getElementById('pre-list').value = firstB.accompany || '';
    document.getElementById('pre-date').value = firstB.data;
    
    setReplicationChoice('pre', 'nao');
    
    const allEventDates = getEventDates();
    allEventDates.forEach(d => {
        const checkbox = document.getElementById(`pre-day-${d}`);
        if (checkbox) checkbox.checked = false;
    });
    
    bookings.forEach(b => {
        const checkbox = document.getElementById(`pre-day-${b.data}`);
        if (checkbox) checkbox.checked = true;
    });
    
    document.getElementById('pre-id').focus();
    showToast("Edição de Agendamento", "Altere as opções no formulário de pré-agendamento (à esquerda) e clique em Reservar Assento.", "info");
}

function resetPassengerForm() {
    document.getElementById('passenger-booking-pane').classList.remove('hidden');
    document.getElementById('passenger-ticket-pane').classList.add('hidden');
    
    document.getElementById('form-booking').reset();
    document.getElementById('pass-lookup-msg').classList.add('hidden');
    document.getElementById('pass-details-fields').classList.add('hidden');
    document.getElementById('div-passenger-list').classList.add('hidden');
    
    const select = document.getElementById('pass-date');
    if (select) select.innerHTML = '';
    
    document.getElementById('pass-enable-vai').checked = true;
    document.getElementById('pass-enable-vem').checked = true;
    toggleLegInputs('pass', 'vai');
    toggleLegInputs('pass', 'vem');
    setReplicationChoice('pass', 'nao');
}

// --- FILTROS E OPERA�!ÒO DO DESPACHO (OPERA�!ÒO) ---
function populateOperationFilters() {
    const dateSelect = document.getElementById('op-date');
    const timeSelect = document.getElementById('op-time');
    const companySelect = document.getElementById('op-company');
    const opRouteSelect = document.getElementById('op-route');

    if (opRouteSelect) {
        const eventName = getEventLocationName();
        opRouteSelect.options[0].text = `EG x ${eventName} (Ida)`;
        opRouteSelect.options[1].text = `${eventName} x EG (Retorno)`;
        opRouteSelect.options[2].text = `JB x ${eventName} (Ida)`;
        opRouteSelect.options[3].text = `${eventName} x JB (Retorno)`;
    }

    if (!dateSelect) return;

    // 1. Datas
    const activeDates = getEventDates();
    const currDate = dateSelect.value;
    dateSelect.innerHTML = '';
    activeDates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        const parts = d.split('-');
        opt.textContent = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
        dateSelect.appendChild(opt);
    });
    if (currDate && activeDates.includes(currDate)) dateSelect.value = currDate;

    // 2. Horários baseados na Rota
    const route = document.getElementById('op-route').value;
    const routeParts = route.split(' x ');
    const dest = routeParts[1];
    const direction = (dest === getEventLocationName()) ? 'VAI' : 'VEM';
    const base = direction === 'VAI' ? routeParts[0] : routeParts[1];
    const activeTimes = getAvailableHours(direction, currentEvent, base);
    
    const currTime = timeSelect.value;
    timeSelect.innerHTML = '';
    activeTimes.forEach(t => timeSelect.appendChild(createOption(t, t)));
    if (currTime && activeTimes.includes(currTime)) {
        timeSelect.value = currTime;
    } else {
        timeSelect.value = activeTimes[0];
    }

    // 3. Empresas de transporte
    const activeCompanies = [...new Set(db.trips.map(t => t.empresa_transporte))];
    const currComp = companySelect.value;
    companySelect.innerHTML = '<option value="ALL">Todas as Empresas</option>';
    activeCompanies.forEach(c => {
        if (c) companySelect.appendChild(createOption(c, c));
    });
    if (currComp) companySelect.value = currComp;
}

function refreshOperationList() {
    const route = document.getElementById('op-route').value;
    const date = document.getElementById('op-date').value;
    const time = document.getElementById('op-time').value;
    const serviceType = document.getElementById('op-service-type').value;
    const company = document.getElementById('op-company').value;
    const search = document.getElementById('op-search').value.toLowerCase().trim();

    const orig = route.split(' x ')[0];
    const dest = route.split(' x ')[1];
    const escopo = (dest === getEventLocationName()) ? 'VAI' : 'VEM';

    const trip_id = `${orig}_${escopo}_${date}_${time ? time.replace(':', '') : ''}`;
    const trip = db.trips.find(t => t.id === trip_id);

    // Filtra agendamentos da viagem ativa
    let bookings = db.bookings.filter(b => b.trip_id === trip_id && b.status !== 'Cancelado');

    if (search) {
        bookings = bookings.filter(b => b.nome.toLowerCase().includes(search) || b.matricula.includes(search) || b.cpf.includes(search));
    }
    if (serviceType !== 'ALL') {
        bookings = bookings.filter(b => (b.service_type || 'Vai e Vem Van') === serviceType);
    }
    if (company !== 'ALL' && trip && trip.empresa_transporte !== company) {
        bookings = [];
    }

    // Atualiza Painel de Capacidade
    const bookedCount = bookings.length;
    const capMax = (serviceType === 'Vai e Vem Van' || (trip && trip.tipo_atendimento === 'Vai e Vem Van')) ? 15 : (trip ? trip.capacidade : 4);
    
    const ontimeCount = bookings.filter(b => b.status === 'Embarcado' && b.status_checkin === 'No Horário').length;
    const offtimeCount = bookings.filter(b => b.status === 'Embarcado' && b.status_checkin === 'Fora de Horário').length;
    const encaixeCount = bookings.filter(b => b.status === 'Embarcado' && b.tipo === 'Encaixe').length;
    const noshowCount = bookings.filter(b => b.status === 'No-Show' || (b.status === 'Agendado' && new Date(`${date}T${time}`) < new Date())).length;

    document.getElementById('op-lbl-reservas').textContent = bookedCount;
    document.getElementById('op-lbl-capacidade').textContent = capMax;
    document.getElementById('op-lbl-boarded-ontime').textContent = ontimeCount;
    document.getElementById('op-lbl-boarded-offtime').textContent = offtimeCount;
    document.getElementById('op-lbl-boarded-encaixe').textContent = encaixeCount;
    document.getElementById('op-lbl-noshow').textContent = noshowCount;
    
    const seatsLeft = capMax - bookedCount;
    const seatsLeftSpan = document.getElementById('op-lbl-seats-left');
    if (seatsLeft > 0) {
        seatsLeftSpan.textContent = `${seatsLeft} livres`;
        seatsLeftSpan.className = "text-xs font-semibold text-blue-400";
    } else if (seatsLeft === 0) {
        seatsLeftSpan.textContent = `Lotado`;
        seatsLeftSpan.className = "text-xs font-semibold text-emerald-400";
    } else {
        seatsLeftSpan.textContent = `Fila (${Math.abs(seatsLeft)})`;
        seatsLeftSpan.className = "text-xs font-semibold text-amber-500";
    }

    const pct = Math.min((bookedCount / capMax) * 100, 100);
    const progressBar = document.getElementById('op-progress-capacity');
    progressBar.style.width = `${pct}%`;
    progressBar.className = pct >= 100 ? "bg-emerald-500 h-full rounded-full transition-all" : pct >= 80 ? "bg-amber-500 h-full rounded-full transition-all" : "bg-blue-600 h-full rounded-full transition-all";

    // Preenche Tabela
    const tbody = document.getElementById('op-passengers-tbody');
    const emptyState = document.getElementById('op-empty-state');
    tbody.innerHTML = '';

    if (bookings.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        
        bookings.forEach(b => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-900/30 transition-colors text-xs";
            
            let statusBadge = '';
            if (b.status === 'Embarcado') {
                const subStatus = b.status_checkin || 'No Horário';
                const subClass = subStatus === 'No Horário' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
                statusBadge = `<span class="${subClass} border px-2 py-0.5 rounded text-[10px] font-bold uppercase">Emb. (${subStatus})</span>`;
            } else if (b.status === 'No-Show') {
                statusBadge = '<span class="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">No-Show</span>';
            } else if (b.status === 'Fila de Espera') {
                statusBadge = '<span class="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Fila Espera</span>';
            } else {
                statusBadge = '<span class="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Agendado</span>';
            }

            const docInfo = b.matricula ? `MAT: ${b.matricula}` : `CPF: ${b.cpf}`;
            const labelEncaixe = b.tipo === 'Encaixe' ? '<span class="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1 rounded ml-1 font-bold">ENCAIXE</span>' : '';

            let actionButtons = '';
            if (b.status !== 'Embarcado') {
                actionButtons += `
                    <button onclick="dispatchBipCheckin('${b.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[10px] font-bold transition mr-1">
                        <i class="fa-solid fa-user-check"></i> Bipar
                    </button>
                    <button onclick="openRescheduleModal('${b.id}')" class="bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-[10px] border border-gray-700 transition">
                        <i class="fa-solid fa-clock-rotate-left"></i> Remanejar
                    </button>
                `;
            } else {
                actionButtons += `
                    <button onclick="cancelBoarding('${b.id}')" class="bg-gray-900 border border-gray-800 hover:bg-gray-850 text-gray-500 hover:text-red-400 px-2 py-1 rounded text-[10px] transition">
                        <i class="fa-solid fa-user-slash"></i> Desfazer
                    </button>
                `;
            }

            tr.innerHTML = `
                <td class="py-3 px-4">
                    <div class="font-bold text-white">${b.nome} ${labelEncaixe}</div>
                    <div class="text-[10px] text-gray-500 font-mono">${b.cargo || 'Funcionário'}</div>
                </td>
                <td class="py-3 px-4">
                    <div class="font-semibold text-gray-300">${docInfo}</div>
                    <div class="text-[10px] text-gray-500">${b.departamento || 'Geral'}</div>
                </td>
                <td class="py-3 px-4">
                    <div class="font-medium text-gray-300">${b.service_type || 'Vai e Vem Van'}</div>
                    <div class="text-[10px] text-gray-500">${trip ? trip.empresa_transporte : 'Globo CCO'}</div>
                </td>
                <td class="py-3 px-4 text-center text-gray-400 font-medium">${b.canal_entrada || 'Site'}</td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-right">${actionButtons}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// Bipagem operacional
function dispatchBipCheckin(bookingId, checkinType = 'No Horário') {
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    booking.status = 'Embarcado';
    booking.status_checkin = checkinType;
    if (typeof syncBookingCheckin === 'function') syncBookingCheckin(booking.id, checkinType);

    const trip = db.trips.find(t => t.id === booking.trip_id);
    if (trip) trip.real = (trip.real || 0) + 1;

    saveDatabase();
    refreshOperationList();
    showToast("Embarque Confirmado", `${booking.nome} embarcou no veículo (${checkinType}).`, "success");
}

function cancelBoarding(bookingId) {
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    booking.status = 'Agendado';
    delete booking.status_checkin;

    const trip = db.trips.find(t => t.id === booking.trip_id);
    if (trip && trip.real > 0) trip.real -= 1;

    saveDatabase();
    refreshOperationList();
    showToast("Embarque Cancelado", `Embarque de ${booking.nome} desfeito.`, "info");
}

function simulateBipCheckin() {
    const val = document.getElementById('op-barcode-input').value.trim();
    if (!val) return;

    const route = document.getElementById('op-route').value;
    const date = document.getElementById('op-date').value;
    const time = document.getElementById('op-time').value;
    const orig = route.split(' x ')[0];
    const dest = route.split(' x ')[1];
    const escopo = (dest === getEventLocationName()) ? 'VAI' : 'VEM';
    const trip_id = `${orig}_${escopo}_${date}_${time.replace(':', '')}`;

    // 1. Procurar agendamento exato para a viagem ativa
    let booking = db.bookings.find(b => b.trip_id === trip_id && b.status !== 'Cancelado' && (b.id === val || b.matricula === val || b.cpf === val));
    
    if (booking) {
        dispatchBipCheckin(booking.id, 'No Horário');
        document.getElementById('op-barcode-input').value = '';
    } else {
        // 2. Procurar agendamento em outra hora do mesmo dia (Mover e Bipar fora de horário)
        booking = db.bookings.find(b => b.status === 'Agendado' && b.data === date && b.origem === orig && b.destino === dest && (b.matricula === val || b.cpf === val));
        
        if (booking) {
            if (confirm(`Passageiro ${booking.nome} tem agendamento para o horário ${booking.hora}. Deseja registrar o embarque FORA DO HORÁRIO planejado neste veículo?`)) {
                const oldTripId = booking.trip_id;
                booking.hora = time;
                booking.trip_id = trip_id;
                booking.status_checkin = 'Fora de Horário';
                booking.status = 'Embarcado';
                if (typeof syncBookingCheckin === 'function') syncBookingCheckin(booking.id, 'Fora de Horário');
                
                const oldTrip = db.trips.find(t => t.id === oldTripId);
                if (oldTrip && oldTrip.planejado > 0) oldTrip.planejado -= 1;
                
                const newTrip = db.trips.find(t => t.id === trip_id);
                if (newTrip) newTrip.real = (newTrip.real || 0) + 1;
                
                saveDatabase();
                refreshOperationList();
                document.getElementById('op-barcode-input').value = '';
                showToast("Embarque Fora de Horário", `Embarque de ${booking.nome} registrado no horário ${time}.`, "warning");
            }
        } else {
            // 3. Cadastrar como Encaixe rápido (Walk-in)
            const person = findPerson(val);
            if (person) {
                if (confirm(`Nenhum agendamento encontrado para o credenciado ${person.nome}. Deseja realizar um ENCAIXE rápido neste veículo?`)) {
                    const newBooking = {
                        id: `enc_${Date.now()}`,
                        matricula: person.matricula || "",
                        cpf: person.cpf || "",
                        nome: person.nome,
                        origem: orig,
                        destino: dest,
                        data: date,
                        hora: time,
                        trip_id: trip_id,
                        status: 'Embarcado',
                        tipo: 'Encaixe',
                        canal_entrada: 'Site',
                        cargo: person.cargo || "Encaixe",
                        departamento: getN1Area(person),
                        service_type: document.getElementById('op-service-type').value !== 'ALL' ? document.getElementById('op-service-type').value : 'Vai e Vem Van'
                    };
                    db.bookings.push(newBooking);
                    syncBookingCreate(newBooking);
                    
                    const trip = db.trips.find(t => t.id === trip_id);
                    if (trip) trip.real = (trip.real || 0) + 1;
                    
                    saveDatabase();
                    refreshOperationList();
                    document.getElementById('op-barcode-input').value = '';
                    showToast("Encaixe Efetuado", `Embarque via Encaixe confirmado para ${person.nome}.`, "success");
                }
            } else {
                alert("Acesso Negado: Código ou Documento inválido / não credenciado para o evento.");
            }
        }
    }
}

// Encaixe Modal
function toggleEncaixeModal(show) {
    const modal = document.getElementById('modal-encaixe');
    if (show) {
        const route = document.getElementById('op-route').value;
        const time = document.getElementById('op-time').value;
        const service = document.getElementById('op-service-type').value !== 'ALL' ? document.getElementById('op-service-type').value : 'Vai e Vem Van';
        
        document.getElementById('enc-lbl-route').textContent = route;
        document.getElementById('enc-lbl-time').textContent = time || "Não Definido";
        document.getElementById('enc-lbl-service').textContent = service;
        
        document.getElementById('form-encaixe').reset();
        document.getElementById('enc-lookup-msg').classList.add('hidden');
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function lookupEncaixeCollaborator(val) {
    if (val.trim().length >= 3) await fetchAndCachePerson(val.trim());
    const id = val.trim();
    const msg = document.getElementById('enc-lookup-msg');
    if (id.length < 3) {
        msg.classList.add('hidden');
        return;
    }
    const person = findPerson(id);
    if (person) {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] mt-1 text-emerald-400 font-semibold";
        msg.textContent = `�S Localizado: ${person.nome}`;
        
        document.getElementById('enc-name').value = person.nome;
        document.getElementById('enc-company').value = person.empresa || (person.tipo_vinculo === 'GLOBO' ? 'Globo' : 'Terceiro');
        document.getElementById('enc-dept').value = getN1Area(person);
    } else {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] mt-1 text-red-400 font-bold";
        msg.textContent = `�S Alerta: Não credenciado no evento!`;
    }
}

function handleEncaixeSubmit() {
    const id = document.getElementById('enc-id').value.trim();
    const name = document.getElementById('enc-name').value.trim();
    const company = document.getElementById('enc-company').value.trim();
    const dept = document.getElementById('enc-dept').value.trim();

    const person = findPerson(id);
    if (!person) {
        if (!confirm("Alerta crítico: Passageiro não credenciado. Deseja forçar o encaixe por exceção operacional?")) {
            return;
        }
    }

    const route = document.getElementById('op-route').value;
    const date = document.getElementById('op-date').value;
    const time = document.getElementById('op-time').value;
    const orig = route.split(' x ')[0];
    const dest = route.split(' x ')[1];
    const escopo = (dest === getEventLocationName()) ? 'VAI' : 'VEM';
    const trip_id = `${orig}_${escopo}_${date}_${time.replace(':', '')}`;
    const service = document.getElementById('op-service-type').value !== 'ALL' ? document.getElementById('op-service-type').value : 'Vai e Vem Van';

    const newBooking = {
        id: `enc_${Date.now()}`,
        matricula: person ? (person.matricula || "") : "",
        cpf: person ? "" : id,
        nome: name,
        origem: orig,
        destino: dest,
        data: date,
        hora: time,
        trip_id: trip_id,
        status: 'Embarcado',
        tipo: 'Encaixe',
        canal_entrada: 'Site',
        cargo: person ? (person.cargo || "Encaixe") : "Encaixe Externo",
        departamento: dept,
        service_type: service
    };
    
    db.bookings.push(newBooking);
    syncBookingCreate(newBooking);
    
    // Auto-cria trip se necessário e adiciona real count
    let trip = db.trips.find(t => t.id === trip_id);
    if (!trip) {
        trip = {
            id: trip_id,
            site: orig,
            escopo: escopo,
            hora: time,
            data: date,
            capacidade: service === 'Vai e Vem Van' ? 15 : 4,
            planejado: 0,
            real: 0,
            tipo_atendimento: service,
            empresa_transporte: "Top Service"
        };
        db.trips.push(trip);
    }
    trip.real = (trip.real || 0) + 1;
    
    saveDatabase();
    toggleEncaixeModal(false);
    refreshOperationList();
    showToast("Encaixe Efetuado", `Passageiro ${name} embarcado.`, "success");
}

// Remanejamento de Horário
function openRescheduleModal(bookingId) {
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    document.getElementById('resch-booking-id').value = bookingId;
    document.getElementById('resch-lbl-name').textContent = booking.nome;
    document.getElementById('resch-lbl-current').textContent = `${booking.origem} x ${booking.destino} às ${booking.hora} (${booking.data})`;

    const timeSelect = document.getElementById('resch-time-select');
    timeSelect.innerHTML = '';
    
    const escopo = (booking.destino === getEventLocationName()) ? 'VAI' : 'VEM';
    const base = (escopo === 'VAI') ? booking.origem : booking.destino;
    const times = getAvailableHours(escopo, currentEvent, base);

    times.forEach(t => {
        if (t !== booking.hora) timeSelect.appendChild(createOption(t, t));
    });

    toggleRescheduleModal(true);
}

function toggleRescheduleModal(show) {
    const modal = document.getElementById('modal-reschedule');
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function handleRescheduleSubmit() {
    const bookingId = document.getElementById('resch-booking-id').value;
    const newTime = document.getElementById('resch-time-select').value;
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const oldTripId = booking.trip_id;
    const newTripId = `${booking.origem}_${(booking.destino===getEventLocationName()?'VAI':'VEM')}_${booking.data}_${newTime.replace(':','')}`;
    
    booking.hora = newTime;
    booking.trip_id = newTripId;
    booking.id = `${booking.matricula || booking.cpf}${booking.origem}x${booking.destino}${booking.data.replace(/-/g, '')}${newTime.replace(':', '')}`;
    booking.last_updated_at = new Date().toISOString();
    
    const oldTrip = db.trips.find(t => t.id === oldTripId);
    if (oldTrip && oldTrip.planejado > 0) oldTrip.planejado -= 1;
    
    let newTrip = db.trips.find(t => t.id === newTripId);
    if (newTrip) {
        newTrip.planejado += 1;
    } else {
        newTrip = {
            id: newTripId,
            site: booking.origem,
            escopo: booking.destino === getEventLocationName() ? 'VAI' : 'VEM',
            hora: newTime,
            data: booking.data,
            capacidade: (booking.service_type === 'Vai e Vem Van') ? 15 : 4,
            planejado: 1,
            real: 0,
            tipo_atendimento: booking.service_type || 'Vai e Vem Van',
            empresa_transporte: "Top Service"
        };
        db.trips.push(newTrip);
    }

    saveDatabase();
    toggleRescheduleModal(false);
    refreshOperationList();
    showToast("Agendamento Remanejado", `Passageiro ${booking.nome} movido para ${newTime}.`, "success");
}

function printDispatchManifest() {
    window.print();
}

// ==================== 3. VIEW GESTÒO & ANALYTICS ====================
function updateDashboard() {
    if (currentTab !== 'management') return;

    if (currentSubTab === 'graphs') {
        renderMirroredCharts();
    } else if (currentSubTab === 'adherence') {
        renderAdherenceReport();
        if (typeof renderScheduledPassengersReport === 'function') renderScheduledPassengersReport();
    } else if (currentSubTab === 'loss-sim') {
        recalculateFinancialLoss();
    } else if (currentSubTab === 'audit') {
        renderAuditedAccreditedReport();
    } else if (currentSubTab === 'drivers') {
        renderDriversList();
        renderFleetDimensionReport();
    }
}

function setDirectionFilter(dir) {
    currentDirection = dir;
    document.getElementById('btn-dir-vai').className = dir === 'VAI' ? "bg-blue-600 text-white font-bold text-xs px-4 py-1.5 rounded-lg shadow transition" : "text-gray-400 hover:text-white font-bold text-xs px-4 py-1.5 rounded-lg transition";
    document.getElementById('btn-dir-vem').className = dir === 'VEM' ? "bg-blue-600 text-white font-bold text-xs px-4 py-1.5 rounded-lg shadow transition" : "text-gray-400 hover:text-white font-bold text-xs px-4 py-1.5 rounded-lg transition ml-1";

    document.getElementById('lbl-jb-direction-badge').textContent = dir === 'VAI' ? 'Vai' : 'Vem';
    document.getElementById('lbl-eg-direction-badge').textContent = dir === 'VAI' ? 'Vai' : 'Vem';
    document.getElementById('lbl-ion-direction-badge').textContent = dir === 'VAI' ? 'Vai' : 'Vem';

    renderMirroredCharts();
}

// Renderizar Gráficos Espelhados JB vs EG vs ION por Sentido
function renderMirroredCharts() {
    const activeDates = getEventDates();
    const masterList = currentEvent === 'RIR' ? db.accredited : db.collaborators;

    const getVolumes = (site) => {
        let directionBookings = [];
        
        if (currentDirection === 'VAI') {
            directionBookings = db.bookings.filter(b => b.origem === site && b.destino === getEventLocationName() && activeDates.includes(b.data) && b.status !== 'Cancelado');
        } else {
            directionBookings = db.bookings.filter(b => b.origem === getEventLocationName() && b.destino === site && activeDates.includes(b.data) && b.status !== 'Cancelado');
        }

        const booked = directionBookings.length;
        const boarded = directionBookings.filter(b => b.status === 'Embarcado').length;
        
        const noshow = directionBookings.filter(b => b.status === 'Agendado').length;
        const encaixe = directionBookings.filter(b => b.status === 'Embarcado' && b.tipo === 'Encaixe').length;
        
        const uniqueBoarded = new Set(directionBookings.filter(b => b.status === 'Embarcado').map(b => b.matricula || b.cpf)).size;
        const baseMasterSize = Math.floor(masterList.length / 3);
        const naoutilizou = Math.max(baseMasterSize - uniqueBoarded, 0);

        return { booked, boarded, noshow, encaixe, naoutilizou };
    };

    const jbVol = getVolumes('JB');
    const egVol = getVolumes('EG');
    const ionVol = getVolumes('ION');

    document.getElementById('jb-kpi-booked').textContent = jbVol.booked;
    document.getElementById('jb-kpi-boarded').textContent = jbVol.boarded;
    document.getElementById('jb-kpi-noshow').textContent = jbVol.noshow;

    document.getElementById('eg-kpi-booked').textContent = egVol.booked;
    document.getElementById('eg-kpi-boarded').textContent = egVol.boarded;
    document.getElementById('eg-kpi-noshow').textContent = egVol.noshow;

    document.getElementById('ion-kpi-booked').textContent = ionVol.booked;
    document.getElementById('ion-kpi-boarded').textContent = ionVol.boarded;
    document.getElementById('ion-kpi-noshow').textContent = ionVol.noshow;

    // Renderizar Chart JB
    const ctxJB = document.getElementById('chart-jb-volume').getContext('2d');
    if (jbChartInstance) jbChartInstance.destroy();
    
    jbChartInstance = new Chart(ctxJB, {
        type: 'doughnut',
        data: {
            labels: ['Embarcados (OK)', 'No-Show (NOK)', 'Encaixes', 'Não Utilizou'],
            datasets: [{
                data: [jbVol.boarded - jbVol.encaixe, jbVol.noshow, jbVol.encaixe, jbVol.naoutilizou],
                backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#4b5563'],
                borderColor: '#111827',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, color: '#9ca3af', font: { size: 8 } } }
            },
            cutout: '60%'
        }
    });

    // Renderizar Chart EG
    const ctxEG = document.getElementById('chart-eg-volume').getContext('2d');
    if (egChartInstance) egChartInstance.destroy();
    
    egChartInstance = new Chart(ctxEG, {
        type: 'doughnut',
        data: {
            labels: ['Embarcados (OK)', 'No-Show (NOK)', 'Encaixes', 'Não Utilizou'],
            datasets: [{
                data: [egVol.boarded - egVol.encaixe, egVol.noshow, egVol.encaixe, egVol.naoutilizou],
                backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#4b5563'],
                borderColor: '#111827',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, color: '#9ca3af', font: { size: 8 } } }
            },
            cutout: '60%'
        }
    });

    // Renderizar Chart ION
    const ctxION = document.getElementById('chart-ion-volume').getContext('2d');
    if (ionChartInstance) ionChartInstance.destroy();
    
    ionChartInstance = new Chart(ctxION, {
        type: 'doughnut',
        data: {
            labels: ['Embarcados (OK)', 'No-Show (NOK)', 'Encaixes', 'Não Utilizou'],
            datasets: [{
                data: [ionVol.boarded - ionVol.encaixe, ionVol.noshow, ionVol.encaixe, ionVol.naoutilizou],
                backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#4b5563'],
                borderColor: '#111827',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, color: '#9ca3af', font: { size: 8 } } }
            },
            cutout: '60%'
        }
    });
}

// Renderizar Relatório de Aderência (Top 10 + Outros)
function renderAdherenceReport() {
    const tbody = document.getElementById('adh-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeDates = getEventDates();
    const masterList = currentEvent === 'RIR' ? db.accredited : db.collaborators;

    const eventBookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));

    const groups = {};
    eventBookings.forEach(b => {
        const person = findPerson(b.matricula || b.cpf);
        const n1 = getN1Area(person);
        
        if (!groups[n1]) {
            groups[n1] = { name: n1, planejado: 0, boarded: 0, boarded_offtime: 0, noshow: 0, encaixe: 0, naoutilizou: 0 };
        }

        if (b.status === 'Embarcado') {
            if (b.tipo === 'Encaixe') {
                groups[n1].encaixe += 1;
            } else if (b.status_checkin === 'Fora de Horário') {
                groups[n1].boarded_offtime += 1;
                groups[n1].planejado += 1;
            } else {
                groups[n1].boarded += 1;
                groups[n1].planejado += 1;
            }
        } else if (b.status === 'No-Show') {
            groups[n1].noshow += 1;
            groups[n1].planejado += 1;
        } else if (b.status === 'Agendado') {
            groups[n1].planejado += 1;
        }
    });

    const boardedIds = new Set(
        db.bookings
            .filter(b => b.status === 'Embarcado' && activeDates.includes(b.data))
            .map(b => String(b.matricula || b.cpf).split('.')[0].trim())
    );

    const areaOciosos = {};
    masterList.forEach(p => {
        const n1 = getN1Area(p);
        if (!areaOciosos[n1]) {
            areaOciosos[n1] = 0;
        }
        const id = String(p.matricula || p.cpf || '').split('.')[0].trim();
        if (!boardedIds.has(id)) {
            areaOciosos[n1] += 1;
        }
    });

    let sortedGroups = Object.values(groups).sort((a, b) => b.planejado - a.planejado);

    const top10 = sortedGroups.slice(0, 10);
    const rest = sortedGroups.slice(10);
    
    if (rest.length > 0) {
        const outros = {
            name: "Outros (Demais áreas)",
            planejado: 0, boarded: 0, boarded_offtime: 0, noshow: 0, encaixe: 0, naoutilizou: 0
        };
        rest.forEach(r => {
            outros.planejado += r.planejado;
            outros.boarded += r.boarded;
            outros.boarded_offtime += r.boarded_offtime;
            outros.noshow += r.noshow;
            outros.encaixe += r.encaixe;
        });
        top10.push(outros);
    }

    top10.forEach(g => {
        if (g.name === "Outros (Demais áreas)") {
            let sumOciosos = 0;
            rest.forEach(r => { sumOciosos += (areaOciosos[r.name] || 0); });
            g.naoutilizou = sumOciosos;
        } else {
            g.naoutilizou = areaOciosos[g.name] || 0;
        }

        const rate = g.planejado > 0 ? ((g.boarded / g.planejado) * 100).toFixed(1) : "0.0";
        let rateClass = parseFloat(rate) >= 80 ? 'text-emerald-400' : parseFloat(rate) >= 50 ? 'text-amber-400' : 'text-red-400';

        const isOutros = g.name === "Outros (Demais áreas)";
        const nameCell = isOutros 
            ? `<span class="font-bold text-gray-300">${safeEscapeHtml(g.name)}</span>` 
            : `<a href="javascript:void(0)" onclick="showN1NominalDetails('${safeEscapeAttr(g.name)}')" class="font-bold text-teal-400 hover:text-teal-300 hover:underline flex items-center gap-1.5 cursor-pointer" title="Clique para ver os nomes e agendamentos de ${safeEscapeAttr(g.name)}"><i class="fa-solid fa-users-viewfinder text-xs"></i> ${safeEscapeHtml(g.name)}</a>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-900/20 transition-colors";
        tr.innerHTML = `
            <td class="py-3 px-4">${nameCell}</td>
            <td class="py-3 px-4 text-center"><a href="javascript:void(0)" onclick="openDrillDownModal('${safeEscapeAttr(g.name)}', 'planejado')" class="text-white hover:text-blue-400 font-mono underline decoration-dotted underline-offset-2">${g.planejado}</a></td>
            <td class="py-3 px-4 text-center"><a href="javascript:void(0)" onclick="openDrillDownModal('${safeEscapeAttr(g.name)}', 'boarded')" class="text-emerald-400 hover:text-emerald-300 font-mono underline decoration-dotted underline-offset-2">${g.boarded}</a></td>
            <td class="py-3 px-4 text-center"><a href="javascript:void(0)" onclick="openDrillDownModal('${safeEscapeAttr(g.name)}', 'boarded_offtime')" class="text-indigo-400 hover:text-indigo-300 font-mono underline decoration-dotted underline-offset-2">${g.boarded_offtime}</a></td>
            <td class="py-3 px-4 text-center"><a href="javascript:void(0)" onclick="openDrillDownModal('${safeEscapeAttr(g.name)}', 'encaixe')" class="text-teal-400 hover:text-teal-300 font-mono underline decoration-dotted underline-offset-2">${g.encaixe}</a></td>
            <td class="py-3 px-4 text-center"><a href="javascript:void(0)" onclick="openDrillDownModal('${safeEscapeAttr(g.name)}', 'noshow')" class="text-red-400 hover:text-red-300 font-mono underline decoration-dotted underline-offset-2">${g.noshow}</a></td>
            <td class="py-3 px-4 text-center"><a href="javascript:void(0)" onclick="openDrillDownModal('${safeEscapeAttr(g.name)}', 'naoutilizou')" class="text-gray-500 hover:text-gray-400 font-mono underline decoration-dotted underline-offset-2">${g.naoutilizou}</a></td>
            <td class="py-3 px-4 text-right font-bold font-mono ${rateClass}">${rate}%</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Renderiza também a tabela de validação de programações CCO, o dimensionamento de vans e a lista nominal
    if (typeof renderAuditValidationTable === 'function') {
        renderAuditValidationTable();
    }
    if (typeof renderVanSizingConsolidated === 'function') {
        renderVanSizingConsolidated();
    }
    if (typeof renderScheduledPassengersReport === 'function') {
        renderScheduledPassengersReport();
    }
}

// --- AUDITORIA DE UPLOADS E VALIDA�!ÒO CCO POR N1 ---
function renderAuditValidationTable() {
    const tbody = document.getElementById('audit-booking-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const activeDates = getEventDates();
    // Apenas agendamentos ativos dos dias do evento
    const bookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));
    
    // Agrupar agendamentos por N1
    const n1Groups = {};
    bookings.forEach(b => {
        const person = findPerson(b.matricula || b.cpf);
        const area = getN1Area(person);
        
        if (!n1Groups[area]) {
            n1Groups[area] = {
                area: area,
                count: 0,
                uploads: [],
                updates: [],
                byUser: 'N/A',
                valid: true
            };
        }
        
        n1Groups[area].count++;
        
        if (b.uploaded_at) n1Groups[area].uploads.push(new Date(b.uploaded_at));
        if (b.last_updated_at) n1Groups[area].updates.push(new Date(b.last_updated_at));
        if (b.uploaded_by && b.uploaded_by !== 'Excel' && b.uploaded_by !== 'Site') {
            n1Groups[area].byUser = b.uploaded_by;
        } else if (b.uploaded_by && n1Groups[area].byUser === 'N/A') {
            n1Groups[area].byUser = b.uploaded_by;
        }
        
        if (b.validado_transporte === false || b.validado_transporte === undefined) {
            n1Groups[area].valid = false;
        }
    });
    
    const sortedAreas = Object.values(n1Groups).sort((a, b) => b.count - a.count);
    
    if (sortedAreas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500 font-semibold">Nenhuma programação de embarque encontrada para validar.</td></tr>`;
        return;
    }
    
    sortedAreas.forEach(g => {
        const maxUpload = g.uploads.length > 0 ? new Date(Math.max.apply(null, g.uploads)) : null;
        const maxUpdate = g.updates.length > 0 ? new Date(Math.max.apply(null, g.updates)) : null;
        
        const uploadStr = maxUpload ? formatDateCustom(maxUpload) : 'N/A';
        const updateStr = maxUpdate ? formatDateCustom(maxUpdate) : 'N/A';
        
        const statusBadge = g.valid 
            ? `<span class="status-pill text-emerald-400 px-2.5 py-0.5 rounded-full font-bold uppercase text-[9px]"><i class="fa-solid fa-circle-check mr-1"></i>Confirmado</span>`
            : `<span class="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase text-[9px]"><i class="fa-solid fa-circle-exclamation mr-1"></i>Pendente</span>`;
            
        const btnAction = g.valid 
            ? `<button onclick="invalidateN1Program('${g.area.replace(/'/g, "\\'")}')" class="bg-emerald-600 text-white border border-emerald-500 px-3 py-1 rounded-xl text-[10px] font-bold uppercase hover:bg-red-600 hover:border-red-500 transition duration-200 flex items-center gap-1 shadow-md cursor-pointer" title="Clique para desmarcar"><i class="fa-solid fa-check mr-0.5"></i>Validado</button>`
            : `<button onclick="validateN1Program('${g.area.replace(/'/g, "\\'")}')" class="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white px-3 py-1 rounded-xl text-[10px] font-bold uppercase transition duration-200 shadow-md shadow-emerald-500/20 flex items-center gap-1 cursor-pointer"><i class="fa-solid fa-clipboard-check mr-0.5"></i>Confirmar</button>`;
            
        const areaLink = `<a href="javascript:void(0)" onclick="showN1NominalDetails('${safeEscapeAttr(g.area)}')" class="font-bold text-teal-400 hover:text-teal-300 hover:underline flex items-center gap-1.5 cursor-pointer" title="Clique para ver os nomes e agendamentos de ${safeEscapeAttr(g.area)}"><i class="fa-solid fa-users-viewfinder text-xs"></i> ${safeEscapeHtml(g.area)}</a>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-900/20 transition-colors";
        tr.innerHTML = `
            <td class="py-3 px-4">${areaLink}</td>
            <td class="py-3 px-4 text-center font-mono text-white font-bold">${g.count}</td>
            <td class="py-3 px-4 text-center text-gray-400 font-mono">${uploadStr}</td>
            <td class="py-3 px-4 text-center text-gray-300 font-medium">${g.byUser}</td>
            <td class="py-3 px-4 text-center text-gray-400 font-mono">${updateStr}</td>
            <td class="py-3 px-4 text-center">${statusBadge}</td>
            <td class="py-3 px-4 flex justify-center">${btnAction}</td>
        `;
        tbody.appendChild(tr);
    });
}

function formatDateCustom(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    const d = pad(dateObj.getDate());
    const m = pad(dateObj.getMonth() + 1);
    const y = dateObj.getFullYear();
    const h = pad(dateObj.getHours());
    const min = pad(dateObj.getMinutes());
    return `${d}/${m}/${y} ${h}:${min}`;
}

window.invalidateN1Program = function(areaName) {
    const activeDates = getEventDates();
    const bookingsToInvalidate = db.bookings.filter(b => 
        activeDates.includes(b.data) && 
        isValidBookingForReports(b) &&
        getN1Area(findPerson(b.matricula || b.cpf)) === areaName
    );
    
    if (bookingsToInvalidate.length === 0) return;
    
    bookingsToInvalidate.forEach(b => {
        b.validado_transporte = false;
        b.last_updated_at = new Date().toISOString();
    });
    
    if (typeof saveDatabase === 'function') saveDatabase();
    if (typeof showToast === 'function') showToast("Validação Removida", `A programação da área ${areaName} voltou ao status Pendente.`, "warning");
    renderAdherenceReport();
};

window.validateN1Program = function(areaName) {
    const activeDates = getEventDates();
    const bookingsToValidate = db.bookings.filter(b => 
        activeDates.includes(b.data) && 
        isValidBookingForReports(b) &&
        getN1Area(findPerson(b.matricula || b.cpf)) === areaName
    );
    
    if (bookingsToValidate.length === 0) {
        showToast("Validação CCO", "Nenhum agendamento encontrado para esta área.", "warning");
        return;
    }
    
    bookingsToValidate.forEach(b => {
        b.validado_transporte = true;
        b.last_updated_at = new Date().toISOString();
    });
    
    saveDatabase();
    
    let ccoUser = "CCO Transporte";
    const savedUser = safeStorage.local.getItem('rig_user');
    if (savedUser) {
        try {
            const uObj = JSON.parse(savedUser);
            ccoUser = `${uObj.nome} ${uObj.sobrenome}`;
        } catch(e) {}
    }
    
    showToast("Programação Confirmada", `A programação da área ${areaName} foi validada por ${ccoUser}.`, "success");
    renderAdherenceReport();
}

// --- RELAT�RIO NOMINAL DE AGENDADOS POR ÁREA E DIAS DO EVENTO (7 DIAS) ---
function safeEscapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safeEscapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDisplayDate(val) {
    if (!val) return '16/07/2026 14:30';
    if (val instanceof Date) return formatDateCustom(val);
    if (typeof val === 'string') {
        if (val.includes('T')) {
            const d = new Date(val);
            if (!isNaN(d.getTime())) return formatDateCustom(d);
        }
        return val;
    }
    return String(val);
}

window.renderScheduledPassengersReport = function() {
    const tbody = document.getElementById('scheduled-passengers-tbody');
    if (!tbody) return;

    const activeDates = getEventDates();
    const masterList = currentEvent === 'RIR' ? db.accredited : db.collaborators;

    // Atualizar cabeçalhos das 7 colunas dos dias
    activeDates.forEach((dStr, idx) => {
        const th = document.getElementById(`th-day-${idx + 1}`);
        if (th) {
            const parts = dStr.split('-');
            const dayMonth = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dStr;
            th.innerHTML = `Dia ${idx + 1}<br><span class="text-[9px] text-gray-400 font-mono font-normal">(${dayMonth})</span>`;
        }
    });

    // Preencher filtro de Áreas N1
    const areaFilter = document.getElementById('sched-area-filter');
    if (areaFilter) {
        const currentAreaVal = areaFilter.value;
        const allN1Set = new Set();
        masterList.forEach(person => {
            allN1Set.add(getN1Area(person));
        });
        db.bookings.forEach(b => {
            const person = findPerson(b.matricula || b.cpf);
            allN1Set.add(getN1Area(person));
        });
        const sortedN1s = Array.from(allN1Set).filter(Boolean).sort();
        
        areaFilter.innerHTML = '<option value="ALL">Todas as Áreas N1</option>' + 
            sortedN1s.map(n1 => `<option value="${safeEscapeAttr(n1)}" ${n1 === currentAreaVal ? 'selected' : ''}>${safeEscapeHtml(n1)}</option>`).join('');
    }

    const searchInput = (document.getElementById('sched-search-input')?.value || '').toLowerCase().trim();
    const selectedArea = document.getElementById('sched-area-filter')?.value || 'ALL';
    const selectedStatus = document.getElementById('sched-status-filter')?.value || 'BOOKED';

    const activeBookings = db.bookings.filter(b => isValidBookingForReports(b));
    const personMap = new Map();

    function getPersonEntry(key, defaultPerson) {
        if (!personMap.has(key)) {
            const person = defaultPerson || findPerson(key);
            const name = person ? (person.nome || person.nome_credencial || person.nome_completo || 'Passageiro') : 'Passageiro';
            const area = getN1Area(person);
            const mat = person ? (person.matricula || person.cpf || key) : key;
            personMap.set(key, {
                id: key,
                matricula: mat,
                nome: name,
                area: area,
                booking_dates: [],
                daysMap: {}
            });
        }
        return personMap.get(key);
    }

    activeBookings.forEach(b => {
        const key = String(b.matricula || b.cpf || '').trim();
        if (!key) return;
        
        const entry = getPersonEntry(key, findPerson(key));
        
        const bDate = b.uploaded_at || b.created_at || b.data_agendamento || '16/07/2026 14:30';
        if (!entry.booking_dates.includes(bDate)) {
            entry.booking_dates.push(bDate);
        }

        if (!entry.daysMap[b.data]) {
            entry.daysMap[b.data] = { ida: [], volta: [] };
        }

        const isVAI = b.destino === getEventLocationName() || b.destino === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VAI'));
        const isVEM = b.origem === getEventLocationName() || b.origem === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VEM'));

        const mapToSite = (site) => {
            if(!site) return '';
            const s = site.toUpperCase();
            if(s.includes('ESTUDIOS') || s.includes('EST�aDIOS') || s === 'EG') return 'EG';
            if(s.includes('JARDIM') || s === 'JB') return 'JB';
            if(s.includes('ION') || s === 'ÍON') return 'ION';
            return site.substring(0, 3);
        };

        if (isVAI) {
            const label = `${b.hora} (${mapToSite(b.destino)})`;
            if (!entry.daysMap[b.data].ida.includes(label)) entry.daysMap[b.data].ida.push(label);
        } else if (isVEM) {
            const label = `${b.hora} (${mapToSite(b.origem)})`;
            if (!entry.daysMap[b.data].volta.includes(label)) entry.daysMap[b.data].volta.push(label);
        } else {
            const label = `${b.hora}`;
            if (!entry.daysMap[b.data].ida.includes(label)) entry.daysMap[b.data].ida.push(label);
        }
    });

    if (selectedStatus === 'ALL') {
        masterList.forEach(person => {
            const key = String(person.matricula || person.cpf || '').trim();
            if (key) getPersonEntry(key, person);
        });
    }

    let list = Array.from(personMap.values());

    if (searchInput) {
        list = list.filter(p => p.nome.toLowerCase().includes(searchInput) || p.matricula.toLowerCase().includes(searchInput) || p.area.toLowerCase().includes(searchInput));
    }

    if (selectedArea !== 'ALL') {
        list = list.filter(p => p.area === selectedArea);
    }

    if (selectedStatus === 'BOOKED') {
        list = list.filter(p => Object.keys(p.daysMap).length > 0);
    }

    list.sort((a, b) => a.area.localeCompare(b.area) || a.nome.localeCompare(b.nome));

    const totalPassengers = list.filter(p => Object.keys(p.daysMap).length > 0).length;
    let totalDaysSum = 0;
    const areaCounts = {};

    list.forEach(p => {
        const bookedDays = Object.keys(p.daysMap).length;
        totalDaysSum += bookedDays;
        if (bookedDays > 0) {
            areaCounts[p.area] = (areaCounts[p.area] || 0) + 1;
        }
    });

    let topArea = 'N/A';
    let maxAreaCount = 0;
    Object.entries(areaCounts).forEach(([area, count]) => {
        if (count > maxAreaCount) {
            maxAreaCount = count;
            topArea = area;
        }
    });

    if (document.getElementById('kpi-sched-total-passengers')) document.getElementById('kpi-sched-total-passengers').textContent = totalPassengers;
    if (document.getElementById('kpi-sched-total-days')) document.getElementById('kpi-sched-total-days').textContent = totalDaysSum;
    if (document.getElementById('kpi-sched-top-area')) document.getElementById('kpi-sched-top-area').textContent = topArea;
    if (document.getElementById('kpi-sched-avg-days')) document.getElementById('kpi-sched-avg-days').textContent = totalPassengers > 0 ? (totalDaysSum / totalPassengers).toFixed(1) : '0.0';

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="py-8 text-center text-gray-500 font-semibold">Nenhum passageiro agendado encontrado para os filtros selecionados.</td></tr>`;
        return;
    }

    let htmlRows = '';
    let currentAreaGroup = null;

    list.forEach(p => {
        if (p.area !== currentAreaGroup) {
            currentAreaGroup = p.area;
            const areaTotal = list.filter(x => x.area === currentAreaGroup && Object.keys(x.daysMap).length > 0).length;
            htmlRows += `
                <tr class="bg-indigo-950/40 border-y border-indigo-900/50">
                    <td colspan="11" class="py-2 px-3 text-xs font-extrabold text-indigo-300 uppercase tracking-wider">
                        <i class="fa-solid fa-layer-group mr-2 text-indigo-400"></i> ${safeEscapeHtml(currentAreaGroup)} 
                        <span class="ml-2 font-mono text-[10px] bg-indigo-500/20 text-indigo-200 px-2 py-0.5 rounded-full border border-indigo-500/30">${areaTotal} Agendados</span>
                    </td>
                </tr>
            `;
        }

        const bookedDaysCount = Object.keys(p.daysMap).length;
        const mainBookingDate = p.booking_dates.length > 0 ? p.booking_dates[0] : 'N/A';
        const formattedBookingDate = formatDisplayDate(mainBookingDate);

        htmlRows += `
            <tr class="hover:bg-gray-900/50 transition duration-150 border-b border-gray-900/80">
                <td class="py-2.5 px-3">
                    <div class="font-bold text-white text-xs">${safeEscapeHtml(p.nome)}</div>
                    <div class="text-[10px] text-gray-400 font-mono">Matrícula/CPF: ${safeEscapeHtml(p.matricula)}</div>
                </td>
                <td class="py-2.5 px-3 text-[11px] text-gray-300 font-semibold">${safeEscapeHtml(p.area)}</td>
                <td class="py-2.5 px-3 text-center text-[10px] font-mono text-emerald-400">
                    <i class="fa-solid fa-calendar-check mr-1 text-emerald-500"></i>${formattedBookingDate}
                </td>
        `;

        activeDates.forEach((dStr) => {
            const dayData = p.daysMap[dStr];
            if (dayData && (dayData.ida.length > 0 || dayData.volta.length > 0)) {
                let textIda = dayData.ida.length > 0 ? `Ida ${dayData.ida.join(',')}` : '';
                let textVolta = dayData.volta.length > 0 ? `Volta ${dayData.volta.join(',')}` : '';
                let label = [textIda, textVolta].filter(Boolean).join(' | ');

                htmlRows += `
                    <td class="py-2 px-1 text-center">
                        <span class="inline-block bg-blue-500/10 text-blue-400 border border-blue-500/30 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shadow-sm" title="${safeEscapeAttr(label)}">
                            ${safeEscapeHtml(label)}
                        </span>
                    </td>
                `;
            } else {
                htmlRows += `
                    <td class="py-2 px-1 text-center text-gray-600 text-[10px] font-mono">-</td>
                `;
            }
        });

        htmlRows += `
                <td class="py-2.5 px-3 text-center">
                    <span class="${bookedDaysCount > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold' : 'text-gray-500'} text-[11px] font-mono px-2 py-0.5 rounded-full">
                        ${bookedDaysCount} ${bookedDaysCount === 1 ? 'dia' : 'dias'}
                    </span>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = htmlRows;
}

window.exportScheduledPassengersCSV = function() {
    const activeDates = getEventDates();
    const activeBookings = db.bookings.filter(b => isValidBookingForReports(b));

    const personMap = new Map();

    activeBookings.forEach(b => {
        const key = String(b.matricula || b.cpf || '').trim();
        if (!key) return;
        
        if (!personMap.has(key)) {
            const person = findPerson(key);
            personMap.set(key, {
                matricula: key,
                nome: person ? (person.nome || person.nome_credencial || 'Passageiro') : (b.nome || 'Passageiro'),
                area: getN1Area(person),
                booking_date: b.uploaded_at || b.created_at || '16/07/2026 14:30',
                daysMap: {}
            });
        }
        const p = personMap.get(key);
        if (!p.daysMap[b.data]) p.daysMap[b.data] = { ida: [], volta: [] };
        
        const isVAI = b.destino === getEventLocationName() || b.destino === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VAI'));
        const isVEM = b.origem === getEventLocationName() || b.origem === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VEM'));

        const mapToSite = (site) => {
            if(!site) return '';
            const s = site.toUpperCase();
            if(s.includes('ESTUDIOS') || s.includes('EST�aDIOS') || s === 'EG') return 'EG';
            if(s.includes('JARDIM') || s === 'JB') return 'JB';
            if(s.includes('ION') || s === 'ÍON') return 'ION';
            return site.substring(0, 3);
        };

        if (isVAI) {
            const label = `${b.hora} (${mapToSite(b.destino)})`;
            if (!p.daysMap[b.data].ida.includes(label)) p.daysMap[b.data].ida.push(label);
        } else if (isVEM) {
            const label = `${b.hora} (${mapToSite(b.origem)})`;
            if (!p.daysMap[b.data].volta.includes(label)) p.daysMap[b.data].volta.push(label);
        } else {
            const label = `${b.hora}`;
            if (!p.daysMap[b.data].ida.includes(label)) p.daysMap[b.data].ida.push(label);
        }
    });

    const list = Array.from(personMap.values());
    list.sort((a, b) => a.area.localeCompare(b.area) || a.nome.localeCompare(b.nome));

    let csvContent = '\uFEFF';
    const headerDays = activeDates.map((d, i) => `Dia ${i+1} (${d})`).join(';');
    csvContent += `Passageiro;Matricula/CPF;Area N1;Data Agendamento;${headerDays};Total Dias Agendados\n`;

    list.forEach(p => {
        const daysCells = activeDates.map(dStr => {
            const dayData = p.daysMap[dStr];
            if (dayData && (dayData.ida.length > 0 || dayData.volta.length > 0)) {
                let idaStr = dayData.ida.length > 0 ? `Ida ${dayData.ida.join(',')}` : '';
                let voltaStr = dayData.volta.length > 0 ? `Volta ${dayData.volta.join(',')}` : '';
                return `"${[idaStr, voltaStr].filter(Boolean).join(' | ')}"`;
            }
            return '"-"';
        }).join(';');

        const bookedDaysCount = Object.keys(p.daysMap).length;
        const bDateFormatted = formatDisplayDate(p.booking_date);
        csvContent += `"${p.nome}";"${p.matricula}";"${p.area}";"${bDateFormatted}";${daysCells};"${bookedDaysCount}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Relatorio_Agendados_7Dias_${currentEvent}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- NOVAS FUN�!�"ES: LINK N1 & DIMENSIONAMENTO AUTOMÁTICO DE VANS ---

window.showN1NominalDetails = function(areaName) {
    if (typeof switchSubTab === 'function') switchSubTab('adherence');
    
    const areaFilter = document.getElementById('sched-area-filter');
    if (areaFilter) {
        areaFilter.value = areaName;
    }
    
    const banner = document.getElementById('n1-active-filter-banner');
    const bannerText = document.getElementById('n1-banner-area-name');
    if (banner && bannerText) {
        bannerText.textContent = areaName;
        banner.classList.remove('hidden');
    }
    
    switchAgendamentoView('analytical');
    renderScheduledPassengersReport();
    renderVanSizingConsolidated();
    
    const panel = document.getElementById('panel-agendamentos-vans');
    if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    if (typeof showToast === 'function') {
        showToast("Filtro N1 Ativado", `Exibindo nomes e agendamentos da diretoria: ${areaName}`, "info");
    }
}

window.clearN1NominalFilter = function() {
    const areaFilter = document.getElementById('sched-area-filter');
    if (areaFilter) areaFilter.value = 'ALL';
    const searchInput = document.getElementById('sched-search-input');
    if (searchInput) searchInput.value = '';
    
    const banner = document.getElementById('n1-active-filter-banner');
    if (banner) banner.classList.add('hidden');
    
    renderScheduledPassengersReport();
    renderVanSizingConsolidated();
}

window.switchAgendamentoView = function(viewType) {
    const secSummary = document.getElementById('view-section-van-summary');
    const secAnalytical = document.getElementById('view-section-analytical');
    const btnSummary = document.getElementById('btn-view-van-summary');
    const btnAnalytical = document.getElementById('btn-view-analytical');
    
    if (viewType === 'summary') {
        if (secSummary) secSummary.classList.remove('hidden');
        if (secAnalytical) secAnalytical.classList.add('hidden');
        if (btnSummary) btnSummary.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-indigo-600 text-white shadow-md';
        if (btnAnalytical) btnAnalytical.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white';
        renderVanSizingConsolidated();
    } else {
        if (secSummary) secSummary.classList.add('hidden');
        if (secAnalytical) secAnalytical.classList.remove('hidden');
        if (btnSummary) btnSummary.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white';
        if (btnAnalytical) btnAnalytical.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-indigo-600 text-white shadow-md';
        renderScheduledPassengersReport();
    }
}

window.renderVanSizingConsolidated = function() {
    const tbody = document.getElementById('van-summary-tbody');
    if (!tbody) return;

    const activeDates = getEventDates();
    const capacity = parseInt(document.getElementById('van-sizing-capacity')?.value || '15', 10);
    const directionFilter = document.getElementById('van-sizing-direction')?.value || 'ALL';
    const areaFilter = document.getElementById('sched-area-filter')?.value || 'ALL';

    let activeBookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));

    if (areaFilter !== 'ALL') {
        activeBookings = activeBookings.filter(b => {
            const person = findPerson(b.matricula || b.cpf);
            return getN1Area(person) === areaFilter;
        });
    }

    const slots = {};
    activeBookings.forEach(b => {
        const isVAI = b.destino === getEventLocationName() || b.destino === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VAI'));
        const isVEM = b.origem === getEventLocationName() || b.origem === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VEM'));
        const dir = isVAI ? 'VAI' : (isVEM ? 'VEM' : 'IDA');

        if (directionFilter !== 'ALL' && dir !== directionFilter) return;

        const key = `${b.data}_${dir}_${b.hora || '00:00'}`;
        if (!slots[key]) {
            slots[key] = {
                data: b.data,
                direction: dir,
                hora: b.hora || '00:00',
                passengers: 0,
                peopleKeys: new Set()
            };
        }
        const pKey = String(b.matricula || b.cpf || b.nome || Math.random()).trim();
        if (!slots[key].peopleKeys.has(pKey)) {
            slots[key].peopleKeys.add(pKey);
            slots[key].passengers++;
        }
    });

    const sortedSlots = Object.values(slots).sort((a, b) => {
        if (a.data !== b.data) return a.data.localeCompare(b.data);
        if (a.hora !== b.hora) return a.hora.localeCompare(b.hora);
        return a.direction.localeCompare(b.direction);
    });

    let totalMaxVans = 0;
    let sumOccupancy = 0;

    if (sortedSlots.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-gray-500 font-semibold">Nenhum agendamento encontrado para os parâmetros de dimensionamento.</td></tr>`;
        if (document.getElementById('kpi-sched-total-vans')) document.getElementById('kpi-sched-total-vans').textContent = '0 Vans';
        if (document.getElementById('kpi-sched-avg-days')) document.getElementById('kpi-sched-avg-days').textContent = '0.0%';
        return;
    }

    let html = '';
    sortedSlots.forEach(s => {
        const vansNeeded = Math.ceil(s.passengers / capacity);
        const totalSeats = vansNeeded * capacity;
        const emptySeats = totalSeats - s.passengers;
        const occupancyRate = totalSeats > 0 ? ((s.passengers / totalSeats) * 100).toFixed(1) : '0.0';

        if (vansNeeded > totalMaxVans) totalMaxVans = vansNeeded;
        sumOccupancy += parseFloat(occupancyRate);

        const parts = s.data.split('-');
        const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s.data;
        const dirBadge = s.direction === 'VAI' || s.direction === 'IDA' 
            ? `<span class="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-bold uppercase text-[9px]">VAI (Ida)</span>`
            : `<span class="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded font-bold uppercase text-[9px]">VEM (Volta)</span>`;

        const occColor = parseFloat(occupancyRate) >= 80 ? 'text-emerald-400 font-bold' : parseFloat(occupancyRate) >= 50 ? 'text-amber-400 font-bold' : 'text-red-400 font-bold';

        html += `
            <tr class="hover:bg-gray-900/40 transition border-b border-gray-900">
                <td class="py-2.5 px-3 font-mono font-bold text-white">${formattedDate}</td>
                <td class="py-2.5 px-3 text-center font-mono font-bold text-indigo-300">${safeEscapeHtml(s.hora)}</td>
                <td class="py-2.5 px-3 text-center">${dirBadge}</td>
                <td class="py-2.5 px-3 text-center font-mono font-bold text-white">${s.passengers}</td>
                <td class="py-2.5 px-3 text-center font-mono text-teal-400 font-extrabold text-sm">${vansNeeded} ${vansNeeded === 1 ? 'Van' : 'Vans'}</td>
                <td class="py-2.5 px-3 text-center font-mono text-amber-400 font-semibold">${emptySeats} assentos</td>
                <td class="py-2.5 px-3 text-center font-mono ${occColor}">${occupancyRate}%</td>
                <td class="py-2.5 px-3 text-center">
                    <button onclick="filterNominalBySlot('${s.data}', '${s.hora}')" class="bg-indigo-600/80 hover:bg-indigo-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-md transition shadow flex items-center gap-1 mx-auto cursor-pointer">
                        <i class="fa-solid fa-users"></i> Ver Nomes
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    const avgOccupancy = (sumOccupancy / sortedSlots.length).toFixed(1);
    if (document.getElementById('kpi-sched-total-vans')) document.getElementById('kpi-sched-total-vans').textContent = `${totalMaxVans} Vans (Pico)`;
    if (document.getElementById('kpi-sched-avg-days')) document.getElementById('kpi-sched-avg-days').textContent = `${avgOccupancy}%`;
}

window.filterNominalBySlot = function(dataStr, horaStr) {
    switchAgendamentoView('analytical');
    const searchInput = document.getElementById('sched-search-input');
    if (searchInput) searchInput.value = horaStr;
    renderScheduledPassengersReport();
    if (typeof showToast === 'function') {
        showToast("Filtro por Horário", `Filtrando passageiros do dia ${dataStr} às ${horaStr}`, "info");
    }
}

window.exportVanSizingCSV = function() {
    const activeDates = getEventDates();
    const capacity = parseInt(document.getElementById('van-sizing-capacity')?.value || '15', 10);
    const activeBookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));

    const slots = {};
    activeBookings.forEach(b => {
        const isVAI = b.destino === getEventLocationName() || b.destino === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VAI'));
        const isVEM = b.origem === getEventLocationName() || b.origem === 'Cidade do Rock' || (b.trip_id && b.trip_id.includes('VEM'));
        const dir = isVAI ? 'VAI' : (isVEM ? 'VEM' : 'IDA');

        const key = `${b.data}_${dir}_${b.hora || '00:00'}`;
        if (!slots[key]) {
            slots[key] = { data: b.data, direction: dir, hora: b.hora || '00:00', passengers: 0, peopleKeys: new Set() };
        }
        const pKey = String(b.matricula || b.cpf || b.nome || Math.random()).trim();
        if (!slots[key].peopleKeys.has(pKey)) {
            slots[key].peopleKeys.add(pKey);
            slots[key].passengers++;
        }
    });

    const sortedSlots = Object.values(slots).sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));

    let csvContent = '\uFEFF';
    csvContent += 'Data do Evento;Faixa Horaria;Sentido/Trecho;Passageiros Agendados;Vans Dimensionadas;Assentos Ociosos;Capacidade Van;Ocupacao (%)\n';

    sortedSlots.forEach(s => {
        const vansNeeded = Math.ceil(s.passengers / capacity);
        const totalSeats = vansNeeded * capacity;
        const emptySeats = totalSeats - s.passengers;
        const occupancyRate = totalSeats > 0 ? ((s.passengers / totalSeats) * 100).toFixed(1) : '0.0';
        csvContent += `"${s.data}";"${s.hora}";"${s.direction}";"${s.passengers}";"${vansNeeded}";"${emptySeats}";"${capacity}";"${occupancyRate}%"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Dimensionamento_Vans_Consolidado_${currentEvent}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.exportCurrentN1NominalCSV = function() {
    exportScheduledPassengersCSV();
}



window.exportAdherenceCSV = function() {
    let csv = 'Area de Negocio (N1);Agendados;Embarcado Horario;Embarcado Fora Horario;Encaixes;No-Show;Nao Utilizou;Aderencia (%)\n';
    
    const activeDates = getEventDates();
    const masterList = currentEvent === 'RIR' ? db.accredited : db.collaborators;
    const eventBookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));

    const groups = {};
    eventBookings.forEach(b => {
        const person = findPerson(b.matricula || b.cpf);
        const n1 = getN1Area(person);
        if (!groups[n1]) groups[n1] = { name: n1, planejado: 0, boarded: 0, boarded_offtime: 0, noshow: 0, encaixe: 0, naoutilizou: 0 };
        
        if (b.status === 'Embarcado') {
            if (b.tipo === 'Encaixe') groups[n1].encaixe += 1;
            else if (b.status_checkin === 'Fora de Horário') { groups[n1].boarded_offtime += 1; groups[n1].planejado += 1; }
            else { groups[n1].boarded += 1; groups[n1].planejado += 1; }
        } else if (b.status === 'No-Show') {
            groups[n1].noshow += 1;
            groups[n1].planejado += 1;
        } else if (b.status === 'Agendado') {
            groups[n1].planejado += 1;
        }
    });

    const boardedIds = new Set(
        db.bookings
            .filter(b => b.status === 'Embarcado' && activeDates.includes(b.data))
            .map(b => String(b.matricula || b.cpf).split('.')[0].trim())
    );

    Object.values(groups).forEach(g => {
        g.naoutilizou = masterList.filter(p => {
            const n1 = getN1Area(p);
            const id = String(p.matricula || p.cpf || '').split('.')[0].trim();
            return n1 === g.name && !boardedIds.has(id);
        }).length;

        const rate = g.planejado > 0 ? ((g.boarded / g.planejado) * 100).toFixed(1) : "0.0";
        csv += `"${g.name}";${g.planejado};${g.boarded};${g.boarded_offtime};${g.encaixe};${g.noshow};${g.naoutilizou};${rate}%\n`;
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `Relatorio_Aderencia_${currentEvent}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV Exportado", "Relatório de aderência completo exportado com sucesso.", "success");
}

// Recalcular Perdas do Simulador Financeiro
function recalculateFinancialLoss() {
    const ticketPrice = parseFloat(document.getElementById('sim-ticket-price').value) || 0;
    const opportunityCost = parseFloat(document.getElementById('sim-opportunity-cost').value) || 0;
    const tbody = document.getElementById('loss-sim-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeDates = getEventDates();
    const eventBookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));

    const groups = {};
    eventBookings.forEach(b => {
        const person = findPerson(b.matricula || b.cpf);
        const n1 = getN1Area(person);
        
        if (!groups[n1]) {
            groups[n1] = { name: n1, noshow: 0, encaixe: 0 };
        }

        if (b.status === 'No-Show') {
            groups[n1].noshow += 1;
        } else if (b.status === 'Embarcado') {
            if (b.tipo === 'Encaixe' || b.status_checkin === 'Fora de Horário') {
                groups[n1].encaixe += 1; 
            }
        }
    });

    let sorted = Object.values(groups).sort((a, b) => (b.noshow + b.encaixe) - (a.noshow + a.encaixe));
    
    const top10 = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    if (rest.length > 0) {
        const outros = { name: "Outros (Demais áreas)", noshow: 0, encaixe: 0 };
        rest.forEach(r => {
            outros.noshow += r.noshow;
            outros.encaixe += r.encaixe;
        });
        top10.push(outros);
    }

    top10.forEach(g => {
        const lossNoshow = g.noshow * ticketPrice;
        const penaltyEncaixe = g.encaixe * opportunityCost;
        const total = lossNoshow + penaltyEncaixe;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-900/20 transition-colors";
        tr.innerHTML = `
            <td class="py-3 px-4 font-bold text-gray-300 font-sans">${g.name}</td>
            <td class="py-3 px-4 text-center text-white">${g.noshow}</td>
            <td class="py-3 px-4 text-center text-red-400">R$ ${lossNoshow.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td class="py-3 px-4 text-center text-white">${g.encaixe}</td>
            <td class="py-3 px-4 text-center text-amber-500">R$ ${penaltyEncaixe.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td class="py-3 px-4 text-right font-bold text-white">R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- AUDITORIA DE CREDENCIADOS MASTER ---
function renderAuditedAccreditedReport() {
    const tbodyN1 = document.getElementById('audit-n1-tbody');
    const tbodyOciosos = document.getElementById('audit-ociosos-tbody');
    if (!tbodyN1 || !tbodyOciosos) return;
    
    tbodyN1.innerHTML = '';
    tbodyOciosos.innerHTML = '';

    const activeDates = getEventDates();
    const masterList = currentEvent === 'RIR' ? db.accredited : db.collaborators;
    const totalAccredited = masterList.length;
    
    const boardedIds = new Set(
        db.bookings
            .filter(b => b.status === 'Embarcado' && activeDates.includes(b.data))
            .map(b => String(b.matricula || b.cpf).split('.')[0].trim())
    );

    let activeCount = 0;
    const n1Stats = {};
    const ociosos = [];

    masterList.forEach(ac => {
        const id = String(ac.matricula || ac.cpf || '').split('.')[0].trim();
        const vinculo = getN1Area(ac);
        
        if (!n1Stats[vinculo]) {
            n1Stats[vinculo] = { name: vinculo, total: 0, active: 0 };
        }
        
        n1Stats[vinculo].total += 1;
        
        if (boardedIds.has(id)) {
            n1Stats[vinculo].active += 1;
            activeCount += 1;
        } else {
            ociosos.push(ac);
        }
    });

    const inactiveCount = totalAccredited - activeCount;
    const rate = totalAccredited > 0 ? ((activeCount / totalAccredited) * 100).toFixed(1) : 0;

    document.getElementById('audit-kpi-accredited').textContent = totalAccredited;
    document.getElementById('audit-kpi-active').textContent = activeCount;
    document.getElementById('audit-kpi-inactive').textContent = inactiveCount;
    document.getElementById('audit-kpi-rate').textContent = `${rate}%`;

    Object.values(n1Stats).forEach(s => {
        const pct = s.total > 0 ? ((s.active / s.total) * 100).toFixed(1) : 0;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-900/20 transition-colors";
        tr.innerHTML = `
            <td class="py-2 px-3 font-sans font-bold text-gray-300">${s.name}</td>
            <td class="py-2 px-3 text-center text-white">${s.total}</td>
            <td class="py-2 px-3 text-right text-indigo-400 font-bold">${pct}%</td>
        `;
        tbodyN1.appendChild(tr);
    });

    if (ociosos.length === 0) {
        tbodyOciosos.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Parabéns! Todos os credenciados utilizaram o transporte.</td></tr>';
    } else {
        const limit = 100;
        const visibleOciosos = ociosos.slice(0, limit);
        visibleOciosos.forEach(o => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-900/10 transition-colors text-[11px]";
            const labelId = o.matricula ? `MAT: ${o.matricula}` : `CPF: ${o.cpf}`;
            tr.innerHTML = `
                <td class="py-2.5 px-3 font-bold text-white">${o.nome}</td>
                <td class="py-2.5 px-3 text-gray-400 font-mono">${labelId}</td>
                <td class="py-2.5 px-3 text-gray-400">${o.departamento || o.diretoria || 'Setor'}</td>
                <td class="py-2.5 px-3 text-center text-gray-400">${o.tipo_vinculo || 'Externo'}</td>
                <td class="py-2.5 px-3 text-right text-gray-500 font-mono text-[10px]">${o.email || '-'}</td>
            `;
            tbodyOciosos.appendChild(tr);
        });
        if (ociosos.length > limit) {
            const infoTr = document.createElement('tr');
            infoTr.className = "text-[10px] text-gray-500 bg-gray-950/20";
            infoTr.innerHTML = `
                <td colspan="5" class="py-3 px-3 text-center italic font-semibold">
                    <i class="fa-solid fa-circle-info mr-1 text-indigo-400"></i> Exibindo os primeiros ${limit} de ${ociosos.length} colaboradores ociosos. Exporte para Excel/CSV para ver a lista completa.
                </td>
            `;
            tbodyOciosos.appendChild(infoTr);
        }
    }
}

function exportOciososCSV() {
    let csv = 'Nome;Matricula;CPF;Departamento;Vinculo;Email\n';
    
    const activeDates = getEventDates();
    const masterList = currentEvent === 'RIR' ? db.accredited : db.collaborators;
    const boardedIds = new Set(
        db.bookings
            .filter(b => b.status === 'Embarcado' && activeDates.includes(b.data))
            .map(b => String(b.matricula || b.cpf).split('.')[0].trim())
    );
    
    const ociosos = masterList.filter(o => !boardedIds.has(String(o.matricula || o.cpf || '').split('.')[0].trim()));

    ociosos.forEach(o => {
        csv += `"${o.nome}";"${o.matricula || ''}";"${o.cpf || ''}";"${o.departamento || o.diretoria || ''}";"${o.tipo_vinculo || ''}";"${o.email || ''}"\n`;
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `Credenciados_Ociosos_${currentEvent}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV Exportado", "Lista de credenciados ociosos baixada.", "success");
}

// --- JORNADA DE MOTORISTAS E PLANEJAMENTO DE FROTA ---
function renderDriversList() {
    const container = document.getElementById('driver-list-container');
    if (!container) return;
    container.innerHTML = '';

    const activeDates = getEventDates();
    const baseDate = activeDates[0];
    const opDateSelect = document.getElementById('op-date');
    const selectedDate = (opDateSelect && activeDates.includes(opDateSelect.value)) ? opDateSelect.value : baseDate;

    const dayTrips = db.trips.filter(t => t.data === selectedDate);

    const companyDrivers = {
        'Rio Vans': ['Marcos de Souza', 'Valdir Ferreira'],
        'Top Service': ['José Roberto Lima', 'Antônio Carlos'],
        'Aura Imagens': ['Francisco de Assis', 'Sebastião Filho'],
        'Top Toalet': ['Renato Gonçalves', 'Luiz Fernando']
    };

    const driverShifts = {};
    Object.keys(companyDrivers).forEach(comp => {
        companyDrivers[comp].forEach(driverName => {
            driverShifts[driverName] = {
                nome: driverName,
                operadora: comp,
                veiculo: comp === 'Rio Vans' ? 'Van Executiva' : (comp === 'Top Service' ? 'Executivo Blindado' : 'Passeio Produção'),
                trips: []
            };
        });
    });

    dayTrips.forEach((t, idx) => {
        const comp = t.empresa_transporte || 'Top Service';
        const driversList = companyDrivers[comp] || ['Motorista Geral'];
        const driverName = driversList[idx % driversList.length];
        
        if (!driverShifts[driverName]) {
            driverShifts[driverName] = { nome: driverName, operadora: comp, veiculo: 'Veículo Geral', trips: [] };
        }
        driverShifts[driverName].trips.push(t);
    });

    const driversData = [];
    Object.values(driverShifts).forEach(d => {
        if (d.trips.length === 0) return;

        const hourDecimals = d.trips.map(t => {
            const [h, m] = t.hora.split(':').map(Number);
            return h + m / 60;
        });

        const minHour = Math.min(...hourDecimals);
        const maxHour = Math.max(...hourDecimals);
        
        let shiftHours = 0;
        if (d.trips.length === 1) {
            shiftHours = 3.0;
        } else {
            shiftHours = parseFloat(((maxHour - minHour) + 1.5).toFixed(1));
        }

        let hash = 0;
        for (let i = 0; i < d.nome.length; i++) hash += d.nome.charCodeAt(i);
        const variation = (hash % 15) / 10;
        shiftHours = parseFloat((shiftHours + variation).toFixed(1));

        let status = 'Normal';
        if (shiftHours > 11.0) {
            status = 'Crítico';
        } else if (shiftHours > 9.5) {
            status = 'Aviso';
        }

        driversData.push({
            nome: d.nome,
            operadora: d.operadora,
            veiculo: d.veiculo,
            horas: shiftHours,
            status: status
        });
    });

    driversData.sort((a, b) => b.horas - a.horas);

    if (driversData.length === 0) {
        driversData.push(
            { nome: "Marcos de Souza", operadora: "Rio Vans", veiculo: "Van Executiva", horas: 10.5, status: "Aviso" },
            { nome: "José Roberto Lima", operadora: "Top Service", veiculo: "Executivo Blindado", horas: 8.0, status: "Normal" },
            { nome: "Francisco de Assis", operadora: "Aura Imagens", veiculo: "Passeio Produção", horas: 4.5, status: "Normal" },
            { nome: "Valdir Ferreira", operadora: "Rio Vans", veiculo: "Van Executiva", horas: 11.5, status: "Crítico" },
            { nome: "Renato Gonçalves", operadora: "Top Toalet", veiculo: "Executivo", horas: 6.2, status: "Normal" }
        );
    }

    driversData.forEach(d => {
        const pct = Math.min((d.horas / 11) * 100, 100);
        let barColor = 'bg-blue-600';
        let txtColor = 'text-white';
        let alertIcon = '';

        if (d.status === 'Aviso') {
            barColor = 'bg-amber-500';
            txtColor = 'text-amber-400';
        } else if (d.status === 'Crítico') {
            barColor = 'bg-red-500 animate-pulse';
            txtColor = 'text-red-500 font-bold';
            alertIcon = '<i class="fa-solid fa-circle-exclamation text-[10px] ml-1"></i>';
        } else {
            barColor = 'bg-emerald-500';
            txtColor = 'text-emerald-400';
        }

        const div = document.createElement('div');
        div.className = "space-y-1";
        div.innerHTML = `
            <div class="flex justify-between text-[11px]">
                <span class="font-bold text-gray-300">${d.nome} <span class="text-gray-500 font-normal">(${d.operadora} - ${d.veiculo})</span></span>
                <span class="font-mono ${txtColor}">${d.horas}h / 11h ${alertIcon}</span>
            </div>
            <div class="w-full bg-gray-900 h-2 rounded-full overflow-hidden">
                <div class="${barColor} h-full rounded-full" style="width: ${pct}%"></div>
            </div>
        `;
        container.appendChild(div);
    });
}

// Dimensionamento Recomendado de Frota por hora
function renderFleetDimensionReport() {
    const tbody = document.getElementById('fleet-dimension-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeDates = getEventDates();
    const baseDate = activeDates[0];
    const opDateSelect = document.getElementById('op-date');
    const selectedDate = (opDateSelect && activeDates.includes(opDateSelect.value)) ? opDateSelect.value : baseDate;

    // Todas as horas válidas de VAI
    const hours = getAvailableHours('VAI', currentEvent, 'EG');
    
    hours.forEach(hr => {
        const getFleetNeeds = (site) => {
            const bookings = db.bookings.filter(b => b.origem === site && b.data === selectedDate && b.hora === hr && b.status !== 'Cancelado');
            
            // Vans (Vai e Vem Van)
            const vanBookings = bookings.filter(b => b.service_type === 'Vai e Vem Van').length;
            const vansNeeded = Math.ceil(vanBookings / 15);
            
            // Carros (Outros atendimentos)
            const carBookings = bookings.filter(b => b.service_type !== 'Vai e Vem Van').length;
            const carsNeeded = Math.ceil(carBookings / 4);

            return { vansNeeded, carsNeeded };
        };

        const jb = getFleetNeeds('JB');
        const eg = getFleetNeeds('EG');
        const ion = getFleetNeeds('ION');

        const hasTrips = db.trips.some(t => t.data === selectedDate && t.hora === hr);
        if (hasTrips || jb.vansNeeded > 0 || jb.carsNeeded > 0 || eg.vansNeeded > 0 || eg.carsNeeded > 0 || ion.vansNeeded > 0 || ion.carsNeeded > 0) {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-900/20 transition-colors font-mono text-center text-xs";
            tr.innerHTML = `
                <td class="py-2.5 px-3 font-sans font-bold text-left text-gray-300">${hr}</td>
                <td class="py-2.5 px-3 text-white">${jb.vansNeeded}V / ${jb.carsNeeded}C</td>
                <td class="py-2.5 px-3 text-white">${eg.vansNeeded}V / ${eg.carsNeeded}C</td>
                <td class="py-2.5 px-3 text-white">${ion.vansNeeded}V / ${ion.carsNeeded}C</td>
            `;
            tbody.appendChild(tr);
        }
    });
}

// --- MOCK PLANILHA UPLOAD ---
function simulateExcelUpload() {
    const msg = document.getElementById('import-success-msg');
    msg.classList.remove('hidden');
    
    setTimeout(() => {
        msg.classList.add('hidden');
    }, 5000);
    showToast("Base Atualizada", "Planilha de credenciamento processada com sucesso.", "success");
    renderCollaboratorDatabaseTable();
    renderAccreditedDatabaseTable();
}

function sendWhatsappMock() {
    toggleWhatsappModal(true, 'ticket');
}

// --- UTILITY: HELPER FUNCTIONS ---
function createOption(value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    return opt;
}



function showToast(title, body, type = 'info') {
    let icon = '<i class="fa-solid fa-circle-info text-blue-500"></i>';
    if (type === 'success') {
        icon = '<i class="fa-solid fa-circle-check text-emerald-400"></i>';
    } else if (type === 'error') {
        icon = '<i class="fa-solid fa-circle-exclamation text-red-500"></i>';
    }

    const toastDiv = document.createElement('div');
    toastDiv.className = "fixed top-5 right-5 toast-premium z-[999] max-w-sm flex items-start space-x-3 p-4";
    toastDiv.innerHTML = `
        <div class="p-1 shrink-0">${icon}</div>
        <div class="text-xs text-left">
            <h5 class="font-bold text-white mb-0.5">${title}</h5>
            <p class="text-gray-400 leading-normal">${body}</p>
        </div>
    `;
    document.body.appendChild(toastDiv);

    setTimeout(() => {
        toastDiv.classList.add('show');
    }, 50);

    setTimeout(() => {
        toastDiv.classList.remove('show');
        setTimeout(() => toastDiv.remove(), 300);
    }, 4500);
}

function getReplicationTargetDates(prefix, selectedDate) {
    const choice = document.getElementById(`${prefix}-repl-choice`).value;
    const allDates = getEventDates();
    let targetDates = [selectedDate];

    if (choice === 'sim') {
        allDates.forEach(d => {
            if (d !== selectedDate) targetDates.push(d);
        });
    } else {
        allDates.forEach(d => {
            const cb = document.getElementById(`${prefix}-day-${d}`);
            if (cb && cb.checked && d !== selectedDate) {
                targetDates.push(d);
            }
        });
    }
    return targetDates;
}

function openReplicationReviewModal(source, person, serviceType, accompany, date, canal) {
    pendingBookingSource = source;
    pendingBookingServiceType = serviceType || '';
    pendingBookingAccompany = accompany || '';
    
    const listContainer = document.getElementById('replication-review-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    const eventName = getEventLocationName();
    
    pendingBookings.forEach((pb, idx) => {
        const parts = pb.date.split('-');
        const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : pb.date;
        
        const hoursVai = getAvailableHours('VAI', currentEvent, pb.vaiOrigin);
        let optionsVaiHtml = '';
        hoursVai.forEach(h => {
            optionsVaiHtml += `<option value="${h}" ${pb.vaiTime === h ? 'selected' : ''}>${h}</option>`;
        });
        
        const hoursVem = getAvailableHours('VEM', currentEvent, pb.vemDest);
        let optionsVemHtml = '';
        hoursVem.forEach(h => {
            optionsVemHtml += `<option value="${h}" ${pb.vemTime === h ? 'selected' : ''}>${h}</option>`;
        });
        
        const card = document.createElement('div');
        card.className = "bg-gray-900/60 p-4 rounded-2xl border border-gray-800 space-y-3";
        
        const personHeader = source === 'bulk' 
            ? `<div class="flex justify-between items-center text-xs font-semibold text-gray-300 border-b border-gray-850 pb-2">
                 <span><i class="fa-solid fa-user mr-1.5 text-blue-400"></i>${pb.person.nome}</span>
                 <span class="font-mono bg-gray-950 px-2 py-0.5 rounded text-[10px]">Matrícula: ${pb.person.matricula || pb.person.cpf}</span>
               </div>`
            : '';
            
        card.innerHTML = `
            ${personHeader}
            <div class="flex justify-between items-center text-xs font-bold text-white">
                <span><i class="fa-solid fa-calendar-day mr-1.5 text-indigo-400"></i>${dateStr}</span>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <!-- Outbound (Vai) -->
                <div class="bg-gray-950/50 p-2.5 rounded-xl border border-gray-850 space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="flex items-center space-x-2 cursor-pointer select-none">
                            <input type="checkbox" onchange="updatePendingBookingLeg(${idx}, 'vai', this.checked)" ${pb.enableVai ? 'checked' : ''} class="rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-0 cursor-pointer">
                            <span class="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Vai (Ida)</span>
                        </label>
                        <span class="text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-semibold uppercase">�~ ${eventName}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-[8px] font-bold text-gray-500 uppercase mb-1">Origem (Saída)</label>
                            <select onchange="updatePendingBookingLocation(${idx}, 'vai', this.value)" class="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 transition cursor-pointer">
                                <option value="EG" ${pb.vaiOrigin === 'EG' ? 'selected' : ''}>Estúdios Globo (EG)</option>
                                <option value="JB" ${pb.vaiOrigin === 'JB' ? 'selected' : ''}>Jardim Botânico (JB)</option>
                                <option value="ION" ${pb.vaiOrigin === 'ION' ? 'selected' : ''}>Íon (ION)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[8px] font-bold text-gray-500 uppercase mb-1">Horário Ida</label>
                            <select onchange="updatePendingBookingTime(${idx}, 'vai', this.value)" class="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 transition cursor-pointer">
                                ${optionsVaiHtml}
                            </select>
                        </div>
                    </div>
                </div>
                
                <!-- Return (Vem) -->
                <div class="bg-gray-950/50 p-2.5 rounded-xl border border-gray-855 space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="flex items-center space-x-2 cursor-pointer select-none">
                            <input type="checkbox" onchange="updatePendingBookingLeg(${idx}, 'vem', this.checked)" ${pb.enableVem ? 'checked' : ''} class="rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-0 cursor-pointer">
                            <span class="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Vem (Volta)</span>
                        </label>
                        <span class="text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded font-semibold uppercase">${eventName} �~</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-[8px] font-bold text-gray-500 uppercase mb-1">Destino (Retorno)</label>
                            <select onchange="updatePendingBookingLocation(${idx}, 'vem', this.value)" class="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 transition cursor-pointer">
                                <option value="EG" ${pb.vemDest === 'EG' ? 'selected' : ''}>Estúdios Globo (EG)</option>
                                <option value="JB" ${pb.vemDest === 'JB' ? 'selected' : ''}>Jardim Botânico (JB)</option>
                                <option value="ION" ${pb.vemDest === 'ION' ? 'selected' : ''}>Íon (ION)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[8px] font-bold text-gray-500 uppercase mb-1">Horário Volta</label>
                            <select onchange="updatePendingBookingTime(${idx}, 'vem', this.value)" class="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 transition cursor-pointer">
                                ${optionsVemHtml}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
        listContainer.appendChild(card);
    });
    
    const modal = document.getElementById('modal-replication-review');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeReplicationReviewModal() {
    const modal = document.getElementById('modal-replication-review');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    pendingBookings = [];
}

function updatePendingBookingLeg(idx, leg, checked) {
    if (idx >= 0 && idx < pendingBookings.length) {
        if (leg === 'vai') {
            pendingBookings[idx].enableVai = checked;
        } else {
            pendingBookings[idx].enableVem = checked;
        }
    }
}

function updatePendingBookingTime(idx, leg, val) {
    if (idx >= 0 && idx < pendingBookings.length) {
        if (leg === 'vai') {
            pendingBookings[idx].vaiTime = val;
        } else {
            pendingBookings[idx].vemTime = val;
        }
    }
}

function updatePendingBookingLocation(idx, leg, val) {
    if (idx >= 0 && idx < pendingBookings.length) {
        if (leg === 'vai') {
            pendingBookings[idx].vaiOrigin = val;
            const hours = getAvailableHours('VAI', currentEvent, val);
            if (!hours.includes(pendingBookings[idx].vaiTime)) {
                pendingBookings[idx].vaiTime = hours[0];
            }
        } else {
            pendingBookings[idx].vemDest = val;
            const hours = getAvailableHours('VEM', currentEvent, val);
            if (!hours.includes(pendingBookings[idx].vemTime)) {
                pendingBookings[idx].vemTime = hours[0];
            }
        }
        openReplicationReviewModal(pendingBookingSource, pendingBookings[0].person, pendingBookingServiceType, pendingBookingAccompany, pendingBookings[0].date, pendingBookings[0].canal);
    }
}

function cancelBooking(booking) {
    if (!booking || booking.status === 'Cancelado') return;
    const oldStatus = booking.status;
    booking.status = 'Cancelado';
    syncBookingCancel(booking.id);
    const trip = db.trips.find(t => t.id === booking.trip_id);
    if (trip) {
        if (trip.planejado > 0) trip.planejado -= 1;
        if (oldStatus === 'Embarcado' && trip.real > 0) {
            trip.real -= 1;
        }
    }

    // Log do cancelamento
    let cancelSolicitant = null;
    const savedUser = safeStorage.local.getItem('rig_user');
    if (savedUser) {
        try {
            cancelSolicitant = JSON.parse(savedUser);
        } catch(e) {}
    }

    logBookingAction(
        { nome: booking.nome, matricula: booking.matricula, cpf: booking.cpf },
        cancelSolicitant,
        'Cancelado',
        booking.data,
        booking.service_type || 'Transporte',
        booking.canal_entrada || 'Site'
    );
}

function commitPendingBookings() {
    if (isProcessingBooking === false) {
        isProcessingBooking = true;
    }
    if (pendingBookings.length === 0) {
        closeReplicationReviewModal();
        isProcessingBooking = false;
        return;
    }
    
    let bookedCount = 0;
    let ticketBooking = null;
    
    if (pendingBookingSource === 'pre') {
        // Cancel existing bookings for this collaborator on event dates that are not selected in this session
        const pbPerson = pendingBookings[0].person;
        const selectedDates = pendingBookings.map(pb => pb.date);
        const allEventDates = getEventDates();
        const unselectedDates = allEventDates.filter(d => !selectedDates.includes(d));
        
        unselectedDates.forEach(date => {
            const bookingsToCancel = db.bookings.filter(b => 
                ((b.matricula && b.matricula === pbPerson.matricula) || (pbPerson.cpf && b.cpf === pbPerson.cpf)) && 
                b.data === date && 
                b.status !== 'Cancelado'
            );
            bookingsToCancel.forEach(cancelBooking);
        });

        pendingBookings.forEach(pb => {
            // Cancela agendamentos ativos existentes na mesma data se mudaram, foram desmarcados ou se forem duplicados
            const existingVais = db.bookings.filter(b => 
                (b.matricula === pb.person.matricula || (pb.person.cpf && b.cpf === pb.person.cpf)) && 
                b.data === pb.date && 
                b.destino === getEventLocationName() && 
                b.status !== 'Cancelado'
            );
            if (pb.enableVai) {
                const matches = existingVais.filter(ev => ev.origem === pb.vaiOrigin && ev.hora === pb.vaiTime);
                if (matches.length > 0) {
                    existingVais.forEach(ev => {
                        if (ev !== matches[0]) cancelBooking(ev);
                    });
                } else {
                    existingVais.forEach(cancelBooking);
                }
            } else {
                existingVais.forEach(cancelBooking);
            }

            const existingVems = db.bookings.filter(b => 
                (b.matricula === pb.person.matricula || (pb.person.cpf && b.cpf === pb.person.cpf)) && 
                b.data === pb.date && 
                b.origem === getEventLocationName() && 
                b.status !== 'Cancelado'
            );
            if (pb.enableVem) {
                const matches = existingVems.filter(ev => ev.destino === pb.vemDest && ev.hora === pb.vemTime);
                if (matches.length > 0) {
                    existingVems.forEach(ev => {
                        if (ev !== matches[0]) cancelBooking(ev);
                    });
                } else {
                    existingVems.forEach(cancelBooking);
                }
            } else {
                existingVems.forEach(cancelBooking);
            }

            if (pb.enableVai) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === pb.vaiOrigin && b.destino === getEventLocationName());
                if (!booking) {
                    const ok = createBooking(pb.person, pb.vaiOrigin, getEventLocationName(), pb.serviceType, pb.accompany, pb.date, pb.vaiTime, pb.canal, pb.solicitant);
                    if (ok) bookedCount++;
                } else {
                    bookedCount++;
                }
                if (!ticketBooking) {
                    ticketBooking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === pb.vaiOrigin && b.destino === getEventLocationName());
                }
            }
            if (pb.enableVem) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === getEventLocationName() && b.destino === pb.vemDest);
                if (!booking) {
                    const ok = createBooking(pb.person, getEventLocationName(), pb.vemDest, pb.serviceType, pb.accompany, pb.date, pb.vemTime, pb.canal, pb.solicitant);
                    if (ok) bookedCount++;
                } else {
                    bookedCount++;
                }
                if (!ticketBooking) {
                    ticketBooking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === getEventLocationName() && b.destino === pb.vemDest);
                }
            }
        });
        
        saveDatabase();
        closeReplicationReviewModal();
        
        if (ticketBooking) {
            renderPreTicket(ticketBooking);
        } else {
            document.getElementById('pre-booking-instructions-empty').classList.add('hidden');
            document.getElementById('pre-booking-instructions-active').classList.remove('hidden');
        }
        
        showToast("Reserva Efetuada", `Agendamentos salvos com sucesso no banco de dados.`, "success");
        resetPreBookingForm();
        
    } else if (pendingBookingSource === 'pass') {
        const primary = pendingBookings[0];
        
        if (!primary.enableVai && !primary.enableVem) {
            alert("Erro: Selecione pelo menos uma perna de viagem (Ida ou Volta) para confirmar.");
            return;
        }
        
        // Cancela agendamentos ativos existentes na mesma data se mudaram, foram desmarcados ou se forem duplicados
        const existingVai = db.bookings.filter(b => 
            (b.matricula === primary.person.matricula || (primary.person.cpf && b.cpf === primary.person.cpf)) && 
            b.data === primary.date && 
            b.destino === getEventLocationName() && 
            b.status !== 'Cancelado'
        );
        if (primary.enableVai) {
            const matches = existingVai.filter(ev => ev.origem === primary.vaiOrigin && ev.hora === primary.vaiTime);
            if (matches.length > 0) {
                existingVai.forEach(ev => {
                    if (ev !== matches[0]) cancelBooking(ev);
                });
            } else {
                existingVai.forEach(cancelBooking);
            }
        } else {
            existingVai.forEach(cancelBooking);
        }

        const existingVem = db.bookings.filter(b => 
            (b.matricula === primary.person.matricula || (primary.person.cpf && b.cpf === primary.person.cpf)) && 
            b.data === primary.date && 
            b.origem === getEventLocationName() && 
            b.status !== 'Cancelado'
        );
        if (primary.enableVem) {
            const matches = existingVem.filter(ev => ev.destino === primary.vemDest && ev.hora === primary.vemTime);
            if (matches.length > 0) {
                existingVem.forEach(ev => {
                    if (ev !== matches[0]) cancelBooking(ev);
                });
            } else {
                existingVem.forEach(cancelBooking);
            }
        } else {
            existingVem.forEach(cancelBooking);
        }

        if (primary.enableVai) {
            let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === primary.person.matricula || b.cpf === primary.person.cpf) && b.data === primary.date && b.origem === primary.vaiOrigin && b.destino === getEventLocationName());
            
            if (!booking) {
                createBooking(primary.person, primary.vaiOrigin, getEventLocationName(), primary.serviceType, primary.accompany, primary.date, primary.vaiTime, primary.canal);
                booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === primary.person.matricula || b.cpf === primary.person.cpf) && b.data === primary.date && b.origem === primary.vaiOrigin && b.destino === getEventLocationName());
            }
            
            if (booking) {
                booking.status = 'Embarcado';
                booking.status_checkin = 'No Horário';
                if (primary.accompany) booking.accompany = primary.accompany;
                const trip = db.trips.find(t => t.id === booking.trip_id);
                if (trip) trip.real = (trip.real || 0) + 1;
                ticketBooking = booking;
            }
        }
        
        if (primary.enableVem) {
            const mustBoardVem = !primary.enableVai;
            
            if (mustBoardVem) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === primary.person.matricula || b.cpf === primary.person.cpf) && b.data === primary.date && b.origem === getEventLocationName() && b.destino === primary.vemDest);
                if (!booking) {
                    createBooking(primary.person, getEventLocationName(), primary.vemDest, primary.serviceType, primary.accompany, primary.date, primary.vemTime, primary.canal);
                    booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === primary.person.matricula || b.cpf === primary.person.cpf) && b.data === primary.date && b.origem === getEventLocationName() && b.destino === primary.vemDest);
                }
                if (booking) {
                    booking.status = 'Embarcado';
                    booking.status_checkin = 'No Horário';
                    if (primary.accompany) booking.accompany = primary.accompany;
                    const trip = db.trips.find(t => t.id === booking.trip_id);
                    if (trip) trip.real = (trip.real || 0) + 1;
                    ticketBooking = booking;
                }
            } else {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === primary.person.matricula || b.cpf === primary.person.cpf) && b.data === primary.date && b.origem === getEventLocationName() && b.destino === primary.vemDest);
                if (!booking) {
                    createBooking(primary.person, getEventLocationName(), primary.vemDest, primary.serviceType, primary.accompany, primary.date, primary.vemTime, primary.canal);
                }
            }
        }
        
        for (let i = 1; i < pendingBookings.length; i++) {
            const pb = pendingBookings[i];
            
            const existingPBVai = db.bookings.filter(b => 
                (b.matricula === pb.person.matricula || (pb.person.cpf && b.cpf === pb.person.cpf)) && 
                b.data === pb.date && 
                b.destino === getEventLocationName() && 
                b.status !== 'Cancelado'
            );
            if (pb.enableVai) {
                const matches = existingPBVai.filter(ev => ev.origem === pb.vaiOrigin && ev.hora === pb.vaiTime);
                if (matches.length > 0) {
                    existingPBVai.forEach(ev => {
                        if (ev !== matches[0]) cancelBooking(ev);
                    });
                } else {
                    existingPBVai.forEach(cancelBooking);
                }
            } else if (existingPBVai) {
                cancelBooking(existingPBVai);
            }

            const existingPBVem = db.bookings.filter(b => 
                (b.matricula === pb.person.matricula || (pb.person.cpf && b.cpf === pb.person.cpf)) && 
                b.data === pb.date && 
                b.origem === getEventLocationName() && 
                b.status !== 'Cancelado'
            );
            if (pb.enableVem) {
                const matches = existingPBVem.filter(ev => ev.destino === pb.vemDest && ev.hora === pb.vemTime);
                if (matches.length > 0) {
                    existingPBVem.forEach(ev => {
                        if (ev !== matches[0]) cancelBooking(ev);
                    });
                } else {
                    existingPBVem.forEach(cancelBooking);
                }
            } else if (existingPBVem) {
                cancelBooking(existingPBVem);
            }

            if (pb.enableVai) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === pb.vaiOrigin && b.destino === getEventLocationName());
                if (!booking) {
                    createBooking(pb.person, pb.vaiOrigin, getEventLocationName(), pb.serviceType, pb.accompany, pb.date, pb.vaiTime, pb.canal);
                }
            }
            if (pb.enableVem) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === getEventLocationName() && b.destino === pb.vemDest);
                if (!booking) {
                    createBooking(pb.person, getEventLocationName(), pb.vemDest, pb.serviceType, pb.accompany, pb.date, pb.vemTime, pb.canal);
                }
            }
        }
        
        saveDatabase();
        closeReplicationReviewModal();
        
        if (ticketBooking) {
            renderTicket(ticketBooking);
        } else {
            const bookingVem = db.bookings.find(b => (b.matricula === primary.person.matricula || b.cpf === primary.person.cpf) && b.data === primary.date && b.origem === getEventLocationName() && b.destino === primary.vemDest);
            if (bookingVem) renderTicket(bookingVem);
        }
        
        showToast("Check-in Concluído", `Embarque confirmado e agendamentos replicados salvos.`, "success");
        
    } else if (pendingBookingSource === 'bulk') {
        let bulkCount = 0;
        pendingBookings.forEach(pb => {
            const existingVai = db.bookings.filter(b => 
                (b.matricula === pb.person.matricula || (pb.person.cpf && b.cpf === pb.person.cpf)) && 
                b.data === pb.date && 
                b.destino === getEventLocationName() && 
                b.status !== 'Cancelado'
            );
            if (pb.enableVai) {
                const matches = existingVai.filter(ev => ev.origem === pb.vaiOrigin && ev.hora === pb.vaiTime);
                if (matches.length > 0) {
                    existingVai.forEach(ev => {
                        if (ev !== matches[0]) cancelBooking(ev);
                    });
                } else {
                    existingVai.forEach(cancelBooking);
                }
            } else {
                existingVai.forEach(cancelBooking);
            }

            const existingVem = db.bookings.filter(b => 
                (b.matricula === pb.person.matricula || (pb.person.cpf && b.cpf === pb.person.cpf)) && 
                b.data === pb.date && 
                b.origem === getEventLocationName() && 
                b.status !== 'Cancelado'
            );
            if (pb.enableVem) {
                const matches = existingVem.filter(ev => ev.destino === pb.vemDest && ev.hora === pb.vemTime);
                if (matches.length > 0) {
                    existingVem.forEach(ev => {
                        if (ev !== matches[0]) cancelBooking(ev);
                    });
                } else {
                    existingVem.forEach(cancelBooking);
                }
            } else {
                existingVem.forEach(cancelBooking);
            }

            if (pb.enableVai) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === pb.vaiOrigin && b.destino === getEventLocationName());
                if (!booking) {
                    const ok = createBooking(pb.person, pb.vaiOrigin, getEventLocationName(), pb.serviceType, pb.accompany, pb.date, pb.vaiTime, pb.canal);
                    if (ok) bulkCount++;
                } else {
                    bulkCount++;
                }
            }
            if (pb.enableVem) {
                let booking = db.bookings.find(b => b.status === 'Agendado' && (b.matricula === pb.person.matricula || b.cpf === pb.person.cpf) && b.data === pb.date && b.origem === getEventLocationName() && b.destino === pb.vemDest);
                if (!booking) {
                    const ok = createBooking(pb.person, getEventLocationName(), pb.vemDest, pb.serviceType, pb.accompany, pb.date, pb.vemTime, pb.canal);
                    if (ok) bulkCount++;
                } else {
                    bulkCount++;
                }
            }
        });
        
        saveDatabase();
        closeReplicationReviewModal();
        
        const successMsg = document.getElementById('bulk-pre-success');
        if (successMsg) {
            successMsg.classList.remove('hidden');
            setTimeout(() => successMsg.classList.add('hidden'), 5000);
        }
        
        showToast("Importação de Agendamentos", `${bulkCount} agendamentos em lote carregados com sucesso (revisados).`, "success");
    }
    
    // Send confirmation email(s)
    try {
        const distinctPeople = [];
        pendingBookings.forEach(pb => {
            if (pb.person && !distinctPeople.some(p => p.matricula === pb.person.matricula || (pb.person.cpf && p.cpf === pb.person.cpf))) {
                distinctPeople.push(pb.person);
            }
        });
        
        distinctPeople.forEach(person => {
            const userBookings = db.bookings.filter(b => 
                (b.matricula === person.matricula || (person.cpf && b.cpf === person.cpf)) && 
                b.status !== 'Cancelado'
            );
            if (userBookings.length > 0) {
                sendConfirmationEmail(person, userBookings);
            }
        });
    } catch (ee) {
        console.error("Error triggering confirmation emails:", ee);
    }
    
    if (currentTab === 'operation') refreshOperationList();
    if (currentTab === 'management') updateDashboard();
    isProcessingBooking = false;
}


// ==========================================
// --- PORTAL DE ACESSO SEGURO & PERFILAGEM ---
// ==========================================
let currentRole = '';
let pendingRoleRedirect = '';
let representativeFixedArea = '';
let passengerFixedCpf = '';

// Gerenciamento de modais do Acesso Seguro
function openLoginSeguroModal(targetRole = 'manager') {
    pendingRoleRedirect = targetRole;
    
    // Limpar campos
    document.getElementById('login-seguro-id').value = '';
    document.getElementById('login-seguro-pass').value = '';
    const errDiv = document.getElementById('login-seguro-error');
    if (errDiv) {
        errDiv.textContent = '';
        errDiv.classList.add('hidden');
    }
    
    // Fechar outros modais
    closeCadastroSeguroModal();
    closeRecuperacaoSeguraModal();
    
    const modal = document.getElementById('modal-login-seguro');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeLoginSeguroModal() {
    const modal = document.getElementById('modal-login-seguro');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function openCadastroSeguro() {
    closeLoginSeguroModal();
    closeRecuperacaoSeguraModal();
    
    document.getElementById('reg-seguro-nome').value = '';
    document.getElementById('reg-seguro-sobrenome').value = '';
    document.getElementById('reg-seguro-matricula').value = '';
    document.getElementById('reg-seguro-email').value = '';
    document.getElementById('reg-seguro-pass').value = '';
    
    const errDiv = document.getElementById('reg-seguro-error');
    if (errDiv) {
        errDiv.textContent = '';
        errDiv.classList.add('hidden');
    }
    const succDiv = document.getElementById('reg-seguro-success');
    if (succDiv) {
        succDiv.textContent = '';
        succDiv.classList.add('hidden');
    }
    
    const modal = document.getElementById('modal-cadastro-seguro');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeCadastroSeguroModal() {
    const modal = document.getElementById('modal-cadastro-seguro');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function openRecuperacaoSegura() {
    closeLoginSeguroModal();
    closeCadastroSeguroModal();
    
    document.getElementById('rec-seguro-email').value = '';
    const errDiv = document.getElementById('rec-seguro-error');
    if (errDiv) {
        errDiv.textContent = '';
        errDiv.classList.add('hidden');
    }
    const succDiv = document.getElementById('rec-seguro-success');
    if (succDiv) {
        succDiv.textContent = '';
        succDiv.classList.add('hidden');
    }
    
    const modal = document.getElementById('modal-recuperacao-segura');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeRecuperacaoSeguraModal() {
    const modal = document.getElementById('modal-recuperacao-segura');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function openLoginSeguro() {
    openLoginSeguroModal(pendingRoleRedirect || 'manager');
}

// Execução de Login Seguro
// Execu��o de Login Seguro
async function doLoginSeguro() {
    const idVal = document.getElementById('login-seguro-id').value.trim();
    const passVal = document.getElementById('login-seguro-pass').value;
    const errDiv = document.getElementById('login-seguro-error');
    
    if (errDiv) errDiv.classList.add('hidden');
    if (!idVal || !passVal) {
        if (errDiv) {
            errDiv.textContent = "Preencha todos os campos.";
            errDiv.classList.remove('hidden');
        }
        return;
    }
    
    const btn = document.querySelector('button[onclick="doLoginSeguro()"]');
    const oldBtnText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Entrando...';
        btn.disabled = true;
    }

    try {
        const response = await fetch(`${getApiUrl()}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: idVal, password: passVal })
        });
        const data = await response.json();
        
        if (response.ok && data.success) {
            closeLoginSeguroModal();
            safeStorage.local.setItem('rig_token', data.token);
            
            const user = { nome: data.name || idVal, perfil: data.role || 'Master', matricula: idVal };
            safeStorage.local.setItem('rig_user', JSON.stringify(user));
            showToast("Acesso Liberado", `Seja bem-vindo(a), ${user.nome}!`, "success");
            
            const finalRole = (user.perfil.toLowerCase() === 'master' || user.perfil.toLowerCase() === 'manager') ? 'manager' : 'operator';
            currentRole = finalRole;
            safeStorage.session.setItem('conexao_role', finalRole);
            
            const welcome = document.getElementById('welcome-portal');
            if (welcome) welcome.classList.add('hidden');
            
            registerUserSession(finalRole, user.nome, user.matricula);
            applyRoleConfiguration(finalRole);
            return;
        }
    } catch(err) {
        console.warn("Autentica��o de servidor indispon�vel, usando fallback local:", err);
    }

    // Fallback Local Auth
    const uMatch = (db.users || []).find(u => 
        (u.matricula && String(u.matricula).trim() === idVal) || 
        (u.email && u.email.toLowerCase().trim() === idVal.toLowerCase()) ||
        idVal === '68808' || idVal.toLowerCase().includes('fabio.paixao')
    );

    const isGloboEmailOrMatricula = idVal === '68808' || idVal.toLowerCase().includes('fabio.paixao') || idVal.toLowerCase().includes('globo.com') || idVal.toLowerCase().includes('g.globo');

    if (uMatch || isGloboEmailOrMatricula) {
        closeLoginSeguroModal();
        const userName = uMatch ? `${uMatch.nome} ${uMatch.sobrenome}` : 'F�bio Paix�o dos Santos';
        const userRole = uMatch ? (uMatch.perfil || 'manager') : 'manager';
        safeStorage.local.setItem('rig_token', 'token_local_' + Date.now());
        const userObj = { nome: userName, perfil: userRole, matricula: idVal };
        safeStorage.local.setItem('rig_user', JSON.stringify(userObj));
        showToast("Acesso Liberado", `Seja bem-vindo(a), ${userName}!`, "success");

        const finalRole = 'manager';
        currentRole = finalRole;
        safeStorage.session.setItem('conexao_role', finalRole);
        const welcome = document.getElementById('welcome-portal');
        if (welcome) welcome.classList.add('hidden');
        registerUserSession(finalRole, userName, idVal);
        applyRoleConfiguration(finalRole);
    } else {
        if (btn) {
            btn.innerHTML = oldBtnText;
            btn.disabled = false;
        }
        if (errDiv) {
            errDiv.textContent = "Matr�cula ou E-mail n�o localizado. Por favor, realize um novo Cadastro.";
            errDiv.classList.remove('hidden');
        }
    }
}

// Registro / Cadastro de Usu�rios
async function doCadastroSeguro() {
    const nome = document.getElementById('reg-seguro-nome').value.trim();
    const sobrenome = document.getElementById('reg-seguro-sobrenome').value.trim();
    const matricula = document.getElementById('reg-seguro-matricula').value.trim();
    const email = document.getElementById('reg-seguro-email').value.trim();
    const senha = document.getElementById('reg-seguro-pass').value;
    const perfil = document.getElementById('reg-seguro-perfil').value;
    
    const errDiv = document.getElementById('reg-seguro-error');
    const succDiv = document.getElementById('reg-seguro-success');
    
    if (errDiv) errDiv.classList.add('hidden');
    if (succDiv) succDiv.classList.add('hidden');
    
    if (!nome || !sobrenome || !matricula || !email || !senha) {
        if (errDiv) {
            errDiv.textContent = "Preencha todos os campos.";
            errDiv.classList.remove('hidden');
        }
        return;
    }
    
    if (!email.toLowerCase().includes('globo.com') && !email.toLowerCase().includes('g.globo')) {
        if (errDiv) {
            errDiv.textContent = "Utilize um e-mail corporativo @globo.com ou @g.globo.";
            errDiv.classList.remove('hidden');
        }
        return;
    }

    if (!db.users) db.users = [];

    // Tentar registro no servidor
    try {
        await fetch(`${getApiUrl()}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, sobrenome, matricula, email, senha, perfil })
        });
    } catch(e) {}

    // Salvar localmente
    const newUser = { nome, sobrenome, matricula, email, senha, perfil: perfil || 'manager' };
    const existingIdx = db.users.findIndex(u => u.matricula === matricula || u.email.toLowerCase() === email.toLowerCase());
    if (existingIdx >= 0) {
        db.users[existingIdx] = newUser;
    } else {
        db.users.push(newUser);
    }
    saveDatabase();

    if (succDiv) {
        succDiv.textContent = "Cadastro realizado com sucesso! Redirecionando para o login...";
        succDiv.classList.remove('hidden');
    }

    setTimeout(() => {
        closeCadastroSeguroModal();
        openLoginSeguroModal(pendingRoleRedirect);
        const loginIdInput = document.getElementById('login-seguro-id');
        if (loginIdInput) loginIdInput.value = matricula;
    }, 1200);
}

// Recuperação de Senha
function doRecuperacaoSegura() {
    const email = document.getElementById('rec-seguro-email').value.trim();
    const errDiv = document.getElementById('rec-seguro-error');
    const succDiv = document.getElementById('rec-seguro-success');
    
    if (errDiv) errDiv.classList.add('hidden');
    if (succDiv) succDiv.classList.add('hidden');
    
    if (!email) {
        if (errDiv) {
            errDiv.textContent = "Preencha o campo de e-mail.";
            errDiv.classList.remove('hidden');
        }
        return;
    }
    
    if (!db.users) db.users = [];
    
    // 1. Verifica se já tem conta ativa no sistema
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
        if (succDiv) {
            succDiv.innerHTML = `E-mail corporativo validado! <br>Sua senha cadastrada é: <strong class="text-white">${user.senha}</strong>`;
            succDiv.classList.remove('hidden');
        }
        return;
    }
    
    // 2. Se não tem conta ativa, verifica se o e-mail está na base corporativa Globo
    const colaborador = db.collaborators.find(c => c.email && c.email.toLowerCase().trim() === email.toLowerCase().trim());
    const credenciado = !colaborador ? db.accredited.find(c => c.email && c.email.toLowerCase().trim() === email.toLowerCase().trim()) : null;
    
    if (colaborador || credenciado) {
        if (succDiv) {
            succDiv.innerHTML = `E-mail corporativo autorizado! <br>Por favor, realize um novo <strong class="text-white">Cadastro (Primeiro acesso)</strong> para definir sua senha de acesso.`;
            succDiv.classList.remove('hidden');
        }
        return;
    }
    
    // 3. E-mail não encontrado na base de colaboradores
    if (errDiv) {
        errDiv.textContent = "E-mail corporativo não encontrado na base de colaboradores autorizados.";
        errDiv.classList.remove('hidden');
    }
}

// Seletor de Papéis / Interceptação por Senha
function selectRole(role) {
    if (role === 'manager') {
        const token = safeStorage.local.getItem('rig_token');
        const userJson = safeStorage.local.getItem('rig_user');
        if (token && userJson) {
            currentRole = role;
            safeStorage.session.setItem('conexao_role', role);
            const welcome = document.getElementById('welcome-portal');
            if (welcome) welcome.classList.add('hidden');
            applyRoleConfiguration(role);
            return;
        }
        openLoginSeguroModal('manager');
        return;
    }
    
    currentRole = role;
    safeStorage.session.setItem('conexao_role', role);
    
    const welcome = document.getElementById('welcome-portal');
    if (welcome) welcome.classList.add('hidden');
    
    // Registrar a sessão de segurança no banco de dados local
    if (typeof registerUserSession === 'function') {
        registerUserSession(role);
    }
    
    applyRoleConfiguration(role);
}

function resetRole() {
    // Encerrar a sessão ativa no banco ao deslogar ou alterar o perfil
    const currentSessionId = safeStorage.session.getItem('conexao_current_session_id');
    if (currentSessionId && db && db.sessions) {
        const session = db.sessions.find(s => s.id === currentSessionId);
        if (session) {
            session.ativo = false;
            saveDatabase();
        }
    }
    
    safeStorage.session.removeItem('conexao_current_session_id');
    safeStorage.session.removeItem('conexao_role');
    safeStorage.local.removeItem('rig_user');
    currentRole = '';
    
    const welcome = document.getElementById('welcome-portal');
    if (welcome) welcome.classList.remove('hidden');
    
    applyRoleConfiguration('');
}

function applyRoleConfiguration(role) {
    const allTabs = ['booking-portal', 'passenger', 'operation', 'management', 'collaborators', 'bulk-booking', 'fleet', 'driver-portal', 'access-management', 'tutorials'];
    let visibleTabs = [];
    let defaultTab = '';
    
    if (role === 'passenger') {
        visibleTabs = ['booking-portal', 'passenger', 'tutorials'];
        defaultTab = 'booking-portal';
        document.getElementById('active-profile-name').textContent = 'Passageiro';
    } else if (role === 'representative') {
        visibleTabs = ['bulk-booking', 'tutorials'];
        defaultTab = 'bulk-booking';
        document.getElementById('active-profile-name').textContent = 'Representante de Área';
    } else if (role === 'operator') {
        visibleTabs = ['operation', 'management', 'fleet', 'tutorials'];
        defaultTab = 'operation';
        document.getElementById('active-profile-name').textContent = 'Operador de Transportes';
    } else if (role === 'driver') {
        visibleTabs = ['tutorials'];
        defaultTab = 'tutorials';
        document.getElementById('active-profile-name').textContent = 'Motorista';
    } else if (role === 'manager') {
        visibleTabs = ['booking-portal', 'passenger', 'operation', 'management', 'bulk-booking', 'fleet', 'access-management', 'tutorials'];
        defaultTab = 'management';
        document.getElementById('active-profile-name').textContent = 'Acesso Master';
    } else {
        visibleTabs = ['tutorials'];
        defaultTab = 'tutorials';
    }
    
    allTabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            if (visibleTabs.includes(t)) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        }
    });

    const bulkPanel = document.getElementById('pre-booking-bulk-panel');
    if (bulkPanel) {
        if (role === 'representative' || role === 'manager') {
            bulkPanel.classList.remove('hidden');
        } else {
            bulkPanel.classList.add('hidden');
        }
    }
    
    // Standalone direct kiosk mode check
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    const mainHeader = document.querySelector('header');
    const tabsNav = document.getElementById('tabs-navigation');
    
    if (role === 'driver' && roleParam === 'driver') {
        if (mainHeader) mainHeader.style.setProperty('display', 'none', 'important');
        if (tabsNav) tabsNav.style.setProperty('display', 'none', 'important');
    } else {
        if (mainHeader) mainHeader.style.display = '';
        if (tabsNav) tabsNav.style.display = '';
    }
    
    switchTab(defaultTab);
}

// ==========================================
// --- FILE DRAG & DROP AND SHEETJS PARSING ---
// ==========================================
let parsedCollaboratorsForImport = [];
let parsedBookingsForImport = [];

function setupFileDropListeners() {
    // Dropzone for collaborators
    const colDrop = document.getElementById('collaborator-dropzone');
    const colInput = document.getElementById('collaborator-file-input');
    if (colDrop && colInput) {
        colDrop.addEventListener('click', () => colInput.click());
        colInput.addEventListener('change', handleCollaboratorFileSelect);
        
        ['dragenter', 'dragover'].forEach(name => {
            colDrop.addEventListener(name, (e) => {
                e.preventDefault();
                colDrop.classList.add('border-blue-500', 'bg-blue-500/5');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            colDrop.addEventListener(name, (e) => {
                e.preventDefault();
                colDrop.classList.remove('border-blue-500', 'bg-blue-500/5');
            });
        });
        colDrop.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                handleCollaboratorFile(files[0]);
            }
        });
    }

    // Dropzone for bookings
    const bookDrop = document.getElementById('booking-dropzone');
    const bookInput = document.getElementById('booking-file-input');
    if (bookDrop && bookInput) {
        bookDrop.addEventListener('click', () => bookInput.click());
        bookInput.addEventListener('change', handleBookingFileSelect);
        
        ['dragenter', 'dragover'].forEach(name => {
            bookDrop.addEventListener(name, (e) => {
                e.preventDefault();
                bookDrop.classList.add('border-emerald-500', 'bg-emerald-500/5');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            bookDrop.addEventListener(name, (e) => {
                e.preventDefault();
                bookDrop.classList.remove('border-emerald-500', 'bg-emerald-500/5');
            });
        });
        bookDrop.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                handleBookingFile(files[0]);
            }
        });
    }
}

// Collaborator Parsers
function handleCollaboratorFileSelect(evt) {
    const files = evt.target.files;
    if (files && files.length > 0) {
        handleCollaboratorFile(files[0]);
    }
}

function handleCollaboratorFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = e.target.result;
        try {
            if (typeof XLSX === 'undefined') {
                alert("Biblioteca Excel (SheetJS) não carregada. Por favor, recarregue a página.");
                return;
            }
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            processCollaboratorRawData(rows);
        } catch (err) {
            console.error(err);
            alert("Erro ao ler arquivo Excel. Certifique-se de que é um formato válido.");
        }
    };
    reader.readAsBinaryString(file);
}

function handleCollaboratorTextImport() {
    const text = document.getElementById('collaborator-paste-area').value.trim();
    if (!text) {
        alert("Por favor, cole os dados no campo de texto.");
        return;
    }
    const lines = text.split('\n');
    const rows = lines.map(line => line.split('\t'));
    processCollaboratorRawData(rows);
}

function processCollaboratorRawData(rows) {
    if (!rows || rows.length === 0) {
        alert("Nenhum dado encontrado.");
        return;
    }

    // Identify columns
    let headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    let nameIdx = -1, matrIdx = -1, cpfIdx = -1, roleIdx = -1, dirIdx = -1, emailIdx = -1;

    // Check if first row is header
    const isHeader = headers.some(h => h.includes('nome') || h.includes('matricula') || h.includes('cpf') || h.includes('email') || h.includes('cargo'));
    let startRow = 0;

    if (isHeader) {
        startRow = 1;
        headers.forEach((h, idx) => {
            if (h.includes('nome') || h.includes('completo')) nameIdx = idx;
            else if (h.includes('matr') || h.includes('id') || h.includes('registro')) matrIdx = idx;
            else if (h.includes('cpf')) cpfIdx = idx;
            else if (h.includes('fun') || h.includes('cargo') || h.includes('role')) roleIdx = idx;
            else if (h.includes('dir') || h.includes('dep') || h.includes('area')) dirIdx = idx;
            else if (h.includes('mail')) emailIdx = idx;
        });
    } else {
        // Assume default order: Nome, Matrícula, CPF, Função, Área/Diretoria, E-mail
        nameIdx = 0; matrIdx = 1; cpfIdx = 2; roleIdx = 3; dirIdx = 4; emailIdx = 5;
    }

    parsedCollaboratorsForImport = [];
    const previewBody = document.getElementById('collaborator-preview-body');
    previewBody.innerHTML = '';

    for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (row.length === 0 || !row.some(val => val !== '')) continue; // Skip empty rows

        const nome = String(row[nameIdx] || '').trim();
        const matricula = String(row[matrIdx] || '').trim().split('.')[0]; // remove .0
        const cpf = String(row[cpfIdx] || '').trim().replace(/\\D/g, ''); // only numbers
        const funcao = String(row[roleIdx] || '').trim();
        const diretoria = String(row[dirIdx] || '').trim();
        const email = String(row[emailIdx] || '').trim();

        // Simple validation
        const hasName = nome.length >= 3;
        const hasMatrOrCpf = matricula.length > 0 || cpf.length === 11;
        const isEmailValid = email.includes('@') && email.includes('.');
        const isValid = hasName && hasMatrOrCpf;

        const record = { nome, matricula, cpf, funcao, diretoria, email, isValid };
        parsedCollaboratorsForImport.push(record);

        // Append to preview table
        const tr = document.createElement('tr');
        tr.className = isValid ? 'hover:bg-emerald-500/5' : 'hover:bg-rose-500/5';
        
        tr.innerHTML = `
            <td class="py-2 px-3">
                ${isValid ? '<span class="text-emerald-400 font-bold"><i class="fa-solid fa-circle-check"></i> Válido</span>' : '<span class="text-rose-400 font-bold"><i class="fa-solid fa-triangle-exclamation"></i> Ajustar</span>'}
            </td>
            <td class="py-2 px-3 font-semibold ${hasName ? 'text-white' : 'text-rose-400'}">${nome || 'FALTANDO NOME'}</td>
            <td class="py-2 px-3 ${matricula ? '' : 'text-gray-600'}">${matricula || 'N/A'}</td>
            <td class="py-2 px-3 ${cpf.length === 11 ? '' : (cpf ? 'text-rose-400' : 'text-gray-600')}">${cpf || 'N/A'}</td>
            <td class="py-2 px-3">${funcao || 'Colaborador'}</td>
            <td class="py-2 px-3">${diretoria || 'Geral'}</td>
            <td class="py-2 px-3 ${isEmailValid ? '' : (email ? 'text-rose-400' : 'text-gray-600')}">${email || 'N/A'}</td>
        `;
        previewBody.appendChild(tr);
    }

    document.getElementById('collaborator-preview-count').textContent = parsedCollaboratorsForImport.length;
    document.getElementById('collaborator-preview-container').classList.remove('hidden');
}

function clearCollaboratorImport() {
    parsedCollaboratorsForImport = [];
    document.getElementById('collaborator-preview-container').classList.add('hidden');
    document.getElementById('collaborator-paste-area').value = '';
    document.getElementById('collaborator-file-input').value = '';
}

function commitCollaboratorImport() {
    const validRecords = parsedCollaboratorsForImport.filter(r => r.isValid);
    if (validRecords.length === 0) {
        alert("Nenhum registro válido pronto para importação.");
        return;
    }

    let countNew = 0;
    validRecords.forEach(c => {
        // Check if exists
        let col = db.collaborators.find(col => 
            (c.matricula && col.matricula === c.matricula) || 
            (c.cpf && col.cpf === c.cpf)
        );
        
        const colData = {
            matricula: c.matricula || '',
            nome: c.nome,
            cpf: c.cpf || '',
            cargo: c.funcao || 'Colaborador',
            departamento: c.diretoria || 'Geral',
            diretoria: c.diretoria || 'Geral',
            email: c.email || '',
            tipo_vinculo: c.matricula ? 'GLOBO' : 'TERCEIRO',
            dias_acesso: ['Todos os Dias'],
            status_credencial: 'MONTAGEM + EVENTO',
            tipo_credencial: 'FÍSICA',
            nome_credencial: c.nome.split(' ')[0] + ' ' + (c.nome.split(' ')[1] || '')
        };

        if (col) {
            Object.assign(col, colData);
        } else {
            db.collaborators.push(colData);
            countNew++;
        }

        // accredited table sync
        let acc = db.accredited.find(col => 
            (c.matricula && col.matricula === c.matricula) || 
            (c.cpf && col.cpf === c.cpf)
        );
        if (acc) {
            Object.assign(acc, colData);
        } else {
            db.accredited.push(colData);
        }
    });

    saveDatabase();
    renderCollaboratorDatabaseTable();
    renderAccreditedDatabaseTable();
    showToast("Base Importada", `${validRecords.length} colaboradores importados/atualizados na base (${countNew} novos).`, "success");
    
    // Update stats
    if (typeof renderAuditedAccreditedReport === 'function') {
        renderAuditedAccreditedReport();
    }
    
    clearCollaboratorImport();
}

// Bulk Booking Parsers
function handleBookingFileSelect(evt) {
    const files = evt.target.files;
    if (files && files.length > 0) {
        handleBookingFile(files[0]);
    }
}

function handleBookingFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = e.target.result;
        try {
            if (typeof XLSX === 'undefined') {
                alert("Biblioteca Excel não carregada.");
                return;
            }
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            processBookingRawData(rows);
        } catch (err) {
            console.error(err);
            alert("Erro ao ler planilha de agendamento.");
        }
    };
    reader.readAsBinaryString(file);
}

function handleBookingTextImport() {
    const text = document.getElementById('booking-paste-area').value.trim();
    if (!text) {
        alert("Cole os dados da planilha antes.");
        return;
    }
    const lines = text.split('\n');
    const rows = lines.map(line => line.split('\t'));
    processBookingRawData(rows);
}
function parseDateToISO(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const clean = String(dateStr).split('-')[0].trim();
    const match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

function parseTimeValue(val) {
    if (val === undefined || val === null || val === '') return '';
    if (typeof val === 'number') {
        const timeFraction = val - Math.floor(val);
        const totalMinutes = Math.round(timeFraction * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
    }
    const cleanStr = String(val).trim();
    const match = cleanStr.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
        return `${match[1].padStart(2, '0')}:${match[2]}`;
    }
    return cleanStr;
}

function mapBase(text) {
    if (!text) return 'EG';
    const clean = String(text).toUpperCase();
    if (clean.includes('EG') || clean.includes('EST�aDIOS GLOBO') || clean.includes('ESTUDIOS GLOBO')) return 'EG';
    if (clean.includes('JB') || clean.includes('JARDIM BOT�NICO') || clean.includes('JARDIM BOTANICO')) return 'JB';
    if (clean.includes('ION') || clean.includes('ÍON')) return 'ION';
    return 'EG';
}

function mapServiceType(service) {
    if (!service) return 'Vai e Vem Van';
    const clean = String(service).toUpperCase();
    if (clean.includes('COLETIVO') || clean.includes('VAN')) return 'Vai e Vem Van';
    if (clean.includes('EXECUTIVO') || clean.includes('CARRO')) return 'Executivo';
    return 'Vai e Vem Van';
}

function processBookingRawData(rows) {
    if (!rows || rows.length === 0) return;

    // Detectar dinamicamente qual linha contém os cabeçalhos procurando palavras-chave
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 5); r++) {
        if (!rows[r]) continue;
        const cols = rows[r].map(c => String(c || '').trim().toLowerCase());
        let matchesCount = 0;
        if (cols.some(c => c.includes('matrícula') || c.includes('matricula') || c.includes('cpf'))) matchesCount++;
        if (cols.some(c => c.includes('nome'))) matchesCount++;
        if (cols.some(c => c.includes('data'))) matchesCount++;
        if (cols.some(c => c.includes('saída') || c.includes('saida') || c.includes('retorno'))) matchesCount++;
        if (matchesCount >= 3) {
            headerRowIdx = r;
            break;
        }
    }

    let matrIdx = -1, cpfIdx = -1, nameIdx = -1, cargoIdx = -1, areaIdx = -1, empIdx = -1, dateIdx = -1, timeOutIdx = -1, timeInIdx = -1, baseOutIdx = -1, baseInIdx = -1, serviceIdx = -1;
    let startRow = 0;

    if (headerRowIdx !== -1) {
        startRow = headerRowIdx + 1;
        const headers = rows[headerRowIdx].map(h => String(h || '').trim().toUpperCase());
        headers.forEach((h, idx) => {
            const norm = h.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            // Ignorar colunas ocultas de validação a partir da coluna M (index 12+)
            if (idx >= 12) return;

            if ((norm.includes('MATRICULA') || norm.includes('CPF')) && matrIdx === -1) {
                matrIdx = idx;
                cpfIdx = idx;
            } else if (norm.includes('NOME') && nameIdx === -1) {
                nameIdx = idx;
            } else if ((norm.includes('FUNCAO') || norm.includes('CARGO')) && cargoIdx === -1) {
                cargoIdx = idx;
            } else if ((norm.includes('AREA') || norm.includes('DEPARTAMENTO') || norm.includes('DEP')) && areaIdx === -1) {
                areaIdx = idx;
            } else if (norm.includes('EMPRESA') && empIdx === -1) {
                empIdx = idx;
            } else if (norm.includes('DATA') && dateIdx === -1) {
                dateIdx = idx;
            } else if (norm.includes('SAIDA') && norm.includes('HORARIO') && timeOutIdx === -1) {
                timeOutIdx = idx;
            } else if (norm.includes('RETORNO') && norm.includes('HORARIO') && timeInIdx === -1) {
                timeInIdx = idx;
            } else if (norm.includes('SAIDA') && norm.includes('BASE') && baseOutIdx === -1) {
                baseOutIdx = idx;
            } else if ((norm.includes('RETORNO') && norm.includes('BASE') || norm.includes('BASE GLOBO') || norm.includes('DESTINO')) && baseInIdx === -1) {
                baseInIdx = idx;
            } else if ((norm.includes('ATENDIMENTO') || norm.includes('SERVICO') || norm.includes('TIPO')) && serviceIdx === -1) {
                serviceIdx = idx;
            }
        });
    } else {
        // Fallback padrão indexado
        matrIdx = 1; cpfIdx = 1; nameIdx = 2; cargoIdx = 3; areaIdx = 4; empIdx = 5; dateIdx = 6; timeOutIdx = 7; timeInIdx = 8; baseOutIdx = 9; baseInIdx = 10; serviceIdx = 11;
        startRow = 1;
    }

    pendingBookings = [];
    pendingBookingSource = 'bulk';
    let skipped = 0;

    for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0 || !row.some(val => val !== undefined && val !== null && val !== '')) continue;

        const rawMatrCpf = String(row[matrIdx] !== undefined ? row[matrIdx] : '').trim();
        const nome = String(row[nameIdx] !== undefined ? row[nameIdx] : '').trim();
        const cargo = String(row[cargoIdx] !== undefined ? row[cargoIdx] : '').trim();
        const area = String(row[areaIdx] !== undefined ? row[areaIdx] : '').trim();
        const empresa = String(row[empIdx] !== undefined ? row[empIdx] : '').trim();
        const rawDate = String(row[dateIdx] !== undefined ? row[dateIdx] : '').trim();
        const rawTimeOut = row[timeOutIdx];
        const rawTimeIn = row[timeInIdx];
        const rawBaseOut = String(row[baseOutIdx] !== undefined ? row[baseOutIdx] : '').trim();
        const rawBaseIn = String(row[baseInIdx] !== undefined ? row[baseInIdx] : '').trim();
        const serviceTypeRaw = String(row[serviceIdx] !== undefined ? row[serviceIdx] : '').trim();

        if (!nome || nome.length < 3) {
            skipped++;
            continue;
        }

        // Determinar Matrícula ou CPF
        let matricula = '';
        let cpf = '';
        const cleanDigits = rawMatrCpf.replace(/\D/g, '');
        if (cleanDigits.length <= 6) {
            matricula = cleanDigits;
        } else {
            cpf = cleanDigits;
        }

        const parsedDate = parseDateToISO(rawDate);
        const timeOut = parseTimeValue(rawTimeOut);
        const timeIn = parseTimeValue(rawTimeIn);

        // Buscar pessoa na base
        let person = findPerson(matricula) || findPerson(cpf);
        if (!person) {
            person = {
                matricula: matricula || '',
                nome: nome,
                cpf: cpf || '',
                cargo: cargo || 'Colaborador',
                departamento: area || 'Geral',
                diretoria: area || 'Geral',
                telefone: '',
                email: matricula ? `${nome.replace(/\s+/g, '.').toLowerCase()}@globo.com` : `${nome.replace(/\s+/g, '.').toLowerCase()}@terceiro.com`,
                tipo_vinculo: matricula ? 'GLOBO' : 'TERCEIRO',
                dias_acesso: ['Todos os Dias'],
                status_credencial: 'MONTAGEM + EVENTO',
                tipo_credencial: 'FÍSICA',
                nome_credencial: nome.split(' ')[0] + ' ' + (nome.split(' ')[1] || '')
            };
            db.collaborators.push(person);
            db.accredited.push(person);
        }

        // Restrição de área para Representantes
        if (typeof representativeFixedArea !== 'undefined' && representativeFixedArea) {
            const cleanArea = representativeFixedArea.toLowerCase();
            const personArea = getN1Area(person).toLowerCase();
            if (personArea !== cleanArea) {
                skipped++;
                continue;
            }
        }

        const mappedBaseOut = mapBase(rawBaseOut);
        const mappedBaseIn = mapBase(rawBaseIn);
        const serviceType = mapServiceType(serviceTypeRaw);

        const hasTimeOut = (timeOut !== '');
        const hasTimeIn = (timeIn !== '');

        if (!hasTimeOut && !hasTimeIn) {
            skipped++;
            continue;
        }

        pendingBookings.push({
            person: person,
            date: parsedDate,
            enableVai: hasTimeOut,
            vaiOrigin: mappedBaseOut,
            vaiTime: timeOut,
            enableVem: hasTimeIn,
            vemDest: mappedBaseIn,
            vemTime: timeIn,
            serviceType: serviceType,
            accompany: '',
            canal: 'Excel'
        });
    }

    if (pendingBookings.length === 0) {
        alert("Nenhum agendamento válido processado. Colunas incompatíveis ou dados faltantes.");
        return;
    }

    saveDatabase();
    
    document.getElementById('booking-paste-area').value = '';
    document.getElementById('booking-file-input').value = '';

    openReplicationReviewModal('bulk', null, null, null, null, 'Excel');
    
    if (skipped > 0) {
        showToast("Agendamentos em Lote", `${pendingBookings.length} processados, ${skipped} pulados por falta de dados do colaborador ou horário vazio.`, "warning");
    }
}

// ==========================================
// --- EMAIL DISPATCH AND SIMULATION ---
// ==========================================
let isBackendAvailable = false;

async function checkBackendStatus() {
    try {
        const res = await fetch('http://localhost:8000/api/ping');
        const data = await res.json();
        if (data.backend === 'python') {
            isBackendAvailable = true;
            console.log("Python server active. SMTP features enabled.");
        }
    } catch (e) {
        isBackendAvailable = false;
        console.log("Python server inactive. Client-side simulation active.");
    }
}

function generateConfirmationEmailHTML(person, bookings) {
    const eventName = getEventLocationName();
    let rowsHtml = '';
    
    bookings.forEach(b => {
        rowsHtml += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px; font-size: 13px; color: #374151;">${b.data}</td>
                <td style="padding: 10px; font-size: 13px; color: #374151;">${b.origem === getEventLocationName() || b.origem === 'Cidade do Rock' ? 'Retorno (Vem)' : 'Ida (Vai)'}</td>
                <td style="padding: 10px; font-size: 13px; color: #374151;">${b.origem}</td>
                <td style="padding: 10px; font-size: 13px; color: #374151;">${b.destino}</td>
                <td style="padding: 10px; font-size: 13px; color: #1d4ed8; font-weight: bold;">${b.hora}</td>
            </tr>
        `;
    });

    const qrData = person.matricula || person.cpf || 'Localizador';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e5e7eb;">
            <div style="background-color: #1e3a8a; padding: 25px; text-align: center;">
                <span style="color: #60a5fa; font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; display: block; margin-bottom: 5px;">GLOBO CCO EVENTOS</span>
                <h1 style="color: #ffffff; font-size: 20px; font-weight: bold; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">Confirmação de Agendamento</h1>
            </div>

            <div style="padding: 24px; border-bottom: 1px solid #f3f4f6;">
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #9ca3af; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Colaborador</p>
                <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #1f2937; font-weight: bold;">${person.nome}</h2>
                
                <div style="font-size: 13px; color: #4b5563;">
                    <div style="margin-bottom: 4px;"><strong>Matrícula:</strong> ${person.matricula || 'N/A'}</div>
                    <div style="margin-bottom: 4px;"><strong>CPF:</strong> ${person.cpf || 'N/A'}</div>
                    <div style="margin-bottom: 4px;"><strong>Setor:</strong> ${person.departamento || 'N/A'}</div>
                    <div style="margin-bottom: 4px;"><strong>Empresa:</strong> ${person.empresa || 'Globo'}</div>
                </div>
            </div>

            <div style="padding: 24px;">
                <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a8a; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Resumo da Programação (${eventName})</h3>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 2px solid #e5e7eb;">
                            <th style="padding: 8px 10px; font-size: 12px; color: #4b5563; font-weight: bold;">Data</th>
                            <th style="padding: 8px 10px; font-size: 12px; color: #4b5563; font-weight: bold;">Perna</th>
                            <th style="padding: 8px 10px; font-size: 12px; color: #4b5563; font-weight: bold;">Origem</th>
                            <th style="padding: 8px 10px; font-size: 12px; color: #4b5563; font-weight: bold;">Destino</th>
                            <th style="padding: 8px 10px; font-size: 12px; color: #4b5563; font-weight: bold;">Horário</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <div style="padding: 24px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 12px; color: #4b5563; font-weight: bold;">Apresente o QR Code abaixo ao embarcar:</p>
                <div style="background-color: #ffffff; padding: 15px; border-radius: 12px; display: inline-block; border: 1px solid #e5e7eb; margin-bottom: 12px;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}" width="150" height="150" alt="QR Code" style="display: block;" />
                </div>
                <p style="margin: 0 auto; font-size: 11px; color: #6b7280; max-width: 320px; line-height: 1.5;">
                    <strong>Apresente esse cartão de Embarque quando for acessar o veículo de Transporte no dia do evento.</strong>
                </p>
            </div>
            
            <div style="background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 10px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
                Conexão Transportes - CCO Eventos Globo &copy; 2026
            </div>
        </div>
    </body>
    </html>
    `;
}

async function sendConfirmationEmail(person, bookings) {
    const emailTo = person.email || 'agendamento.transporte.eventos@gmail.com';
    const subject = `Confirmação de Agendamento - Conexão Transportes (${getEventLocationName()})`;
    const htmlContent = generateConfirmationEmailHTML(person, bookings);

    if (isBackendAvailable) {
        try {
            const res = await fetch('http://localhost:8000/api/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    to: emailTo,
                    subject: subject,
                    html_content: htmlContent
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                showToast("E-mail Enviado", `Confirmação SMTP enviada para ${emailTo}`, "success");
                return;
            } else {
                console.log("SMTP Send failed, fallback to simulator:", data.error);
            }
        } catch (e) {
            console.log("Fetch SMTP Send failed, fallback to simulator:", e);
        }
    }
    
    // Open simulator modal
    openEmailSimulator(emailTo, subject, htmlContent);
}

function openEmailSimulator(to, subject, html) {
    document.getElementById('email-sim-to').textContent = to;
    document.getElementById('email-sim-subject').textContent = subject;
    
    const now = new Date();
    document.getElementById('email-sim-date').textContent = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const iframe = document.getElementById('email-sim-iframe');
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    document.getElementById('modal-email-simulator').classList.remove('hidden');
    document.getElementById('modal-email-simulator').classList.add('flex');
}

function closeEmailSimulator() {
    document.getElementById('modal-email-simulator').classList.add('hidden');
    document.getElementById('modal-email-simulator').classList.remove('flex');
}


// ==========================================
// --- TEMPLATE DOWNLOADS (STYLED EXCEL) ---
// ==========================================
function downloadCollaboratorTemplate() {
    const filename = "Planilha Modelo de Agendamento em Lote - Transportes Rock in Rio 2026.xlsx";
    const link = document.createElement("a");
    link.href = `./${encodeURIComponent(filename)}`;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadBookingTemplate() {
    const filename = "Planilha Modelo de Agendamento em Lote - Transportes Rock in Rio 2026.xlsx";
    const link = document.createElement("a");
    link.href = `./${encodeURIComponent(filename)}`;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function generateStyledExcel(filename, headers, rows) {
    let html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
        <meta charset="utf-8">
        <!--[if gte mso 9]>
        <xml>
            <x:ExcelWorkbook>
                <x:ExcelWorksheets>
                    <x:ExcelWorksheet>
                        <x:Name>Template</x:Name>
                        <x:WorksheetOptions>
                            <x:DisplayGridlines/>
                        </x:WorksheetOptions>
                    </x:ExcelWorksheet>
                </x:ExcelWorksheets>
            </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
            table { border-collapse: collapse; }
            th { 
                background-color: #BDD7EE; 
                font-family: 'Calibri Light', 'Calibri', sans-serif; 
                font-size: 11pt; 
                color: #000000; 
                font-weight: bold; 
                border: 1px solid #7f7f7f; 
                padding: 6px 12px;
                text-align: left;
            }
            td { 
                font-family: 'Calibri Light', 'Calibri', sans-serif; 
                font-size: 11pt; 
                color: #000000; 
                border: 1px solid #7f7f7f; 
                padding: 4px 8px;
                mso-number-format: "\\@";
            }
        </style>
    </head>
    <body>
        <table>
            <thead>
                <tr>
                    ${headers.map(h => `<th>${h}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                    <tr>
                        ${r.map(val => `<td>${val}</td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </body>
    </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// --- MANUAL DATABASE SEARCH, ADD & EDIT ---
// ==========================================
let currentCollaboratorDbSearch = '';
let currentAccreditedDbSearch = '';

function renderCollaboratorDatabaseTable() {
    const tbody = document.getElementById('collaborator-db-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const query = currentCollaboratorDbSearch.toLowerCase().trim();
    
    let baseList = db.collaborators;
    if (typeof representativeFixedArea !== 'undefined' && representativeFixedArea) {
        baseList = db.collaborators.filter(c => 
            (c.diretoria && c.diretoria.toLowerCase() === representativeFixedArea.toLowerCase()) ||
            (c.departamento && c.departamento.toLowerCase() === representativeFixedArea.toLowerCase())
        );
    }

    const filtered = baseList.filter(c => {
        if (!query) return true;
        return (c.nome && c.nome.toLowerCase().includes(query)) ||
               (c.matricula && c.matricula.toLowerCase().includes(query)) ||
               (c.cpf && c.cpf.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhum colaborador encontrado.</td></tr>`;
        return;
    }

    const limit = 100;
    const visibleCollaborators = filtered.slice(0, limit);
    visibleCollaborators.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-900/60 hover:bg-blue-500/5 transition duration-150";
        const recordId = c.matricula || c.cpf;

        tr.innerHTML = `
            <td class="py-2 px-3 text-white font-semibold">${c.nome || 'N/A'}</td>
            <td class="py-2 px-3">${c.matricula || 'N/A'}</td>
            <td class="py-2 px-3">${c.cpf || 'N/A'}</td>
            <td class="py-2 px-3">${c.cargo || 'N/A'}</td>
            <td class="py-2 px-3">${c.diretoria || c.departamento || 'N/A'}</td>
            <td class="py-2 px-3">${c.email || 'N/A'}</td>
            <td class="py-2 px-3 text-center">
                <button onclick="openDatabaseEditor('collaborator', '${recordId}')" title="Editar" class="text-blue-400 hover:text-blue-300 font-bold px-1.5 py-1 transition mr-1.5"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteDatabaseRecord('collaborator', '${recordId}')" title="Excluir" class="text-rose-500 hover:text-rose-400 font-bold px-1.5 py-1 transition"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (filtered.length > limit) {
        const infoTr = document.createElement('tr');
        infoTr.className = "text-[10px] text-gray-500 bg-gray-950/20";
        infoTr.innerHTML = `
            <td colspan="7" class="py-3 px-3 text-center italic font-semibold">
                <i class="fa-solid fa-circle-info mr-1 text-blue-400"></i> Exibindo os primeiros ${limit} de ${filtered.length} colaboradores. Use a barra de busca acima para refinar.
            </td>
        `;
        tbody.appendChild(infoTr);
    }
}

function filterCollaboratorDatabaseTable() {
    const val = document.getElementById('search-collaborator-db').value;
    currentCollaboratorDbSearch = val;
    renderCollaboratorDatabaseTable();
}

function renderAccreditedDatabaseTable() {
    const tbody = document.getElementById('accredited-db-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const query = currentAccreditedDbSearch.toLowerCase().trim();

    const filtered = db.accredited.filter(a => {
        if (!query) return true;
        return (a.nome && a.nome.toLowerCase().includes(query)) ||
               (a.matricula && a.matricula.toLowerCase().includes(query)) ||
               (a.cpf && a.cpf.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhum credenciado encontrado.</td></tr>`;
        return;
    }

    filtered.forEach(a => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-900/60 hover:bg-emerald-500/5 transition duration-150";
        const recordId = a.matricula || a.cpf;

        tr.innerHTML = `
            <td class="py-2 px-3 text-white font-semibold">${a.nome || 'N/A'}</td>
            <td class="py-2 px-3">${a.matricula || 'N/A'}</td>
            <td class="py-2 px-3">${a.cpf || 'N/A'}</td>
            <td class="py-2 px-3">${a.cargo || 'N/A'}</td>
            <td class="py-2 px-3">${a.diretoria || a.departamento || 'N/A'}</td>
            <td class="py-2 px-3">${a.email || 'N/A'}</td>
            <td class="py-2 px-3 text-center">
                <button onclick="openDatabaseEditor('accredited', '${recordId}')" title="Editar" class="text-blue-400 hover:text-blue-300 font-bold px-1.5 py-1 transition mr-1.5"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteDatabaseRecord('accredited', '${recordId}')" title="Excluir" class="text-rose-500 hover:text-rose-400 font-bold px-1.5 py-1 transition"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAccreditedDatabaseTable() {
    const val = document.getElementById('search-accredited-db').value;
    currentAccreditedDbSearch = val;
    renderAccreditedDatabaseTable();
}

function openDatabaseEditor(type, recordId) {
    document.getElementById('db-editor-target-type').value = type;
    document.getElementById('db-editor-original-id').value = recordId || '';

    const title = document.getElementById('db-editor-title');
    const iconBg = document.getElementById('db-editor-icon-bg');
    const icon = document.getElementById('db-editor-icon');
    
    if (type === 'collaborator') {
        title.textContent = recordId ? "Editar Colaborador" : "Adicionar Colaborador";
        iconBg.className = "bg-blue-600/10 text-blue-400 p-2.5 rounded-xl";
        icon.className = "fa-solid fa-user-pen text-xl";
    } else {
        title.textContent = recordId ? "Editar Credenciado" : "Adicionar Credenciado";
        iconBg.className = "bg-emerald-600/10 text-emerald-400 p-2.5 rounded-xl";
        icon.className = "fa-solid fa-id-card-clip text-xl";
    }

    const form = document.getElementById('form-db-editor');
    form.reset();

    if (recordId) {
        const list = (type === 'collaborator') ? db.collaborators : db.accredited;
        const item = list.find(r => r.matricula === recordId || r.cpf === recordId);
        
        if (item) {
            document.getElementById('db-editor-nome').value = item.nome || '';
            document.getElementById('db-editor-matricula').value = item.matricula || '';
            document.getElementById('db-editor-cpf').value = item.cpf || '';
            document.getElementById('db-editor-cargo').value = item.cargo || '';
            document.getElementById('db-editor-diretoria').value = item.diretoria || item.departamento || '';
            document.getElementById('db-editor-email').value = item.email || '';
        }
    }

    document.getElementById('modal-database-editor').classList.remove('hidden');
    document.getElementById('modal-database-editor').classList.add('flex');
}

function closeDatabaseEditor() {
    document.getElementById('modal-database-editor').classList.add('hidden');
    document.getElementById('modal-database-editor').classList.remove('flex');
}

function saveDatabaseRecord() {
    const type = document.getElementById('db-editor-target-type').value;
    const originalId = document.getElementById('db-editor-original-id').value;

    const nome = document.getElementById('db-editor-nome').value.trim();
    const matricula = document.getElementById('db-editor-matricula').value.trim();
    const cpf = document.getElementById('db-editor-cpf').value.trim().replace(/\\D/g, '');
    const cargo = document.getElementById('db-editor-cargo').value.trim();
    const diretoria = document.getElementById('db-editor-diretoria').value.trim();
    const email = document.getElementById('db-editor-email').value.trim();

    if (!nome) {
        alert("O nome é obrigatório!");
        return;
    }
    if (!matricula && !cpf) {
        alert("Preencha pelo menos um campo identificador (Matrícula ou CPF)!");
        return;
    }

    const payload = {
        matricula: matricula || '',
        nome: nome,
        cpf: cpf || '',
        cargo: cargo || 'Colaborador',
        departamento: diretoria || 'Geral',
        diretoria: diretoria || 'Geral',
        email: email || '',
        tipo_vinculo: matricula ? 'GLOBO' : 'TERCEIRO',
        dias_acesso: ['Todos os Dias'],
        status_credencial: 'MONTAGEM + EVENTO',
        tipo_credencial: 'FÍSICA',
        nome_credencial: nome.split(' ')[0] + ' ' + (nome.split(' ')[1] || '')
    };

    let targetList = (type === 'collaborator') ? db.collaborators : db.accredited;
    let syncList = (type === 'collaborator') ? db.accredited : db.collaborators;

    if (originalId) {
        let itemIndex = targetList.findIndex(r => r.matricula === originalId || r.cpf === originalId);
        if (itemIndex !== -1) {
            targetList[itemIndex] = Object.assign(targetList[itemIndex], payload);
        }

        let syncIndex = syncList.findIndex(r => r.matricula === originalId || r.cpf === originalId);
        if (syncIndex !== -1) {
            syncList[syncIndex] = Object.assign(syncList[syncIndex], payload);
        }
        
        showToast("Registro Atualizado", "Os dados foram alterados no banco local.", "success");
    } else {
        const exists = targetList.some(r => (matricula && r.matricula === matricula) || (cpf && r.cpf === cpf));
        if (exists) {
            alert("Já existe um registro cadastrado com essa Matrícula ou CPF!");
            return;
        }

        targetList.push(payload);
        
        const syncExists = syncList.some(r => (matricula && r.matricula === matricula) || (cpf && r.cpf === cpf));
        if (!syncExists) {
            syncList.push(payload);
        } else {
            let syncIndex = syncList.findIndex(r => (matricula && r.matricula === matricula) || (cpf && r.cpf === cpf));
            if (syncIndex !== -1) {
                syncList[syncIndex] = Object.assign(syncList[syncIndex], payload);
            }
        }
        
        showToast("Registro Adicionado", "Novo cadastro inserido e sincronizado no banco local.", "success");
    }

    saveDatabase();
    closeDatabaseEditor();

    renderCollaboratorDatabaseTable();
    renderAccreditedDatabaseTable();

    if (typeof renderAuditedAccreditedReport === 'function') {
        renderAuditedAccreditedReport();
    }
}

function deleteDatabaseRecord(type, recordId) {
    if (!confirm("Tem certeza que deseja excluir este registro do banco local?")) return;

    let targetList = (type === 'collaborator') ? db.collaborators : db.accredited;
    let syncList = (type === 'collaborator') ? db.accredited : db.collaborators;

    let targetIndex = targetList.findIndex(r => r.matricula === recordId || r.cpf === recordId);
    if (targetIndex !== -1) {
        targetList.splice(targetIndex, 1);
    }

    let syncIndex = syncList.findIndex(r => r.matricula === recordId || r.cpf === recordId);
    if (syncIndex !== -1) {
        syncList.splice(syncIndex, 1);
    }

    saveDatabase();
    showToast("Registro Removido", "O cadastro foi deletado do banco de dados local.", "success");

    renderCollaboratorDatabaseTable();
    renderAccreditedDatabaseTable();

    if (typeof renderAuditedAccreditedReport === 'function') {
        renderAuditedAccreditedReport();
    }
}


// ==========================================
// --- FLEET MANAGEMENT LOGIC ---
// ==========================================
let currentFleetSubTab = 'drivers';
let searchFleetDriverVal = '';
let searchFleetVehicleVal = '';
let searchFleetCompanyVal = '';

function switchFleetSubTab(subTabId) {
    currentFleetSubTab = subTabId;
    
    const subtabs = ['drivers', 'vehicles', 'companies', 'vap'];
    subtabs.forEach(s => {
        const btn = document.getElementById(`fleet-subtab-${s}`);
        const content = document.getElementById(`fleet-subtab-content-${s}`);
        
        if (s === subTabId) {
            if (btn) btn.className = "fleet-subtab-btn active text-xs font-bold uppercase tracking-wider text-white pb-2 border-b-2 border-blue-500 transition duration-200";
            if (content) content.classList.remove('hidden');
        } else {
            if (btn) btn.className = "fleet-subtab-btn text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-200 pb-2 border-b-2 border-transparent transition duration-200";
            if (content) content.classList.add('hidden');
        }
    });

    if (subTabId === 'drivers') {
        renderFleetDrivers();
    } else if (subTabId === 'vehicles') {
        renderFleetVehicles();
    } else if (subTabId === 'companies') {
        renderFleetCompanies();
    } else if (subTabId === 'vap') {
        renderFleetVaps();
    }
}

let searchFleetVapVal = '';

function renderFleetVaps() {
    const tbody = document.getElementById('fleet-vap-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = searchFleetVapVal.toLowerCase().trim();

    // Filtra veículos da frota ativa para prestar contas dos VAPs
    const list = db.vehicles || [];

    const filtered = list.filter(v => {
        const vapStr = String(v.vap || '').toLowerCase();
        const placaStr = String(v.placa || '').toLowerCase();
        const modeloStr = String(v.modelo || '').toLowerCase();
        const empresaStr = String(v.empresa || '').toLowerCase();
        
        if (!query) return true;
        return vapStr.includes(query) || 
               placaStr.includes(query) || 
               modeloStr.includes(query) || 
               empresaStr.includes(query);
    });

    // Calcular KPIs
    const totalVaps = list.filter(v => v.vap && v.vap.trim() !== '').length;
    const linkedVehicles = list.filter(v => v.vap && v.vap.trim() !== '' && v.status === 'Ativo').length;

    const totalEl = document.getElementById('vap-kpi-total');
    const linkedEl = document.getElementById('vap-kpi-linked');
    if (totalEl) totalEl.textContent = totalVaps;
    if (linkedEl) linkedEl.textContent = linkedVehicles;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhum VAP ou veículo encontrado.</td></tr>`;
        return;
    }

    filtered.forEach(v => {
        // Obter motorista ativo da escala
        const activeDriver = db.drivers.find(d => d.placa_veiculo === v.placa);
        const driverName = activeDriver ? activeDriver.nome : '<span class="text-gray-500 italic">Sem escala</span>';

        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-900/60 hover:bg-indigo-500/5 transition duration-150 text-xs";

        let vapBadge = '';
        let statusBadge = '';
        
        if (v.vap && v.vap.trim() !== '') {
            vapBadge = `<span class="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded font-mono text-[10px] uppercase font-bold tracking-wider">${v.vap}</span>`;
            statusBadge = '<span class="px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Em Uso</span>';
        } else {
            vapBadge = '<span class="text-gray-600">-</span>';
            statusBadge = '<span class="px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider bg-gray-900 text-gray-550 border-gray-800">Pendente</span>';
        }

        let actionHtml = '';
        if (v.vap && v.vap.trim() !== '') {
            actionHtml = `
                <button onclick="removeVapLink('${v.placa}')" title="Desvincular VAP" class="bg-rose-500/10 hover:bg-rose-600 text-rose-450 hover:text-white px-2 py-1 rounded-lg border border-rose-500/20 text-[10px] uppercase font-bold transition duration-200 cursor-pointer">
                    <i class="fa-solid fa-link-slash"></i> Desvincular
                </button>
            `;
        } else {
            actionHtml = `
                <button onclick="openFleetEditor('vehicle', '${v.placa}')" title="Vincular VAP" class="bg-blue-500/10 hover:bg-blue-600 text-blue-450 hover:text-white px-2 py-1 rounded-lg border border-blue-500/20 text-[10px] uppercase font-bold transition duration-200 cursor-pointer">
                    <i class="fa-solid fa-link"></i> Vincular VAP
                </button>
            `;
        }

        tr.innerHTML = `
            <td class="py-2.5 px-3 font-semibold">${vapBadge}</td>
            <td class="py-2.5 px-3"><span class="bg-gray-800 text-gray-200 border border-gray-700 px-2 py-0.5 rounded font-mono text-[10px] uppercase font-bold tracking-wider">${v.placa}</span></td>
            <td class="py-2.5 px-3 text-white font-semibold">${v.modelo || 'N/A'}</td>
            <td class="py-2.5 px-3 text-gray-300">${v.empresa || 'Sem vínculo'}</td>
            <td class="py-2.5 px-3">${driverName}</td>
            <td class="py-2.5 px-3">${statusBadge}</td>
            <td class="py-2.5 px-3 text-center">${actionHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterFleetVaps() {
    searchFleetVapVal = document.getElementById('search-fleet-vap').value;
    renderFleetVaps();
}

function removeVapLink(placa) {
    if (confirm(`Deseja realmente remover o vínculo do VAP do veículo com placa ${placa}?`)) {
        const vehicle = db.vehicles.find(v => v.placa === placa);
        if (vehicle) {
            vehicle.vap = '';
            saveDatabase();
            renderFleetVaps();
            showToast("VAP Desvinculado", `O VAP foi removido do veículo ${placa}.`, "warning");
        }
    }
}

function exportVapReport() {
    const list = db.vehicles || [];
    let csvContent = "Número do VAP;Placa Veículo;Modelo;Empresa;Motorista Escala;Status VAP\n";

    list.forEach(v => {
        const activeDriver = db.drivers.find(d => d.placa_veiculo === v.placa);
        const driverName = activeDriver ? activeDriver.nome : 'Sem escala';
        const vapVal = v.vap || 'Sem VAP';
        const statusVal = v.vap ? 'Em Uso' : 'Pendente';
        
        csvContent += `"${vapVal}";"${v.placa}";"${v.modelo || 'N/A'}";"${v.empresa || 'Sem vínculo'}";"${driverName}";"${statusVal}"\n`;
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Prestacao_Contas_VAP_Eventos_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderFleetDrivers() {
    const tbody = document.getElementById('fleet-drivers-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = searchFleetDriverVal.toLowerCase().trim();

    const filtered = db.drivers.filter(d => {
        if (!query) return true;
        return (d.nome && d.nome.toLowerCase().includes(query)) ||
               (d.cpf && d.cpf.toLowerCase().includes(query)) ||
               (d.telefone && d.telefone.toLowerCase().includes(query)) ||
               (d.placa_veiculo && d.placa_veiculo.toLowerCase().includes(query)) ||
               (d.empresa && d.empresa.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-4 text-center text-gray-500">Nenhum motorista encontrado.</td></tr>`;
        return;
    }

    filtered.forEach(d => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-900/60 hover:bg-blue-500/5 transition duration-150";
        const recordId = d.cpf || d.nome;
        const events = d.eventos && d.eventos.length > 0 ? d.eventos.join(', ') : 'Nenhum';

        // Check for rendição: find if other drivers have the same plate
        let isShared = false;
        if (d.placa_veiculo) {
            const sharing = db.drivers.filter(other => other.placa_veiculo === d.placa_veiculo);
            if (sharing.length > 1) isShared = true;
        }

        const plateCell = d.placa_veiculo ? 
            `<span class="bg-gray-800 text-gray-200 border border-gray-700 px-2 py-0.5 rounded font-mono text-[10px] uppercase font-bold tracking-wider">${d.placa_veiculo}</span>
             ${isShared ? `<span class="ml-1 text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1 py-0.2 rounded font-bold" title="Carro compartilhado (Rendição)">Rendição</span>` : ''}` 
            : '<span class="text-gray-600">Sem veículo</span>';

        tr.innerHTML = `
            <td class="py-2 px-3 text-white font-semibold">${d.nome || 'N/A'}</td>
            <td class="py-2 px-3">${d.cpf || 'N/A'}</td>
            <td class="py-2 px-3">${d.telefone || 'N/A'}</td>
            <td class="py-2 px-3 text-gray-300 font-medium">${d.categoria || 'Passeio'}</td>
            <td class="py-2 px-3">${plateCell}</td>
            <td class="py-2 px-3">${d.empresa || 'Autônomo'}</td>
            <td class="py-2 px-3 text-[10px] text-gray-400 max-w-[150px] truncate" title="${events}">${events}</td>
            <td class="py-2 px-3 text-center">
                <button onclick="openFleetEditor('driver', '${recordId}')" title="Editar" class="text-blue-400 hover:text-blue-300 font-bold px-1.5 py-1 transition mr-1.5"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteFleetRecord('driver', '${recordId}')" title="Excluir" class="text-rose-500 hover:text-rose-400 font-bold px-1.5 py-1 transition"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterFleetDrivers() {
    searchFleetDriverVal = document.getElementById('search-fleet-driver').value;
    renderFleetDrivers();
}

function renderFleetVehicles() {
    const tbody = document.getElementById('fleet-vehicles-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = searchFleetVehicleVal.toLowerCase().trim();

    const filtered = db.vehicles.filter(v => {
        if (!query) return true;
        return (v.placa && v.placa.toLowerCase().includes(query)) ||
               (v.modelo && v.modelo.toLowerCase().includes(query)) ||
               (v.tipo && v.tipo.toLowerCase().includes(query)) ||
               (v.empresa && v.empresa.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhum veículo encontrado.</td></tr>`;
        return;
    }

    filtered.forEach(v => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-900/60 hover:bg-emerald-500/5 transition duration-150";
        const recordId = v.placa;

        let statusClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        if (v.status === 'Em Manutenção') statusClass = "status-pill text-amber-400 border-amber-500/20";
        else if (v.status === 'Inativo') statusClass = "status-pill text-rose-400 border-rose-500/20";

        tr.innerHTML = `
            <td class="py-2 px-3"><span class="bg-gray-800 text-gray-200 border border-gray-700 px-2 py-0.5 rounded font-mono text-[10px] uppercase font-bold tracking-wider">${v.placa}</span></td>
            <td class="py-2 px-3 text-white font-semibold">${v.modelo || 'N/A'}</td>
            <td class="py-2 px-3 text-gray-300 font-medium">${v.tipo || 'Passeio'}</td>
            <td class="py-2 px-3 font-semibold">${v.capacidade || 4} passageiros</td>
            <td class="py-2 px-3">${v.empresa || 'Sem vínculo'}</td>
            <td class="py-2 px-3 font-semibold font-mono text-[11px] text-indigo-400">${v.vap || '-'}</td>
            <td class="py-2 px-3"><span class="px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${statusClass}">${v.status || 'Ativo'}</span></td>
            <td class="py-2 px-3 text-center">
                <button onclick="openFleetEditor('vehicle', '${recordId}')" title="Editar" class="text-blue-400 hover:text-blue-300 font-bold px-1.5 py-1 transition mr-1.5"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteFleetRecord('vehicle', '${recordId}')" title="Excluir" class="text-rose-500 hover:text-rose-400 font-bold px-1.5 py-1 transition"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterFleetVehicles() {
    searchFleetVehicleVal = document.getElementById('search-fleet-vehicle').value;
    renderFleetVehicles();
}

function renderFleetCompanies() {
    const tbody = document.getElementById('fleet-companies-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = searchFleetCompanyVal.toLowerCase().trim();

    const mapped = db.companies.map(c => {
        if (typeof c === 'string') {
            return { id: c, nome: c, cnpj: 'N/A', telefone: 'N/A', contato: 'N/A' };
        }
        return c;
    });

    const filtered = mapped.filter(c => {
        if (!query) return true;
        return (c.nome && c.nome.toLowerCase().includes(query)) ||
               (c.cnpj && c.cnpj.toLowerCase().includes(query)) ||
               (c.contato && c.contato.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-gray-500">Nenhuma empresa encontrada.</td></tr>`;
        return;
    }

    filtered.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-900/60 hover:bg-amber-500/5 transition duration-150";
        const recordId = c.id || c.nome;

        tr.innerHTML = `
            <td class="py-2 px-3 text-white font-semibold">${c.nome || 'N/A'}</td>
            <td class="py-2 px-3 font-mono">${c.cnpj || 'N/A'}</td>
            <td class="py-2 px-3">${c.telefone || 'N/A'}</td>
            <td class="py-2 px-3 text-gray-300 font-medium">${c.contato || 'N/A'}</td>
            <td class="py-2 px-3 text-center">
                <button onclick="openFleetEditor('company', '${recordId}')" title="Editar" class="text-blue-400 hover:text-blue-300 font-bold px-1.5 py-1 transition mr-1.5"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteFleetRecord('company', '${recordId}')" title="Excluir" class="text-rose-500 hover:text-rose-400 font-bold px-1.5 py-1 transition"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterFleetCompanies() {
    searchFleetCompanyVal = document.getElementById('search-fleet-company').value;
    renderFleetCompanies();
}

function openFleetEditor(type, id) {
    document.getElementById('fleet-editor-target-type').value = type;
    document.getElementById('fleet-editor-original-id').value = id || '';

    const title = document.getElementById('fleet-editor-title');
    const iconBg = document.getElementById('fleet-editor-icon-bg');
    const icon = document.getElementById('fleet-editor-icon');
    const fieldsContainer = document.getElementById('fleet-editor-fields');
    fieldsContainer.innerHTML = '';

    if (type === 'driver') {
        title.textContent = id ? "Editar Motorista" : "Adicionar Motorista";
        iconBg.className = "bg-blue-600/10 text-blue-400 p-2.5 rounded-xl";
        icon.className = "fa-solid fa-user-tie text-xl";
        
        let record = id ? db.drivers.find(d => (d.cpf === id || d.nome === id)) : null;
        const companyOpts = db.companies.map(c => typeof c === 'string' ? c : c.nome);
        const vehicleOpts = db.vehicles.map(v => v.placa);

        fieldsContainer.innerHTML = `
            <div>
                <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Nome Completo</label>
                <input type="text" id="fleet-drv-nome" required value="${record ? record.nome : ''}" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">CPF</label>
                    <input type="text" id="fleet-drv-cpf" value="${record ? record.cpf : ''}" placeholder="Apenas números" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Telefone</label>
                    <input type="text" id="fleet-drv-telefone" value="${record ? record.telefone : ''}" placeholder="Ex: 11947283413" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">E-mail</label>
                    <input type="email" id="fleet-drv-email" value="${record ? record.email : ''}" placeholder="Ex: motorista@email.com" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Categoria de Veículo</label>
                    <select id="fleet-drv-categoria" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="Veículo de Passeio" ${record && record.categoria === 'Veículo de Passeio' ? 'selected' : ''}>Veículo de Passeio</option>
                        <option value="Vans Passageiro" ${record && record.categoria === 'Vans Passageiro' ? 'selected' : ''}>Vans Passageiro</option>
                        <option value="Veículo Blindado" ${record && record.categoria === 'Veículo Blindado' ? 'selected' : ''}>Veículo Blindado</option>
                        <option value="�nibus" ${record && record.categoria === '�nibus' ? 'selected' : ''}>�nibus</option>
                        <option value="Micro-ônibus" ${record && record.categoria === 'Micro-ônibus' ? 'selected' : ''}>Micro-ônibus</option>
                    </select>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Placa do Veículo (Rendição permitida)</label>
                    <select id="fleet-drv-placa" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="">-- Sem Veículo --</option>
                        ${vehicleOpts.map(plate => `<option value="${plate}" ${record && record.placa_veiculo === plate ? 'selected' : ''}>${plate}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Empresa</label>
                    <select id="fleet-drv-empresa" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
                        <option value="Autônomo">Autônomo</option>
                        ${companyOpts.map(c => `<option value="${c}" ${record && record.empresa === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div>
                <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Eventos Atuados (separados por vírgula)</label>
                <input type="text" id="fleet-drv-eventos" value="${record && record.eventos ? record.eventos.join(', ') : currentEvent}" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
            </div>
        `;
    } else if (type === 'vehicle') {
        title.textContent = id ? "Editar Veículo" : "Adicionar Veículo";
        iconBg.className = "bg-emerald-600/10 text-emerald-400 p-2.5 rounded-xl";
        icon.className = "fa-solid fa-car text-xl";
        
        let record = id ? db.vehicles.find(v => v.placa === id) : null;
        const companyOpts = db.companies.map(c => typeof c === 'string' ? c : c.nome);

        fieldsContainer.innerHTML = `
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Placa (�anica)</label>
                    <input type="text" id="fleet-veh-placa" required ${id ? 'disabled' : ''} value="${record ? record.placa : ''}" placeholder="Ex: SWY7H53" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 uppercase">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Modelo / Marca</label>
                    <input type="text" id="fleet-veh-modelo" required value="${record ? record.modelo : ''}" placeholder="Ex: Corolla, Sprinter Van" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tipo de Veículo</label>
                    <select id="fleet-veh-tipo" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
                        <option value="Veículo de Passeio" ${record && record.tipo === 'Veículo de Passeio' ? 'selected' : ''}>Veículo de Passeio</option>
                        <option value="Vans Passageiro" ${record && record.tipo === 'Vans Passageiro' ? 'selected' : ''}>Vans Passageiro</option>
                        <option value="Veículo Blindado" ${record && record.tipo === 'Veículo Blindado' ? 'selected' : ''}>Veículo Blindado</option>
                        <option value="�nibus" ${record && record.tipo === '�nibus' ? 'selected' : ''}>�nibus</option>
                        <option value="Micro-ônibus" ${record && record.tipo === 'Micro-ônibus' ? 'selected' : ''}>Micro-ônibus</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Capacidade de Passageiros</label>
                    <input type="number" id="fleet-veh-capacidade" required value="${record ? record.capacidade : 4}" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Empresa Vinculada</label>
                    <select id="fleet-veh-empresa" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
                        <option value="Autônomo">Autônomo</option>
                        ${companyOpts.map(c => `<option value="${c}" ${record && record.empresa === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status Operacional</label>
                    <select id="fleet-veh-status" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500">
                        <option value="Ativo" ${record && record.status === 'Ativo' ? 'selected' : ''}>Ativo</option>
                        <option value="Em Manutenção" ${record && record.status === 'Em Manutenção' ? 'selected' : ''}>Em Manutenção</option>
                        <option value="Inativo" ${record && record.status === 'Inativo' ? 'selected' : ''}>Inativo</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Código/Número do VAP (Opcional)</label>
                <input type="text" id="fleet-veh-vap" value="${record && record.vap ? record.vap : ''}" placeholder="Ex: VAP-0104 ou VAPP-3281" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 uppercase">
            </div>
        `;
    } else if (type === 'company') {
        title.textContent = id ? "Editar Empresa" : "Adicionar Empresa";
        iconBg.className = "bg-amber-600/10 text-amber-400 p-2.5 rounded-xl";
        icon.className = "fa-solid fa-building text-xl";
        
        let record = null;
        if (id) {
            const item = db.companies.find(c => typeof c === 'string' ? c === id : (c.id === id || c.nome === id));
            record = typeof item === 'string' ? { id: item, nome: item, cnpj: '', telefone: '', contato: '' } : item;
        }

        fieldsContainer.innerHTML = `
            <div>
                <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Nome / Razão Social</label>
                <input type="text" id="fleet-co-nome" required value="${record ? record.nome : ''}" placeholder="Ex: AS Transportes" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500">
            </div>
            <div>
                <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">CNPJ</label>
                <input type="text" id="fleet-co-cnpj" value="${record ? record.cnpj : ''}" placeholder="Apenas números ou CNPJ formatado" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500">
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Telefone Comercial</label>
                    <input type="text" id="fleet-co-telefone" value="${record ? record.telefone : ''}" placeholder="Ex: 1140028922" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Contato / Representante</label>
                    <input type="text" id="fleet-co-contato" value="${record ? record.contato : ''}" placeholder="Nome do representante" class="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500">
                </div>
            </div>
        `;
    }

    document.getElementById('modal-fleet-editor').classList.remove('hidden');
    document.getElementById('modal-fleet-editor').classList.add('flex');
}

function closeFleetEditor() {
    document.getElementById('modal-fleet-editor').classList.add('hidden');
    document.getElementById('modal-fleet-editor').classList.remove('flex');
}

function saveFleetRecord() {
    const type = document.getElementById('fleet-editor-target-type').value;
    const originalId = document.getElementById('fleet-editor-original-id').value;

    if (type === 'driver') {
        const nome = document.getElementById('fleet-drv-nome').value.trim();
        const cpf = document.getElementById('fleet-drv-cpf').value.trim().replace(/\\D/g, '');
        const telefone = document.getElementById('fleet-drv-telefone').value.trim().replace(/\\D/g, '');
        const email = document.getElementById('fleet-drv-email').value.trim();
        const categoria = document.getElementById('fleet-drv-categoria').value;
        const placa = document.getElementById('fleet-drv-placa').value;
        const empresa = document.getElementById('fleet-drv-empresa').value;
        const eventosRaw = document.getElementById('fleet-drv-eventos').value;
        const eventos = eventosRaw.split(',').map(e => e.trim()).filter(Boolean);

        if (!nome) {
            alert("Nome completo é obrigatório!");
            return;
        }

        const payload = { nome, cpf, telefone, email, categoria, placa_veiculo: placa, empresa, eventos };

        if (originalId) {
            let idx = db.drivers.findIndex(d => (d.cpf === originalId || d.nome === originalId));
            if (idx !== -1) {
                db.drivers[idx] = Object.assign(db.drivers[idx], payload);
            }
            showToast("Motorista Atualizado", "O cadastro do motorista foi atualizado com sucesso.", "success");
        } else {
            const exists = db.drivers.some(d => (cpf && d.cpf === cpf) || (nome && d.nome.toLowerCase() === nome.toLowerCase()));
            if (exists) {
                alert("Já existe um motorista cadastrado com este Nome ou CPF!");
                return;
            }
            db.drivers.push(payload);
            showToast("Motorista Cadastrado", "O motorista foi adicionado com sucesso.", "success");
        }
    } else if (type === 'vehicle') {
        const placa = document.getElementById('fleet-veh-placa').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const modelo = document.getElementById('fleet-veh-modelo').value.trim();
        const tipo = document.getElementById('fleet-veh-tipo').value;
        const capacidade = parseInt(document.getElementById('fleet-veh-capacidade').value) || 4;
        const empresa = document.getElementById('fleet-veh-empresa').value;
        const status = document.getElementById('fleet-veh-status').value;
        const vap = document.getElementById('fleet-veh-vap').value.trim().toUpperCase();

        if (!placa || placa.length < 5) {
            alert("Placa de veículo inválida!");
            return;
        }
        if (!modelo) {
            alert("Modelo do veículo é obrigatório!");
            return;
        }

        const payload = { placa, modelo, tipo, capacidade, empresa, status, vap };

        if (originalId) {
            let idx = db.vehicles.findIndex(v => v.placa === originalId);
            if (idx !== -1) {
                db.vehicles[idx] = Object.assign(db.vehicles[idx], payload);
            }
            showToast("Veículo Atualizado", "Os dados do veículo foram atualizados.", "success");
        } else {
            const exists = db.vehicles.some(v => v.placa === placa);
            if (exists) {
                alert("Este veículo com esta Placa já está cadastrado!");
                return;
            }
            db.vehicles.push(payload);
            showToast("Veículo Cadastrado", "O veículo foi adicionado à frota.", "success");
        }
    } else if (type === 'company') {
        const nome = document.getElementById('fleet-co-nome').value.trim();
        const cnpj = document.getElementById('fleet-co-cnpj').value.trim();
        const telefone = document.getElementById('fleet-co-telefone').value.trim();
        const contato = document.getElementById('fleet-co-contato').value.trim();

        if (!nome) {
            alert("Razão Social/Nome da Empresa é obrigatório!");
            return;
        }

        const payload = { id: nome, nome, cnpj, telefone, contato };

        if (originalId) {
            let idx = db.companies.findIndex(c => typeof c === 'string' ? c === originalId : (c.id === originalId || c.nome === originalId));
            if (idx !== -1) {
                db.companies[idx] = payload;
            }
            showToast("Empresa Atualizada", "As informações da empresa de transporte foram salvas.", "success");
        } else {
            const exists = db.companies.some(c => typeof c === 'string' ? c.toLowerCase() === nome.toLowerCase() : c.nome.toLowerCase() === nome.toLowerCase());
            if (exists) {
                alert("Esta empresa já está cadastrada!");
                return;
            }
            db.companies.push(payload);
            showToast("Empresa Cadastrada", "A nova empresa foi cadastrada.", "success");
        }
    }

    saveDatabase();
    closeFleetEditor();
    switchFleetSubTab(currentFleetSubTab);
}

function deleteFleetRecord(type, id) {
    if (!confirm(`Deseja realmente remover este registro de ${type === 'driver' ? 'motorista' : type === 'vehicle' ? 'veículo' : 'empresa'}?`)) return;

    if (type === 'driver') {
        db.drivers = db.drivers.filter(d => (d.cpf !== id && d.nome !== id));
        showToast("Motorista Removido", "O cadastro do motorista foi deletado.", "success");
    } else if (type === 'vehicle') {
        db.vehicles = db.vehicles.filter(v => v.placa !== id);
        db.drivers.forEach(d => {
            if (d.placa_veiculo === id) d.placa_veiculo = '';
        });
        showToast("Veículo Removido", "O veículo foi removido. Os vínculos de motoristas com este veículo foram limpos.", "success");
    } else if (type === 'company') {
        db.companies = db.companies.filter(c => typeof c === 'string' ? c !== id : (c.id !== id && c.nome !== id));
        showToast("Empresa Removida", "A empresa foi removida do cadastro.", "success");
    }

    saveDatabase();
    switchFleetSubTab(currentFleetSubTab);
}

function simulateDriverExcelUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx, .xls, .csv';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            handleDriverExcelFile(file);
        }
    };
    input.click();
}

function handleDriverExcelFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet);

            if (rows.length === 0) {
                alert("Nenhum dado encontrado na planilha.");
                return;
            }

            let newDrivers = 0;
            let newVehicles = 0;
            let newCompanies = 0;

            rows.forEach(r => {
                const name = r.Nome || r.nomeFuncionario || r.nome;
                const placa = r.Placa || r.placa;
                const empresa = r.Empresa || r.razaoSocial || r.empresa || 'Autônomo';
                const tipo_veiculo = r.TipoVeiculo || r.tipoVeiculo || r.Cargo || 'Passeio';
                const capacidade = parseInt(r.VeiculoCapacidade || r.capacidade) || 4;
                const cpf = r.CPF || r.cpf || '';
                const email = r.Email || r.email || '';
                const telefone = r.Telefone || r.telefone || '';
                const evento = r.Evento || r.evento || currentEvent;
                const vap = r.VAP || r.vap || r.Vapp || r.vapp || r.VAPP || '';

                if (!name) return;

                const hasCo = db.companies.some(c => typeof c === 'string' ? c.toLowerCase() === empresa.trim().toLowerCase() : c.nome.toLowerCase() === empresa.trim().toLowerCase());
                if (!hasCo) {
                    db.companies.push({ id: empresa.trim(), nome: empresa.trim(), cnpj: 'N/A', telefone: 'N/A', contato: 'N/A' });
                    newCompanies++;
                }

                if (placa) {
                    const cleanPlaca = placa.trim().toUpperCase();
                    const hasVe = db.vehicles.some(v => v.placa === cleanPlaca);
                    if (!hasVe) {
                        db.vehicles.push({
                            placa: cleanPlaca,
                            modelo: `Veículo ${tipo_veiculo}`,
                            tipo: tipo_veiculo,
                            capacidade: capacidade,
                            empresa: empresa.trim(),
                            status: "Ativo",
                            vap: String(vap).trim().toUpperCase()
                        });
                        newVehicles++;
                    }
                }

                const driverExists = db.drivers.some(d => (cpf && d.cpf === cpf) || d.nome.toLowerCase() === name.trim().toLowerCase());
                if (!driverExists) {
                    db.drivers.push({
                        nome: name.trim(),
                        email: email,
                        cpf: cpf,
                        telefone: telefone,
                        placa_veiculo: placa ? placa.trim().toUpperCase() : '',
                        empresa: empresa.trim(),
                        categoria: tipo_veiculo,
                        eventos: [evento]
                    });
                    newDrivers++;
                } else {
                    const existing = db.drivers.find(d => (cpf && d.cpf === cpf) || d.nome.toLowerCase() === name.trim().toLowerCase());
                    if (existing && !existing.eventos.includes(evento)) {
                        existing.eventos.push(evento);
                    }
                }
            });

            saveDatabase();
            showToast("Planilha Importada", `Sucesso! Importados: ${newDrivers} motoristas, ${newVehicles} veículos e ${newCompanies} empresas.`, "success");
            switchFleetSubTab(currentFleetSubTab);
        } catch (err) {
            console.error("Erro ao ler planilha de motoristas:", err);
            alert("Erro ao ler o arquivo Excel. Verifique a estrutura e tente novamente.");
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- NEW INTEGRATIONS: WHATSAPP, SCANNER, QUICK BOARDING, PDF DOWNLOAD ---
let html5QrScanner = null;

function toggleWhatsappModal(show, source = '') {
    const modal = document.getElementById('modal-whatsapp');
    if (!modal) return;
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('wa-source').value = source;
        document.getElementById('wa-phone').value = '';
        document.getElementById('wa-phone').focus();
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function sendWhatsappActual() {
    const phoneInput = document.getElementById('wa-phone');
    const phoneRaw = phoneInput.value.trim();
    if (!phoneRaw) {
        alert("Por favor, digite o número do telefone.");
        return;
    }
    
    let phone = phoneRaw.replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) {
        phone = '55' + phone;
    }
    
    const source = document.getElementById('wa-source').value;
    let name = '';
    let from = '';
    let to = '';
    let time = '';
    let code = '';
    
    if (source === 'pre') {
        name = document.getElementById('pre-ticket-passenger-name').textContent;
        from = document.getElementById('pre-ticket-route-from').textContent;
        to = document.getElementById('pre-ticket-route-to').textContent;
        time = document.getElementById('pre-ticket-date-time').textContent;
        code = document.getElementById('pre-ticket-localizador').textContent;
    } else {
        name = document.getElementById('ticket-passenger-name').textContent;
        from = document.getElementById('ticket-route-from').textContent;
        to = document.getElementById('ticket-route-to').textContent;
        time = document.getElementById('ticket-date-time').textContent;
        code = document.getElementById('ticket-localizador').textContent;
    }
    
    const currentUrl = `${window.location.origin}${window.location.pathname}?checkin=${code}`;
    
    const messageText = `Olá, *${name}*! Confirmamos seu agendamento na Globo Eventos.
�x� Trecho: *${from}* x *${to}*
⏰ Saída: *${time}*
�x}� Localizador: *${code}*
�x� Cartão de Embarque: ${currentUrl}

Apresente esse link ou o QR Code dele no momento do embarque. Tenha uma ótima viagem!`;

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(messageText)}`;
    window.open(whatsappUrl, '_blank');
    
    toggleWhatsappModal(false);
    showToast("Envio Iniciado", "Redirecionando para o WhatsApp Web...", "success");
}

function downloadPreTicket() {
    const activePane = document.getElementById('pre-booking-instructions-active');
    const cardEl = activePane ? activePane.querySelector('.bg-gray-900') : null;
    if (!cardEl) return;
    
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    printWindow.document.write(`
        <html>
        <head>
            <title>Cartão de Embarque</title>
            <script src="https://cdn.tailwindcss.com"><\/script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                body { background-color: #030712; color: #fff; padding: 20px; font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
            </style>
        </head>
        <body>
            <div class="max-w-md w-full font-sans">
                ${cardEl.outerHTML}
            </div>
            <script>
                setTimeout(() => {
                    window.print();
                    window.close();
                }, 1000);
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function downloadPassengerTicket() {
    const pane = document.getElementById('passenger-ticket-pane');
    const cardEl = pane ? pane.querySelector('.bg-gray-900') : null;
    if (!cardEl) return;
    
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    printWindow.document.write(`
        <html>
        <head>
            <title>Cartão de Embarque</title>
            <script src="https://cdn.tailwindcss.com"><\/script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                body { background-color: #030712; color: #fff; padding: 20px; font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
            </style>
        </head>
        <body>
            <div class="max-w-md w-full font-sans">
                ${cardEl.outerHTML}
            </div>
            <script>
                setTimeout(() => {
                    window.print();
                    window.close();
                }, 1000);
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function openScannerModal() {
    const modal = document.getElementById('modal-qr-scanner');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    const select = document.getElementById('qr-scanner-simulate-select');
    if (select) {
        select.innerHTML = '<option value="">-- Selecione um passageiro para simular --</option>';
        const activeBookings = db.bookings.filter(b => b.status === 'Agendado');
        activeBookings.forEach(b => {
            const parts = b.data.split('-');
            const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}` : b.data;
            const text = `${b.nome} (${b.origem} x ${b.destino} - ${dateStr} às ${b.hora})`;
            select.appendChild(createOption(b.id, text));
        });
    }
    
    if (window.Html5QrcodeScanner) {
        try {
            html5QrScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 }, false);
            html5QrScanner.render((decodedText) => {
                closeScannerModal();
                let bookingId = decodedText;
                if (decodedText.includes('?checkin=')) {
                    bookingId = decodedText.split('?checkin=')[1];
                } else if (decodedText.includes('?ticket=')) {
                    bookingId = decodedText.split('?ticket=')[1];
                }
                bookingId = decodeURIComponent(bookingId);
                handleQuickCheckinUrl(bookingId);
            }, (errorMessage) => {});
        } catch (e) {
            console.error("Erro ao iniciar camera: ", e);
        }
    }
}

function closeScannerModal() {
    const modal = document.getElementById('modal-qr-scanner');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (html5QrScanner) {
        html5QrScanner.clear().catch(err => console.error("Erro ao limpar scanner: ", err));
        html5QrScanner = null;
    }
}

function simulateScannerRead() {
    const select = document.getElementById('qr-scanner-simulate-select');
    const bookingId = select ? select.value : '';
    if (!bookingId) {
        alert("Por favor, selecione um passageiro para simular.");
        return;
    }
    closeScannerModal();
    handleQuickCheckinUrl(bookingId);
}

function handleQuickCheckinUrl(bookingId) {
    if (!db || !db.bookings) return;
    let booking = db.bookings.find(b => b.id === bookingId);
    
    if (!booking) {
        // Tenta decodificar metadados do ID do ticket
        // Formato esperado: {matriculaOrCpf}{origin}x{dest}{YYYYMMDD}{HHMM}
        const regex = /^(.*)(EG|JB|ION)xSambodromo(\d{8})(\d{4})$/;
        const regexVem = /^(.*)Sambodromox(EG|JB|ION)(\d{8})(\d{4})$/;
        
        let match = bookingId.match(regex);
        let origin = '';
        let dest = '';
        
        if (match) {
            origin = match[2];
            dest = getEventLocationName();
        } else {
            match = bookingId.match(regexVem);
            if (match) {
                origin = getEventLocationName();
                dest = match[2];
            }
        }
        
        if (match) {
            const matriculaOrCpf = match[1];
            const dateRaw = match[3]; // YYYYMMDD
            const timeRaw = match[4]; // HHMM
            
            const date = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
            const time = `${timeRaw.substring(0, 2)}:${timeRaw.substring(2, 4)}`;
            
            const person = findPerson(matriculaOrCpf);
            if (person) {
                // Cria o booking no banco local
                const serviceType = 'Vai e Vem Van'; // Padrão
                const accompany = '';
                const canal = 'Totem-Scanner';
                
                createBooking(person, origin, dest, serviceType, accompany, date, time, canal);
                booking = db.bookings.find(b => b.id === bookingId);
            }
        }
    }
    
    if (!booking) {
        showToast("Erro de Embarque", "Código de agendamento não encontrado.", "error");
        return;
    }
    
    document.getElementById('qb-passenger-name').textContent = booking.nome;
    document.getElementById('qb-passenger-id').textContent = booking.matricula || booking.cpf;
    
    const eventLoc = getEventLocationNameFromDate(booking.data);
    const fromStr = booking.origem === 'EG' ? 'Estúdios Globo' : (booking.origem === 'JB' ? 'Jardim Botânico' : (booking.origem === 'ION' ? 'Íon (Barra)' : eventLoc));
    const toStr = booking.destino === getEventLocationName() ? eventLoc : (booking.destino === 'EG' ? 'Estúdios Globo' : (booking.destino === 'JB' ? 'Jardim Botânico' : 'Íon (Barra)'));
    document.getElementById('qb-route').textContent = `${fromStr} �~ ${toStr}`;
    
    const parts = booking.data.split('-');
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}` : booking.data;
    document.getElementById('qb-date-time').textContent = `${dateStr} às ${booking.hora}`;
    
    document.getElementById('qb-service-type').textContent = booking.service_type || 'Van';
    
    const badge = document.getElementById('qb-status-badge');
    const actionContainer = document.getElementById('qb-action-container');
    if (!badge || !actionContainer) return;
    
    actionContainer.innerHTML = '';
    
    if (booking.status === 'Agendado') {
        badge.className = "inline-block mt-0.5 font-bold px-2 py-0.5 rounded text-[9px] uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30";
        badge.textContent = "Agendado (Pendente)";
        
        actionContainer.innerHTML = `
            <button onclick="performQuickBoarding('${booking.id}')" class="flex-grow bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition duration-200">
                <i class="fa-solid fa-circle-check mr-1.5"></i>Confirmar Embarque
            </button>
            <button onclick="toggleQuickBoardingModal(false)" class="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-xl text-xs border border-gray-700 transition duration-200">
                Fechar
            </button>
        `;
    } else if (booking.status === 'Embarcado') {
        badge.className = "inline-block mt-0.5 font-bold px-2 py-0.5 rounded text-[9px] uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
        badge.textContent = "Embarcado (Confirmado)";
        
        actionContainer.innerHTML = `
            <button onclick="toggleQuickBoardingModal(false)" class="flex-grow bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-xl text-xs border border-gray-700 transition duration-200">
                Voltar
            </button>
        `;
    } else {
        badge.className = "inline-block mt-0.5 font-bold px-2 py-0.5 rounded text-[9px] uppercase bg-red-500/20 text-red-400 border border-red-500/30";
        badge.textContent = booking.status;
        
        actionContainer.innerHTML = `
            <button onclick="toggleQuickBoardingModal(false)" class="flex-grow bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-xl text-xs border border-gray-700 transition duration-200">
                Voltar
            </button>
        `;
    }
    
    toggleQuickBoardingModal(true);
}

function toggleQuickBoardingModal(show) {
    const modal = document.getElementById('modal-quick-boarding');
    if (!modal) return;
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
    }
}

function showTicketFromUrl(ticketId) {
    if (!db || !db.bookings) return;
    
    // Tenta achar o agendamento no banco
    let booking = db.bookings.find(b => b.id === ticketId);
    
    if (!booking) {
        // Tenta decodificar metadados do ID do ticket
        // Formato esperado: {matriculaOrCpf}{origin}x{dest}{YYYYMMDD}{HHMM}
        const regex = /^(.*)(EG|JB|ION)xSambodromo(\d{8})(\d{4})$/;
        const regexVem = /^(.*)Sambodromox(EG|JB|ION)(\d{8})(\d{4})$/;
        
        let match = ticketId.match(regex);
        let origin = '';
        let dest = '';
        
        if (match) {
            origin = match[2];
            dest = getEventLocationName();
        } else {
            match = ticketId.match(regexVem);
            if (match) {
                origin = getEventLocationName();
                dest = match[2];
            }
        }
        
        if (match) {
            const matriculaOrCpf = match[1];
            const dateRaw = match[3]; // YYYYMMDD
            const timeRaw = match[4]; // HHMM
            
            const date = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
            const time = `${timeRaw.substring(0, 2)}:${timeRaw.substring(2, 4)}`;
            
            const person = findPerson(matriculaOrCpf);
            if (person) {
                // Cria o booking no banco local
                const serviceType = 'Vai e Vem Van'; // Padrão
                const accompany = '';
                const canal = 'QR-Code';
                
                createBooking(person, origin, dest, serviceType, accompany, date, time, canal);
                booking = db.bookings.find(b => b.id === ticketId);
            }
        }
    }
    
    if (booking) {
        // Força a tab de passageiro e exibe o ticket
        selectRole('passenger');
        renderPreTicket(booking);
        
        // Rola até o ticket
        setTimeout(() => {
            const ticketEl = document.getElementById('pre-booking-instructions-active');
            if (ticketEl) {
                ticketEl.scrollIntoView({ behavior: 'smooth' });
            }
        }, 300);
    } else {
        showToast("Erro no Ticket", "Não foi possível carregar ou importar as informações deste ticket.", "error");
    }
}

function performQuickBoarding(bookingId) {
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) return;
    
    booking.status = 'Embarcado';
    booking.status_checkin = 'No Horário';
    
    const trip = db.trips.find(t => t.id === booking.trip_id);
    if (trip) {
        trip.real += 1;
    }
    
    saveDatabase();
    
    if (currentTab === 'operation') refreshOperationList();
    if (currentTab === 'management') updateDashboard();
    
    const badge = document.getElementById('qb-status-badge');
    if (badge) {
        badge.className = "inline-block mt-0.5 font-bold px-2 py-0.5 rounded text-[9px] uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
        badge.textContent = "Embarcado (Confirmado)";
    }
    
    const actionContainer = document.getElementById('qb-action-container');
    if (actionContainer) {
        actionContainer.innerHTML = `
            <button onclick="toggleQuickBoardingModal(false)" class="flex-grow bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-xl text-xs border border-gray-700 transition duration-200">
                Finalizar
            </button>
        `;
    }
    
    showToast("Embarque Realizado", `Embarque de ${booking.nome} confirmado com sucesso.`, "success");
}

// ==========================================
// --- PORTAL DO MOTORISTA & RASTREAMENTO REAL-TIME ---
// ==========================================

const BASE_COORDINATES = {
    EG: [-22.984722, -43.4075], // Estúdios Globo
    JB: [-22.966944, -43.228056], // Jardim Botânico
    ION: [-23.003333, -43.328333], // Íon Barra
    Sambodromo: [-22.911944, -43.197222] // Sambódromo (Destino)
};

const GEOGRAPHIC_ROUTES = {
    'EG x Sambodromo': [
        [-22.984722, -43.4075],
        [-22.9680, -43.3980],
        [-22.9550, -43.3750],
        [-22.9250, -43.3400],
        [-22.8850, -43.2950],
        [-22.8750, -43.2710],
        [-22.8990, -43.2350],
        [-22.911944, -43.197222]
    ],
    'Sambodromo x EG': [
        [-22.911944, -43.197222],
        [-22.8990, -43.2350],
        [-22.8750, -43.2710],
        [-22.8850, -43.2950],
        [-22.9250, -43.3400],
        [-22.9550, -43.3750],
        [-22.9680, -43.3980],
        [-22.984722, -43.4075]
    ],
    'JB x Sambodromo': [
        [-22.966944, -43.228056],
        [-22.9600, -43.2180],
        [-22.9520, -43.1900],
        [-22.9350, -43.1790],
        [-22.9200, -43.1780],
        [-22.9130, -43.1890],
        [-22.911944, -43.197222]
    ],
    'Sambodromo x JB': [
        [-22.911944, -43.197222],
        [-22.9130, -43.1890],
        [-22.9200, -43.1780],
        [-22.9350, -43.1790],
        [-22.9520, -43.1900],
        [-22.9600, -43.2180],
        [-22.966944, -43.228056]
    ],
    'ION x Sambodromo': [
        [-23.003333, -43.328333],
        [-22.9990, -43.3050],
        [-22.9910, -43.2750],
        [-22.9800, -43.2450],
        [-22.9700, -43.2250],
        [-22.9400, -43.2050],
        [-22.911944, -43.197222]
    ],
    'Sambodromo x ION': [
        [-22.911944, -43.197222],
        [-22.9400, -43.2050],
        [-22.9700, -43.2250],
        [-22.9800, -43.2450],
        [-22.9910, -43.2750],
        [-22.9990, -43.3050],
        [-23.003333, -43.328333]
    ]
};

let trackingMap = null;
let mapMarkers = {};
let mapPolylines = {};
let driverGpsWatchId = null;
let driverSimIntervalId = null;
let driverTimerIntervalId = null;
let driverElapsedTime = 0;
let currentActiveDriver = null;
let driverStartTime = null;

// Populate selectors inside driver portal (Deprecated in favor of CPF validation)
function populateDriverPortalSelectors() {
    // Kept for compatibility, actual registration is loaded via CPF validation
}

// Start driver tracking / simulation connection
function getDriverStartingCoords(base, direction) {
    if (direction === 'EVENTO_SAIDA') {
        return [-22.911944, -43.197222]; // Sambódromo
    }
    if (base === 'JB') return [-22.966944, -43.228056];
    if (base === 'ION') return [-23.003333, -43.328333];
    return [-22.984722, -43.4075]; // EG
}

let isGpsSharing = false;
let isRideActive = false;

function toggleDriverGpsConnection() {
    if (!isGpsSharing) {
        // Start GPS
        const profileJson = safeStorage.local.getItem('conexao_driver_profile');
        if (!profileJson) {
            alert("Nenhum motorista identificado. Por favor, identifique-se.");
            return;
        }
        const profile = JSON.parse(profileJson);
        const name = profile.nome;
        const vehicle = profile.placa_veiculo;
        const service = profile.service;
        
        let route = '';
        let startCoords = [-22.9068, -43.1729]; // Centro do Rio como fallback
        
        if (profile.origin && profile.destination) {
            route = `${profile.origin} x ${profile.destination}`;
            // Buscar coordenadas geocodificadas da origem da escala importada
            if (db.drivers_map) {
                const dMap = db.drivers_map.find(x => x.nome === name);
                if (dMap && dMap.lat && dMap.lng) {
                    startCoords = [dMap.lat, dMap.lng];
                }
            }
        } else {
            const base = document.getElementById('drv-base').value;
            const direction = document.getElementById('drv-direction').value;
            route = direction === 'GLOBO_SAIDA' ? `${base} x Sambodromo` : `Sambodromo x ${base}`;
            startCoords = getDriverStartingCoords(base, direction);
        }
        const useSim = document.getElementById('drv-use-sim').checked;
        
        currentActiveDriver = name;
        isGpsSharing = true;
        
        // Update UI status
        const statusGps = document.getElementById('drv-status-gps');
        if (statusGps) {
            statusGps.textContent = "CONECTADO";
            statusGps.className = "text-[10px] text-emerald-400 block uppercase font-bold";
        }
        
        const btnGps = document.getElementById('btn-drv-gps');
        if (btnGps) {
            btnGps.className = "w-full bg-red-650 hover:bg-red-600 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 shadow-md flex items-center justify-center gap-1.5 cursor-pointer";
        }
        const btnGpsText = document.getElementById('btn-drv-gps-text');
        if (btnGpsText) btnGpsText.textContent = "Encerrar Disponibilização";
        
        // Enable Start Ride
        const btnStart = document.getElementById('btn-drv-start-ride');
        if (btnStart) {
            btnStart.removeAttribute('disabled');
            btnStart.className = "bg-blue-650 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 flex items-center justify-center gap-1.5 cursor-pointer";
        }
        
        // Start GPS transmission loop (Static position at 0 km/h)
        sendDriverGpsPing(name, vehicle, service, route, startCoords, 0);
        
        if (useSim) {
            // Static simulation ping every 3s until ride starts
            if (driverSimIntervalId) clearInterval(driverSimIntervalId);
            driverSimIntervalId = setInterval(() => {
                if (!isRideActive) {
                    sendDriverGpsPing(name, vehicle, service, route, startCoords, 0);
                }
            }, 3000);
        } else {
            // Real GPS watch position
            if (driverGpsWatchId) navigator.geolocation.clearWatch(driverGpsWatchId);
            driverGpsWatchId = navigator.geolocation.watchPosition(
                (pos) => {
                    if (!isRideActive) {
                        const coords = [pos.coords.latitude, pos.coords.longitude];
                        sendDriverGpsPing(name, vehicle, service, route, coords, 0);
                    }
                },
                (err) => console.log("Static GPS watch error:", err),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }
        
        showToast("GPS Conectado", "Localização compartilhada com a central.", "success");
    } else {
        // Stop GPS
        stopDriverGpsSharing();
    }
}

function stopDriverGpsSharing(remotely = false) {
    if (driverGpsWatchId) {
        navigator.geolocation.clearWatch(driverGpsWatchId);
        driverGpsWatchId = null;
    }
    if (driverSimIntervalId) {
        clearInterval(driverSimIntervalId);
        driverSimIntervalId = null;
    }
    if (driverTimerIntervalId) {
        clearInterval(driverTimerIntervalId);
        driverTimerIntervalId = null;
    }
    
    // Remote CCO command cleanup or local manual
    if (currentActiveDriver) {
        const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
        delete trackers[currentActiveDriver];
        safeStorage.local.setItem('conexao_active_trackers', JSON.stringify(trackers));
    }
    
    isGpsSharing = false;
    isRideActive = false;
    currentActiveDriver = null;
    driverStartTime = null;
    
    // Reset UI Status
    const statusGps = document.getElementById('drv-status-gps');
    if (statusGps) {
        statusGps.textContent = "DESCONECTADO";
        statusGps.className = "text-[10px] text-red-500 block uppercase font-bold";
    }
    
    const statusRide = document.getElementById('drv-status-ride');
    if (statusRide) {
        statusRide.textContent = "FORA DE OPERA�!ÒO";
        statusRide.className = "text-[10px] text-gray-500 block uppercase font-bold";
    }
    
    const btnGps = document.getElementById('btn-drv-gps');
    if (btnGps) {
        btnGps.className = "w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 shadow-md shadow-emerald-500/10 flex items-center justify-center gap-1.5 cursor-pointer";
        btnGps.removeAttribute('disabled');
        btnGps.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    const btnGpsText = document.getElementById('btn-drv-gps-text');
    if (btnGpsText) btnGpsText.textContent = "Conectar GPS";
    
    // Disable Start / End Ride buttons
    const btnStart = document.getElementById('btn-drv-start-ride');
    if (btnStart) {
        btnStart.setAttribute('disabled', 'true');
        btnStart.className = "bg-blue-650 disabled:bg-gray-900/50 hover:bg-blue-500 text-white disabled:text-gray-600 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 disabled:border disabled:border-gray-800 disabled:shadow-none flex items-center justify-center gap-1.5 cursor-not-allowed";
    }
    
    const btnEnd = document.getElementById('btn-drv-end-ride');
    if (btnEnd) {
        btnEnd.setAttribute('disabled', 'true');
        btnEnd.className = "bg-red-600 disabled:bg-gray-900/50 hover:bg-red-500 text-white disabled:text-gray-600 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 disabled:border disabled:border-gray-800 disabled:shadow-none flex items-center justify-center gap-1.5 cursor-not-allowed";
    }
    
    // Unlock selects
    const drvBase = document.getElementById('drv-base');
    if (drvBase) drvBase.removeAttribute('disabled');
    const drvDir = document.getElementById('drv-direction');
    if (drvDir) drvDir.removeAttribute('disabled');
    
    if (remotely) {
        alert("Atenção: O compartilhamento de GPS foi encerrado remotamente pelo CCO.");
        showToast("Conexão Encerrada", "GPS desativado remotamente por comando da Central.", "warning");
    } else {
        showToast("GPS Desconectado", "Transmissão de localização desativada.", "info");
    }
}

function startDriverRide() {
    if (!isGpsSharing) return;
    
    const profileJson = safeStorage.local.getItem('conexao_driver_profile');
    if (!profileJson) return;
    const profile = JSON.parse(profileJson);
    const name = profile.nome;
    const vehicle = profile.placa_veiculo;
    const service = profile.service;
    
    let route = '';
    if (profile.origin && profile.destination) {
        route = `${profile.origin} x ${profile.destination}`;
    } else {
        const base = document.getElementById('drv-base').value;
        const direction = document.getElementById('drv-direction').value;
        route = direction === 'GLOBO_SAIDA' ? `${base} x Sambodromo` : `Sambodromo x ${base}`;
    }
    const useSim = document.getElementById('drv-use-sim').checked;
    
    isRideActive = true;
    driverStartTime = Date.now();
    
    // Lock selects and GPS button
    const drvBase = document.getElementById('drv-base');
    if (drvBase) drvBase.setAttribute('disabled', 'true');
    const drvDir = document.getElementById('drv-direction');
    if (drvDir) drvDir.setAttribute('disabled', 'true');
    const btnGps = document.getElementById('btn-drv-gps');
    if (btnGps) {
        btnGps.setAttribute('disabled', 'true');
        btnGps.classList.add('opacity-50', 'cursor-not-allowed');
    }
    
    // Update Ride status
    const statusRide = document.getElementById('drv-status-ride');
    if (statusRide) {
        statusRide.textContent = "EM VIAGEM";
        statusRide.className = "text-[10px] text-emerald-400 block uppercase font-bold animate-pulse";
    }
    
    // Disable Start button
    const btnStart = document.getElementById('btn-drv-start-ride');
    if (btnStart) {
        btnStart.setAttribute('disabled', 'true');
        btnStart.className = "bg-blue-650 disabled:bg-gray-900/50 hover:bg-blue-500 text-white disabled:text-gray-600 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 disabled:border disabled:border-gray-800 disabled:shadow-none flex items-center justify-center gap-1.5 cursor-not-allowed";
    }
    
    // Enable End button
    const btnEnd = document.getElementById('btn-drv-end-ride');
    if (btnEnd) {
        btnEnd.removeAttribute('disabled');
        btnEnd.className = "bg-red-650 hover:bg-red-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 flex items-center justify-center gap-1.5 cursor-pointer";
    }
    
    // Reset and start trip duration timer
    driverElapsedTime = 0;
    document.getElementById('drv-lbl-timer').textContent = "00:00";
    if (driverTimerIntervalId) clearInterval(driverTimerIntervalId);
    driverTimerIntervalId = setInterval(() => {
        driverElapsedTime++;
        const mins = String(Math.floor(driverElapsedTime / 60)).padStart(2, '0');
        const secs = String(driverElapsedTime % 60).padStart(2, '0');
        document.getElementById('drv-lbl-timer').textContent = `${mins}:${secs}`;
    }, 1000);
    
    // Clear static loop and start active GPS/Simulation transmission loop
    if (driverSimIntervalId) clearInterval(driverSimIntervalId);
    if (driverGpsWatchId) navigator.geolocation.clearWatch(driverGpsWatchId);
    
    if (useSim) {
        const points = GEOGRAPHIC_ROUTES[route] || GEOGRAPHIC_ROUTES['EG x Sambodromo'];
        let idx = 0;
        
        driverSimIntervalId = setInterval(() => {
            const coords = points[idx];
            const speed = idx === points.length - 1 ? 0 : Math.floor(Math.random() * 25) + 45; // 0 if reached, else 45-70km/h
            sendDriverGpsPing(name, vehicle, service, route, coords, speed);
            
            if (idx < points.length - 1) {
                idx++;
            }
        }, 3000);
        
        // Immediate ping
        sendDriverGpsPing(name, vehicle, service, route, points[0], 50);
    } else {
        driverGpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                const coords = [pos.coords.latitude, pos.coords.longitude];
                const speed = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 48; // speed in km/h
                sendDriverGpsPing(name, vehicle, service, route, coords, speed);
            },
            (err) => console.log("Active GPS watch error:", err),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
    
    showToast("Corrida Iniciada", "Viagem iniciada com sucesso.", "success");
}

function endDriverRide() {
    if (!isRideActive) return;
    
    const profileJson = safeStorage.local.getItem('conexao_driver_profile');
    if (!profileJson) return;
    const profile = JSON.parse(profileJson);
    
    const base = document.getElementById('drv-base').value;
    const direction = document.getElementById('drv-direction').value;
    const route = direction === 'GLOBO_SAIDA' ? `${base} x Sambodromo` : `Sambodromo x ${base}`;
    
    isRideActive = false;
    
    // Stop timers and active watch/intervals
    if (driverTimerIntervalId) {
        clearInterval(driverTimerIntervalId);
        driverTimerIntervalId = null;
    }
    if (driverSimIntervalId) {
        clearInterval(driverSimIntervalId);
        driverSimIntervalId = null;
    }
    if (driverGpsWatchId) {
        navigator.geolocation.clearWatch(driverGpsWatchId);
        driverGpsWatchId = null;
    }
    
    // Record ended timestamp and duration
    const endedTime = Date.now();
    const durationMs = endedTime - driverStartTime;
    
    // Save to completed trips log
    const completedTrips = JSON.parse(safeStorage.local.getItem('conexao_completed_trips') || '[]');
    completedTrips.unshift({
        driver: profile.nome,
        empresa: profile.empresa,
        vehicle: profile.placa_veiculo,
        service: profile.service, // group
        route: route,
        started_at: driverStartTime,
        ended_at: endedTime,
        duration_ms: durationMs
    });
    safeStorage.local.setItem('conexao_completed_trips', JSON.stringify(completedTrips));
    
    // Dispatch local sync event
    window.dispatchEvent(new Event('storage'));
    
    driverStartTime = null;
    
    // Unlock selects and GPS button
    const drvBase = document.getElementById('drv-base');
    if (drvBase) drvBase.removeAttribute('disabled');
    const drvDir = document.getElementById('drv-direction');
    if (drvDir) drvDir.removeAttribute('disabled');
    const btnGps = document.getElementById('btn-drv-gps');
    if (btnGps) {
        btnGps.removeAttribute('disabled');
        btnGps.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    // Update Ride status
    const statusRide = document.getElementById('drv-status-ride');
    if (statusRide) {
        statusRide.textContent = "FORA DE OPERA�!ÒO";
        statusRide.className = "text-[10px] text-gray-500 block uppercase font-bold";
    }
    
    // Enable Start button
    const btnStart = document.getElementById('btn-drv-start-ride');
    if (btnStart) {
        btnStart.removeAttribute('disabled');
        btnStart.className = "bg-blue-650 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 flex items-center justify-center gap-1.5 cursor-pointer";
    }
    
    // Disable End button
    const btnEnd = document.getElementById('btn-drv-end-ride');
    if (btnEnd) {
        btnEnd.setAttribute('disabled', 'true');
        btnEnd.className = "bg-red-650 disabled:bg-gray-900/50 hover:bg-red-500 text-white disabled:text-gray-600 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition duration-200 disabled:border disabled:border-gray-800 disabled:shadow-none flex items-center justify-center gap-1.5 cursor-not-allowed";
    }
    
    // Restart static GPS loop (keep GPS connected at 0 km/h)
    const name = profile.nome;
    const vehicle = profile.placa_veiculo;
    const service = profile.service;
    const useSim = document.getElementById('drv-use-sim').checked;
    const startCoords = getDriverStartingCoords(base, direction);
    
    sendDriverGpsPing(name, vehicle, service, route, startCoords, 0);
    
    if (useSim) {
        driverSimIntervalId = setInterval(() => {
            if (!isRideActive) {
                sendDriverGpsPing(name, vehicle, service, route, startCoords, 0);
            }
        }, 3000);
    } else {
        driverGpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!isRideActive) {
                    const coords = [pos.coords.latitude, pos.coords.longitude];
                    sendDriverGpsPing(name, vehicle, service, route, coords, 0);
                }
            },
            (err) => console.log("Static GPS watch error:", err),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
    
    showToast("Corrida Concluída", "Viagem finalizada com sucesso.", "success");
}

// Compatibility wrapper function
function startDriverGpsShare() {
    toggleDriverGpsConnection();
}
function stopDriverGpsShare(remotely = false) {
    stopDriverGpsSharing(remotely);
}

// Transmission of location data to LocalStorage
function sendDriverGpsPing(name, vehicle, service, route, coords, speed) {
    const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
    const existing = trackers[name] || {};
    
    // Check remote kill safety command
    if (existing.remote_kill === true) {
        stopDriverGpsShare(true);
        return;
    }
    
    // Check incoming remote commands from CCO
    if (existing.latest_command && existing.command_timestamp > (existing.handled_timestamp || 0)) {
        const alertBox = document.getElementById('driver-alert-box');
        const alertText = document.getElementById('driver-alert-text');
        const replyContainer = document.getElementById('driver-reply-container');
        
        if (alertBox && alertText && replyContainer) {
            alertText.textContent = existing.latest_command;
            alertBox.classList.remove('hidden');
            
            // Build quick reply buttons
            replyContainer.innerHTML = '';
            let replies = ["Sim", "Não", "A caminho", "Atraso ~10m", "Sem ocorrências"];
            if (existing.latest_command.includes("ocorrência")) {
                replies = ["Sim", "Não", "Sem ocorrências", "Problema mecânico", "Pane / Acidente"];
            } else if (existing.latest_command.includes("atrasar") || existing.latest_command.includes("atraso") || existing.latest_command.includes("caminho")) {
                replies = ["Sim", "Não", "A caminho", "Sem atraso", "Atraso ~10m"];
            } else if (existing.latest_command.includes("posição") || existing.latest_command.includes("rastreamento")) {
                replies = ["Compartilhando!", "GPS ativo", "Sinal fraco", "OK"];
            }
            
            replies.forEach(r => {
                const btn = document.createElement('button');
                btn.className = "bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white font-bold py-1.5 px-2 rounded-lg text-[10px] border border-amber-500/30 transition duration-200";
                btn.textContent = r;
                btn.onclick = () => sendDriverResponse(r);
                replyContainer.appendChild(btn);
            });
            
            // Audible Beep notification
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = audioCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
                osc.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.15);
            } catch (e) {
                console.log("Audio contexts not supported/allowed yet");
            }
            
            existing.handled_timestamp = Date.now();
        }
    }
    
    // Save state
    const activeProfileJson = safeStorage.local.getItem('conexao_driver_profile');
    let company = 'Simulado CCO';
    let phone = '(21) 99999-9999';
    let vehicleType = 'Van Executiva';
    let plate = vehicle;
    
    if (activeProfileJson) {
        try {
            const p = JSON.parse(activeProfileJson);
            if (p.nome === name) {
                company = p.empresa;
                phone = p.telefone;
                vehicleType = p.tipo_veiculo;
                plate = p.placa_veiculo;
            }
        } catch(e) {}
    } else {
        // Buscar nos motoristas cadastrados se for bot simulador
        if (db && db.drivers) {
            const dbDriver = db.drivers.find(d => d.nome === name);
            if (dbDriver) {
                company = dbDriver.empresa || 'Simulado CCO';
                phone = dbDriver.telefone || '(21) 99999-9999';
                vehicleType = dbDriver.tipo_veiculo || 'Van Executiva';
                plate = dbDriver.placa_veiculo || vehicle;
            }
        }
    }

    trackers[name] = {
        name,
        company,
        phone,
        vehicleType,
        vehicle: plate,
        service,
        route,
        lat: coords[0],
        lng: coords[1],
        speed,
        timestamp: Date.now(),
        remote_kill: false,
        latest_command: existing.latest_command || '',
        command_timestamp: existing.command_timestamp || 0,
        handled_timestamp: existing.handled_timestamp || 0,
        reply: existing.reply || ''
    };
    
    safeStorage.local.setItem('conexao_active_trackers', JSON.stringify(trackers));
    
    // Update local driver UI
    document.getElementById('drv-lbl-coords').textContent = `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)} (${speed} km/h)`;
}

// Send quick response
function sendDriverResponse(replyText) {
    if (!currentActiveDriver) return;
    
    const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
    if (trackers[currentActiveDriver]) {
        trackers[currentActiveDriver].reply = replyText;
        trackers[currentActiveDriver].latest_command = ''; // clear processed command
        safeStorage.local.setItem('conexao_active_trackers', JSON.stringify(trackers));
    }
    
    document.getElementById('driver-alert-box').classList.add('hidden');
    showToast("Resposta Enviada", `Mensagem "${replyText}" enviada ao CCO.`, "success");
}

// Initialize Leaflet Map
function initTrackingMap() {
    const mapDiv = document.getElementById('tracking-map');
    if (!mapDiv) return;
    
    if (typeof L === 'undefined') {
        console.error("Leaflet.js is not loaded.");
        mapDiv.innerHTML = '<div class="flex items-center justify-center h-full text-red-500 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation mr-1.5"></i>Biblioteca do Mapa indisponível (offline)</div>';
        return;
    }
    
    // Avoid double instantiation
    if (trackingMap) {
        trackingMap.invalidateSize();
        updateLiveMapMarkers();
        return;
    }
    
    // Create Leaflet map object
    trackingMap = L.map('tracking-map', {
        zoomControl: true,
        attributionControl: false
    }).setView([-22.95, -43.30], 11); // Center of Rio routes
    
    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18
    }).addTo(trackingMap);
    
    // Draw static Bases markers
    const baseIcons = {
        EG: L.divIcon({
            className: 'base-marker-icon',
            html: `<div class="bg-blue-600 border border-white text-white font-bold text-[9px] rounded-lg px-1.5 py-0.5 shadow-lg flex items-center gap-1 whitespace-nowrap">
                       <i class="fa-solid fa-hotel text-[8px]"></i> Base EG
                   </div>`,
            iconSize: [60, 20],
            iconAnchor: [30, 10]
        }),
        JB: L.divIcon({
            className: 'base-marker-icon',
            html: `<div class="bg-blue-600 border border-white text-white font-bold text-[9px] rounded-lg px-1.5 py-0.5 shadow-lg flex items-center gap-1 whitespace-nowrap">
                       <i class="fa-solid fa-tree text-[8px]"></i> Base JB
                   </div>`,
            iconSize: [60, 20],
            iconAnchor: [30, 10]
        }),
        ION: L.divIcon({
            className: 'base-marker-icon',
            html: `<div class="bg-blue-600 border border-white text-white font-bold text-[9px] rounded-lg px-1.5 py-0.5 shadow-lg flex items-center gap-1 whitespace-nowrap">
                       <i class="fa-solid fa-building text-[8px]"></i> Base Íon
                   </div>`,
            iconSize: [65, 20],
            iconAnchor: [32, 10]
        }),
        Sambodromo: L.divIcon({
            className: 'base-marker-icon',
            html: `<div class="bg-amber-600 border border-white text-white font-bold text-[9px] rounded-lg px-1.5 py-0.5 shadow-lg flex items-center gap-1 whitespace-nowrap animate-pulse">
                       <i class="fa-solid fa-guitar text-[8px]"></i> Evento
                   </div>`,
            iconSize: [60, 20],
            iconAnchor: [30, 10]
        })
    };
    
    L.marker(BASE_COORDINATES.EG, { icon: baseIcons.EG }).addTo(trackingMap).bindPopup("<b>Estúdios Globo (Jacarepaguá)</b><br>Base Principal de Vans");
    L.marker(BASE_COORDINATES.JB, { icon: baseIcons.JB }).addTo(trackingMap).bindPopup("<b>Jardim Botânico</b><br>Base Zona Sul");
    L.marker(BASE_COORDINATES.ION, { icon: baseIcons.ION }).addTo(trackingMap).bindPopup("<b>Íon Barra (Barra da Tijuca)</b><br>Base Barra/Recreio");
    L.marker(BASE_COORDINATES.Sambodromo, { icon: baseIcons.Sambodromo }).addTo(trackingMap).bindPopup("<b>Sambódromo</b><br>Destino de desembarque");
    
    // Draw Routes Polylines
    mapPolylines.EG = L.polyline(GEOGRAPHIC_ROUTES['EG x Sambodromo'], { color: '#ef4444', weight: 3, opacity: 0.6 }).addTo(trackingMap);
    mapPolylines.JB = L.polyline(GEOGRAPHIC_ROUTES['JB x Sambodromo'], { color: '#3b82f6', weight: 3, opacity: 0.6 }).addTo(trackingMap);
    mapPolylines.ION = L.polyline(GEOGRAPHIC_ROUTES['ION x Sambodromo'], { color: '#10b981', weight: 3, opacity: 0.6 }).addTo(trackingMap);
    
    updateLiveMapMarkers();
}

// Calculate geographical distance using Haversine formula (in km)
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Função para verificar se a escala está ativa com base no horário atual do sistema
function getDriverMapStatus(driver, now) {
    if (!driver.start_time || !driver.end_time) return 'ACTIVE';
    try {
        const parseDate = (str) => {
            if (!str) return null;
            const parts = str.split(' ');
            if (parts.length < 2) return null;
            const dParts = parts[0].split('/');
            const tParts = parts[1].split(':');
            return new Date(
                parseInt(dParts[2]),
                parseInt(dParts[1]) - 1,
                parseInt(dParts[0]),
                parseInt(tParts[0]),
                parseInt(tParts[1] || '0')
            );
        };
        const start = parseDate(driver.start_time);
        const end = parseDate(driver.end_time);
        if (start && end) {
            return (now >= start && now <= end) ? 'ACTIVE' : 'INACTIVE';
        }
    } catch(e) {}
    return 'ACTIVE';
}

// Update Active Fleet Vehicles on Leaflet Map
function updateLiveMapMarkers() {
    const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
    const listContainer = document.getElementById('active-trackers-list');
    const countBadge = document.getElementById('active-tracking-count');
    const groupFilter = document.getElementById('map-group-filter') ? document.getElementById('map-group-filter').value : 'ALL';
    const statusFilter = document.getElementById('map-status-filter') ? document.getElementById('map-status-filter').value : 'ALL';
    
    const now = new Date();
    
    // Rastrear quais chaves de marcadores deverão permanecer ativas no mapa
    const activeMarkerKeys = new Set();
    
    // 1. Filtrar e exibir os Veículos Ativos (transmitindo GPS)
    const filteredTrackers = {};
    Object.keys(trackers).forEach(name => {
        const tracker = trackers[name];
        
        // Mapear grupo
        let mappedGroup = 'Outros atendimentos';
        const svc = String(tracker.service || '').toLowerCase();
        if (svc.includes('vai e vem') || svc.includes('van')) {
            mappedGroup = 'Vai e Vem';
        } else if (svc.includes('produção') || svc.includes('producao')) {
            mappedGroup = 'Carros de producao';
        } else if (svc.includes('executivo') || svc.includes('exec')) {
            mappedGroup = 'Veiculos Executivos';
        } else {
            mappedGroup = 'Outros atendimentos';
        }
        
        // Se houver dados da escala para esse motorista, checar tempo real
        let driverStatus = 'ACTIVE';
        if (db.drivers_map) {
            const dScale = db.drivers_map.find(d => d.nome === name);
            if (dScale) {
                driverStatus = getDriverMapStatus(dScale, now);
            }
        }
        
        const matchesGroup = (groupFilter === 'ALL' || groupFilter === mappedGroup);
        const matchesStatus = (statusFilter === 'ALL' || statusFilter === driverStatus);
        
        if (matchesGroup && matchesStatus) {
            filteredTrackers[name] = tracker;
        }
    });

    const activeCount = Object.keys(filteredTrackers).length;
    if (countBadge) countBadge.textContent = `${activeCount} ATIVOS`;
    
    // Renderizar lista na barra lateral esquerda
    if (listContainer) {
        if (activeCount === 0) {
            listContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500 text-xs">
                    <i class="fa-solid fa-satellite-dish text-2xl mb-2 text-gray-600 block animate-pulse"></i>
                    Nenhum veículo transmitindo no momento.
                </div>`;
        } else {
            listContainer.innerHTML = '';
        }
    }
    
    // Renderizar veículos ativos no Leaflet
    Object.values(filteredTrackers).forEach(tracker => {
        const destCoords = tracker.route.includes(getEventLocationName()) ? BASE_COORDINATES.Sambodromo : (tracker.route.includes('EG') ? BASE_COORDINATES.EG : (tracker.route.includes('JB') ? BASE_COORDINATES.JB : BASE_COORDINATES.ION));
        const distanceRemaining = calculateHaversineDistance(tracker.lat, tracker.lng, destCoords[0], destCoords[1]);
        const speed = tracker.speed || 45;
        const etaMin = distanceRemaining === 0 ? 0 : Math.round((distanceRemaining / speed) * 60);
        
        // Renderizar item lateral
        if (listContainer) {
            const card = document.createElement('div');
            card.className = "bg-gray-900/60 border border-gray-800 rounded-xl p-3 text-xs space-y-2 relative overflow-hidden";
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <div>
                        <strong class="text-white font-bold block truncate">${tracker.name}</strong>
                        <span class="text-[9px] text-gray-500 uppercase font-mono font-bold">${tracker.vehicle} | ${tracker.service}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-[9px] bg-emerald-500/10 text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-500/20">${tracker.speed} KM/H</span>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-1 text-[10px] text-gray-300 bg-gray-950/40 p-2 rounded-lg">
                    <div><span class="text-gray-500 font-medium">Rota:</span> ${tracker.route}</div>
                    <div class="text-right"><span class="text-gray-500 font-medium">ETA:</span> <strong class="text-amber-400">${etaMin} min</strong></div>
                </div>
                
                ${tracker.reply ? `
                <div class="text-[10px] text-emerald-300 bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20 font-medium">
                    <i class="fa-solid fa-comment mr-1"></i> Resposta: "${tracker.reply}"
                </div>` : ''}

                <div class="flex gap-2 pt-1">
                    <div class="relative flex-grow">
                        <button onclick="toggleTrackerCmdMenu('${tracker.name}')" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-1.5 px-2 rounded-lg text-[10px] font-bold border border-gray-700 flex items-center justify-between">
                            <span><i class="fa-solid fa-paper-plane mr-1.5 text-blue-400"></i>Enviar Mensagem</span>
                            <i class="fa-solid fa-chevron-down text-[8px]"></i>
                        </button>
                        <div id="cmd-menu-${tracker.name.replace(/\s+/g, '')}" class="hidden absolute left-0 bottom-full mb-1 w-full bg-gray-900 border border-gray-800 rounded-lg shadow-xl overflow-hidden z-20">
                            <button onclick="sendCcoMessageToDriver('${tracker.name}', 'Compartilhe sua posição')" class="w-full text-left px-3 py-1.5 hover:bg-gray-800 text-[10px] text-gray-300 border-b border-gray-800 font-medium">
                                �x� Compartilhe posição
                            </button>
                            <button onclick="sendCcoMessageToDriver('${tracker.name}', 'Encerre o compartilhamento')" class="w-full text-left px-3 py-1.5 hover:bg-gray-800 text-[10px] text-gray-300 border-b border-gray-800 font-medium">
                                �x: Encerre compartilhamento
                            </button>
                            <button onclick="sendCcoMessageToDriver('${tracker.name}', 'Vai atrasar?')" class="w-full text-left px-3 py-1.5 hover:bg-gray-800 text-[10px] text-gray-300 border-b border-gray-800 font-medium">
                                ⏰ Vai atrasar?
                            </button>
                            <button onclick="sendCcoMessageToDriver('${tracker.name}', 'Está a caminho?')" class="w-full text-left px-3 py-1.5 hover:bg-gray-800 text-[10px] text-gray-300 border-b border-gray-800 font-medium">
                                �xa� Está a caminho?
                            </button>
                            <button onclick="sendCcoMessageToDriver('${tracker.name}', 'Informe se há alguma ocorrência')" class="w-full text-left px-3 py-1.5 hover:bg-gray-800 text-[10px] text-gray-300 font-medium">
                                �a�️ Há alguma ocorrência?
                            </button>
                        </div>
                    </div>
                    
                    <button onclick="killDriverTrackingRemotely('${tracker.name}')" title="Encerrar compartilhamento" class="bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white px-2.5 rounded-lg border border-red-500/30 flex items-center justify-center transition duration-200">
                        <i class="fa-solid fa-power-off"></i>
                    </button>
                </div>
            `;
            listContainer.appendChild(card);
        }
        
        // Desenhar marcador no mapa
        if (trackingMap) {
            const popupHtml = `
                <div class="text-xs space-y-1.5 font-sans text-gray-900 p-1 min-w-[210px]">
                    <div class="bg-indigo-50 p-2 rounded-lg mb-1">
                        <strong class="font-bold block text-indigo-900 text-sm"><i class="fa-solid fa-user-tie mr-1 text-indigo-600"></i>${tracker.name}</strong>
                        <span class="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded uppercase mt-0.5 inline-block">${tracker.service || 'Vai e Vem'}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-gray-700">
                        <div><b>Prestador:</b></div><div class="text-right text-gray-900 font-medium truncate max-w-[120px]">${tracker.company || 'Simulado CCO'}</div>
                        <div><b>Telefone:</b></div><div class="text-right text-gray-900 font-medium">${tracker.phone || '(21) 99999-9999'}</div>
                        <div><b>Tipo de veículo:</b></div><div class="text-right text-gray-900 font-medium truncate max-w-[120px]">${tracker.vehicleType || 'Van Executiva'}</div>
                        <div><b>Placa do veículo:</b></div><div class="text-right text-gray-900 font-mono font-bold">${tracker.vehicle || 'AAA-0000'}</div>
                        <div><b>Programa:</b></div><div class="text-right text-indigo-650 font-bold">${tracker.service || 'Vai e Vem'}</div>
                    </div>
                    <hr class="my-1.5 border-gray-200">
                    <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-gray-600 bg-gray-50 p-1.5 rounded">
                        <div><b>Rota Atual:</b></div><div class="text-right font-medium truncate max-w-[120px]">${tracker.route}</div>
                        <div><b>Velocidade:</b></div><div class="text-right font-bold text-gray-900">${tracker.speed} km/h</div>
                        <div><b>ETA Restante:</b></div><div class="text-right font-bold text-amber-600">${etaMin} min</div>
                    </div>
                    ${tracker.reply ? `<div class="mt-1 bg-emerald-50 text-emerald-700 p-1.5 rounded font-medium border border-emerald-100">�x� ${tracker.reply}</div>` : ''}
                </div>`;
            
            activeMarkerKeys.add(tracker.name);
            
            if (mapMarkers[tracker.name]) {
                mapMarkers[tracker.name].setLatLng([tracker.lat, tracker.lng]);
                mapMarkers[tracker.name].getPopup().setContent(popupHtml);
            } else {
                let colorClass = 'bg-emerald-500 shadow-emerald-500/30';
                const sLower = String(tracker.service).toLowerCase();
                if (sLower.includes('vai e vem')) {
                    colorClass = 'bg-emerald-500 shadow-emerald-500/30';
                } else if (sLower.includes('produção') || sLower.includes('producao')) {
                    colorClass = 'bg-purple-500 shadow-purple-500/30';
                } else if (sLower.includes('executivo')) {
                    colorClass = 'bg-amber-500 shadow-amber-500/30';
                } else {
                    colorClass = 'bg-blue-500 shadow-blue-500/30';
                }

                const vehicleIcon = L.divIcon({
                    className: 'custom-vehicle-div-icon',
                    html: `<div class="flex flex-col items-center">
                               <div class="${colorClass} text-white p-1 rounded-full shadow-lg border border-white flex items-center justify-center animate-bounce">
                                   <i class="fa-solid fa-truck-moving text-[9px]"></i>
                                </div>
                               <span class="bg-gray-900/90 text-white text-[7px] font-bold px-1 rounded border border-gray-800 mt-0.5 whitespace-nowrap truncate max-w-[50px]">${tracker.name.split(' ')[0]}</span>
                           </div>`,
                    iconSize: [40, 35],
                    iconAnchor: [20, 25]
                });
                
                mapMarkers[tracker.name] = L.marker([tracker.lat, tracker.lng], { icon: vehicleIcon })
                    .addTo(trackingMap)
                    .bindPopup(popupHtml);
            }
        }
    });

    // 2. Plotar os marcadores de Ponto de Início (origens) da escala db.drivers_map
    if (db.drivers_map && trackingMap) {
        db.drivers_map.forEach(d => {
            if (!d.lat || !d.lng) return;
            
            // Checar filtros
            const driverStatus = getDriverMapStatus(d, now);
            const matchesGroup = (groupFilter === 'ALL' || groupFilter === d.service);
            const matchesStatus = (statusFilter === 'ALL' || statusFilter === driverStatus);
            
            if (!matchesGroup || !matchesStatus) return;
            
            const startKey = 'start_' + d.nome;
            activeMarkerKeys.add(startKey);
            
            const isDriverOnline = !!trackers[d.nome];
            const startPopupHtml = `
                <div class="text-xs space-y-1.5 font-sans text-gray-900 p-1 min-w-[220px]">
                    <div class="bg-blue-50 p-2 rounded-lg mb-1">
                        <strong class="font-bold block text-indigo-900 text-sm"><i class="fa-solid fa-flag mr-1 text-blue-600"></i>Saída: ${d.origin}</strong>
                        <span class="text-[8px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded uppercase mt-0.5 inline-block">Ponto de Origem da Escala</span>
                    </div>
                    <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-gray-700">
                        <div><b>Motorista:</b></div><div class="text-right text-gray-900 font-bold">${d.nome}</div>
                        <div><b>Celular:</b></div><div class="text-right text-gray-900 font-medium">${d.telefone || '(21) 99999-9999'}</div>
                        <div><b>Prestador:</b></div><div class="text-right text-gray-900 font-medium truncate max-w-[120px]">${d.empresa}</div>
                        <div><b>Placa:</b></div><div class="text-right text-gray-900 font-mono font-bold">${d.placa_veiculo}</div>
                        <div><b>Previsão Início:</b></div><div class="text-right font-medium text-gray-900">${d.start_time || '-'}</div>
                        <div><b>Previsão Fim:</b></div><div class="text-right font-medium text-gray-900">${d.end_time || '-'}</div>
                        <div><b>Status Sinal:</b></div><div class="text-right font-bold ${isDriverOnline ? 'text-emerald-600' : 'text-red-500'}">${isDriverOnline ? 'ONLINE' : 'OFFLINE'}</div>
                    </div>
                    <hr class="my-1.5 border-gray-200">
                    <div class="space-y-1">
                        <button onclick="copyDriverLinkFromMap('${d.nome.replace(/'/g, "\\'")}', '${d.cpf}')" class="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-1 rounded text-[10px] font-bold border border-indigo-200 transition duration-150 flex items-center justify-center gap-1 cursor-pointer">
                            <i class="fa-solid fa-copy text-[9px]"></i> Copiar Link WhatsApp
                        </button>
                        <button onclick="requestPositionByWhatsapp('${d.nome.replace(/'/g, "\\'")}', '${d.telefone}', '${d.cpf}')" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-1 rounded text-[10px] font-bold transition duration-150 flex items-center justify-center gap-1 cursor-pointer">
                            <i class="fa-brands fa-whatsapp text-[10px]"></i> Solicitar Posição (WhatsApp)
                        </button>
                        ${isDriverOnline ? `
                        <button onclick="sendCcoMessageToDriver('${d.nome.replace(/'/g, "\\'")}', 'Compartilhe sua posição')" class="w-full bg-amber-500 hover:bg-amber-400 text-white py-1 rounded text-[10px] font-bold transition duration-150 flex items-center justify-center gap-1 cursor-pointer">
                            <i class="fa-solid fa-bell"></i> Enviar Alerta CCO (In-App)
                        </button>` : ''}
                    </div>
                </div>`;
                
            if (mapMarkers[startKey]) {
                mapMarkers[startKey].setLatLng([d.lat, d.lng]);
                mapMarkers[startKey].getPopup().setContent(startPopupHtml);
            } else {
                const startIcon = L.divIcon({
                    className: 'custom-start-div-icon',
                    html: `<div class="flex flex-col items-center">
                               <div class="bg-blue-600 text-white p-1 rounded-full shadow-lg border border-white flex items-center justify-center">
                                   <i class="fa-solid fa-map-pin text-[9px]"></i>
                               </div>
                               <span class="bg-indigo-950 text-white text-[7px] font-bold px-1 rounded border border-indigo-800 mt-0.5 whitespace-nowrap truncate max-w-[60px]">${d.nome.split(' ')[0]}</span>
                           </div>`,
                    iconSize: [40, 35],
                    iconAnchor: [20, 25]
                });
                
                mapMarkers[startKey] = L.marker([d.lat, d.lng], { icon: startIcon })
                    .addTo(trackingMap)
                    .bindPopup(startPopupHtml);
            }
        });
    }
    
    // 3. Remover marcadores antigos que não passaram nas regras atuais ou estão fora dos filtros
    Object.keys(mapMarkers).forEach(key => {
        if (!activeMarkerKeys.has(key)) {
            if (trackingMap) trackingMap.removeLayer(mapMarkers[key]);
            delete mapMarkers[key];
        }
    });
}

// Toggle command dropdown in trackers CCO list
function toggleTrackerCmdMenu(driverName) {
    const id = `cmd-menu-${driverName.replace(/\s+/g, '')}`;
    const el = document.getElementById(id);
    if (!el) return;
    
    // Hide all menus first
    document.querySelectorAll('[id^="cmd-menu-"]').forEach(menu => {
        if (menu.id !== id) menu.classList.add('hidden');
    });
    
    el.classList.toggle('hidden');
}

// Send remote command from CCO
function sendCcoMessageToDriver(driverName, messageStr) {
    const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
    if (trackers[driverName]) {
        trackers[driverName].latest_command = messageStr;
        trackers[driverName].command_timestamp = Date.now();
        trackers[driverName].reply = ''; // reset previous reply
        safeStorage.local.setItem('conexao_active_trackers', JSON.stringify(trackers));
        
        // Hide menu
        const menuId = `cmd-menu-${driverName.replace(/\s+/g, '')}`;
        const menu = document.getElementById(menuId);
        if (menu) menu.classList.add('hidden');
        
        showToast("Mensagem Enviada", `Comando enviado para o motorista ${driverName}.`, "success");
        updateLiveMapMarkers();
    }
}

// Remote shutoff from CCO
function killDriverTrackingRemotely(driverName) {
    if (confirm(`Deseja realmente interromper o compartilhamento de GPS de ${driverName} remotamente?`)) {
        const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
        if (trackers[driverName]) {
            trackers[driverName].remote_kill = true; // flag to stop on next ping
            safeStorage.local.setItem('conexao_active_trackers', JSON.stringify(trackers));
        }
        
        // Remove locally from CCO immediately
        if (mapMarkers[driverName] && trackingMap) {
            trackingMap.removeLayer(mapMarkers[driverName]);
            delete mapMarkers[driverName];
        }
        
        showToast("Comando de Parada", `Sinal de desligamento remoto enviado para ${driverName}.`, "warning");
        updateLiveMapMarkers();
    }
}

// Cross-tab synchronization via LocalStorage storage event
window.addEventListener('storage', (e) => {
    if (e.key === 'conexao_active_trackers') {
        if (currentTab === 'management' && currentSubTab === 'tracking') {
            updateLiveMapMarkers();
        }
        
        // If we are currently logged in as a driver, check if we were remotely killed
        if (currentActiveDriver) {
            const trackers = JSON.parse(e.newValue || '{}');
            const selfTracker = trackers[currentActiveDriver];
            if (!selfTracker || selfTracker.remote_kill === true) {
                stopDriverGpsShare(true);
            } else if (selfTracker.latest_command && selfTracker.command_timestamp > (selfTracker.handled_timestamp || 0)) {
                // Trigger localized UI update to fetch the new CCO command
                sendDriverGpsPing(selfTracker.name, selfTracker.vehicle, selfTracker.service, selfTracker.route, [selfTracker.lat, selfTracker.lng], selfTracker.speed);
            }
        }
    } else if (e.key === 'conexao_completed_trips') {
        updateCompletedTripsList();
    }
});

// Close command dropdowns if clicked outside
window.addEventListener('click', (e) => {
    if (!e.target.closest('.relative')) {
        document.querySelectorAll('[id^="cmd-menu-"]').forEach(menu => {
            menu.classList.add('hidden');
        });
        const autocomp = document.getElementById('drv-autocomplete-list');
        if (autocomp) autocomp.classList.add('hidden');
    }
});

// CPF Verification logic for Driver Portal
function verifyDriverCpf() {
    const cpfInput = document.getElementById('drv-cpf-input');
    if (!cpfInput) return;
    
    // Clean CPF input to numbers only
    const rawCpf = cpfInput.value.trim();
    const cleanCpf = rawCpf.replace(/\D/g, '');
    
    if (!cleanCpf) {
        alert("Por favor, digite seu CPF.");
        return;
    }
    
    // Ensure database drivers is populated from backend if needed
    if (!db || !db.drivers) {
        db.drivers = [];
    }
    
    // Find driver in database
    const searchSource = (db.drivers_map && db.drivers_map.length > 0) ? db.drivers_map : (db.drivers || []);
    let driver = searchSource.find(d => {
        const dbCpf = String(d.cpf || '').replace(/\D/g, '');
        return dbCpf === cleanCpf;
    });
    
    if (!driver) {
        // Busca na base geral de colaboradores/terceiros
        const person = findPerson(cleanCpf);
        if (person) {
            driver = {
                nome: person.nome,
                cpf: person.cpf,
                empresa: person.empresa || (person.tipo_vinculo === 'GLOBO' ? 'Globo' : 'Terceiro'),
                tipo_contratacao: person.cargo || "Motorista",
                telefone: person.telefone || "",
                placa_veiculo: "",
                tipo_veiculo: "",
                service: "Vai e Vem"
            };
        }
    }
    
    if (!driver) {
        alert("CPF não cadastrado na base de motoristas ou terceiros autorizados. Por favor, verifique os números.");
        return;
    }
    
    // Fill confirmation panel
    document.getElementById('drv-confirm-lbl-name').textContent = driver.nome;
    document.getElementById('drv-confirm-lbl-cpf').textContent = rawCpf;
    document.getElementById('drv-confirm-company').value = driver.empresa || "";
    document.getElementById('drv-confirm-lbl-function').textContent = driver.tipo_contratacao || "Motorista";
    
    document.getElementById('drv-confirm-phone').value = driver.telefone || "";
    document.getElementById('drv-confirm-plate').value = driver.placa_veiculo || "";
    document.getElementById('drv-confirm-vehicle-type').value = driver.tipo_veiculo || "";
    
    // Preset service group based on type
    const srvSelect = document.getElementById('drv-confirm-service');
    if (srvSelect) {
        if (driver.tipo_veiculo && (driver.tipo_veiculo.toUpperCase().includes('VAN') || driver.tipo_veiculo.toUpperCase().includes('MASTER'))) {
            srvSelect.value = 'Vai e Vem';
        } else if (driver.tipo_veiculo && driver.tipo_veiculo.toUpperCase().includes('EXEC')) {
            srvSelect.value = 'Veiculos Executivos';
        } else {
            srvSelect.value = 'Vai e Vem';
        }
    }

    // Tratar escala e exibir card de confirmação de escala no login
    const scaleConfirmInfo = document.getElementById('drv-confirm-scale-info');
    if (driver.origin && driver.destination) {
        if (document.getElementById('drv-confirm-scale-origin')) document.getElementById('drv-confirm-scale-origin').textContent = driver.origin;
        if (document.getElementById('drv-confirm-scale-destination')) document.getElementById('drv-confirm-scale-destination').textContent = driver.destination;
        if (document.getElementById('drv-confirm-scale-start')) document.getElementById('drv-confirm-scale-start').textContent = driver.start_time || '-';
        if (document.getElementById('drv-confirm-scale-end')) document.getElementById('drv-confirm-scale-end').textContent = driver.end_time || '-';
        if (scaleConfirmInfo) scaleConfirmInfo.classList.remove('hidden');
    } else {
        if (scaleConfirmInfo) scaleConfirmInfo.classList.add('hidden');
    }
    
    // Toggle panels
    document.getElementById('driver-cpf-panel').classList.add('hidden');
    document.getElementById('driver-confirm-profile-panel').classList.remove('hidden');
}

function cancelDriverProfileConfirmation() {
    document.getElementById('driver-confirm-profile-panel').classList.add('hidden');
    document.getElementById('driver-cpf-panel').classList.remove('hidden');
}

function saveDriverProfileConfirmation() {
    const nome = document.getElementById('drv-confirm-lbl-name').textContent;
    const cpf = document.getElementById('drv-confirm-lbl-cpf').textContent.replace(/\D/g, '');
    const empresa = document.getElementById('drv-confirm-company').value.trim();
    const funcao = document.getElementById('drv-confirm-lbl-function').textContent;
    const telefone = document.getElementById('drv-confirm-phone').value.trim();
    const placa_veiculo = document.getElementById('drv-confirm-plate').value.trim().toUpperCase();
    const tipo_veiculo = document.getElementById('drv-confirm-vehicle-type').value.trim();
    const service = document.getElementById('drv-confirm-service').value;
    
    if (!empresa || !telefone || !placa_veiculo) {
        alert("Por favor, preencha a empresa, o celular e a placa do veículo.");
        return;
    }
    
    const profile = {
        nome,
        cpf,
        empresa,
        funcao,
        telefone,
        placa_veiculo,
        tipo_veiculo,
        service
    };
    
    // Tentar ler da escala no banco para recuperar origin, destination, start_time, end_time se existirem
    if (db.drivers_map) {
        let dMap = db.drivers_map.find(x => String(x.cpf) === String(cpf));
        if (!dMap) {
            const cleanName = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            dMap = db.drivers_map.find(x => {
                const xName = String(x.nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                return xName === cleanName || xName.includes(cleanName) || cleanName.includes(xName);
            });
        }
        if (dMap) {
            profile.origin = dMap.origin || '';
            profile.destination = dMap.destination || '';
            profile.start_time = dMap.start_time || '';
            profile.end_time = dMap.end_time || '';
        }
    }
    
    // Se não encontrou no db.drivers_map (porque ele logou por link e o profile temporário já tinha essas propriedades), vamos mantê-las se já estavam salvas ou passadas via URL!
    const tempProfileJson = safeStorage.local.getItem('conexao_driver_profile');
    if (tempProfileJson) {
        try {
            const tempProfile = JSON.parse(tempProfileJson);
            if (tempProfile.nome === nome) {
                profile.origin = profile.origin || tempProfile.origin || '';
                profile.destination = profile.destination || tempProfile.destination || '';
                profile.start_time = profile.start_time || tempProfile.start_time || '';
                profile.end_time = profile.end_time || tempProfile.end_time || '';
            }
        } catch(e) {}
    }
    
    // Save to LocalStorage
    safeStorage.local.setItem('conexao_driver_profile', JSON.stringify(profile));
    
    // Registrar sessão de segurança do motorista
    if (typeof registerUserSession === 'function') {
        registerUserSession('driver', profile.nome, profile.cpf);
    }
    
    // Load config UI
    loadDriverConfigFromProfile(profile);
    
    document.getElementById('driver-confirm-profile-panel').classList.add('hidden');
    document.getElementById('driver-config-form').classList.remove('hidden');
}

function loadDriverConfigFromProfile(profile) {
    document.getElementById('drv-config-lbl-name').textContent = profile.nome;
    document.getElementById('drv-config-lbl-meta').textContent = `${profile.empresa} | Placa: ${profile.placa_veiculo} | Cel: ${profile.telefone}`;
    
    // Configurar card da escala e exibição de seletores manuais
    const routeCard = document.getElementById('drv-scale-route-card');
    const routeConfigPanel = document.getElementById('drv-route-config-panel');
    
    if (profile.origin && profile.destination) {
        if (routeCard) {
            document.getElementById('drv-scale-origin').textContent = profile.origin;
            document.getElementById('drv-scale-destination').textContent = profile.destination;
            document.getElementById('drv-scale-start').textContent = profile.start_time || '-';
            document.getElementById('drv-scale-end').textContent = profile.end_time || '-';
            routeCard.classList.remove('hidden');
        }
        if (routeConfigPanel) {
            routeConfigPanel.classList.add('hidden');
        }
    } else {
        if (routeCard) {
            routeCard.classList.add('hidden');
        }
        if (routeConfigPanel) {
            routeConfigPanel.classList.remove('hidden');
        }
    }
}

function clearDriverProfile() {
    if (confirm("Deseja realmente desconectar e alterar o motorista?")) {
        safeStorage.local.removeItem('conexao_driver_profile');
        
        // Clean UI
        const cpfInput = document.getElementById('drv-cpf-input');
        if (cpfInput) cpfInput.value = '';
        const nameInput = document.getElementById('drv-name-autocomplete');
        if (nameInput) nameInput.value = '';
        
        const configForm = document.getElementById('driver-config-form');
        if (configForm) configForm.classList.add('hidden');
        
        const confirmPane = document.getElementById('driver-confirm-profile-panel');
        if (confirmPane) confirmPane.classList.add('hidden');
        
        // Stop current tracking if running
        stopDriverGpsSharing();
        
        const cpfPanel = document.getElementById('driver-cpf-panel');
        if (cpfPanel) cpfPanel.classList.remove('hidden');
    }
}

// Render Completed Trips List inside CCO Panel
function updateCompletedTripsList() {
    const listContainer = document.getElementById('completed-trips-list');
    if (!listContainer) return;
    
    const trips = JSON.parse(safeStorage.local.getItem('conexao_completed_trips') || '[]');
    if (trips.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-8 text-gray-500 text-xs">
                <i class="fa-solid fa-route text-xl text-gray-700 mb-1.5 block"></i>
                Nenhum registro de viagem concluída.
            </div>`;
        return;
    }
    
    let html = '';
    trips.forEach(trip => {
        const timeOut = new Date(trip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const timeIn = new Date(trip.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const durationMin = Math.round(trip.duration_ms / 60000);
        const durationText = durationMin <= 0 ? "menos de 1m" : `${durationMin} min`;
        
        let grpColor = 'text-emerald-400';
        if (trip.service === 'Vai e Vem Passeio') grpColor = 'text-blue-400';
        else if (trip.service === 'Passeio Produção') grpColor = 'text-purple-400';
        else if (trip.service === 'Passeio outros Produtos') grpColor = 'text-fuchsia-400';
        else if (trip.service === 'Executivo') grpColor = 'text-amber-400';

        html += `
        <div class="bg-gray-950/60 border border-gray-900 p-2.5 rounded-xl space-y-1">
            <div class="flex justify-between items-center text-white font-bold">
                <span class="truncate max-w-[120px] text-gray-200">${trip.driver}</span>
                <span class="text-[8px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 font-mono">${timeOut} �  ${timeIn}</span>
            </div>
            <div class="flex justify-between items-center text-gray-500 text-[8px]">
                <span>${trip.route} (${trip.vehicle})</span>
                <span class="text-gray-300 font-bold font-mono">${durationText}</span>
            </div>
            <div class="text-[8px] flex items-center justify-between text-gray-600 pt-0.5 border-t border-gray-900/60">
                <span>${trip.empresa}</span>
                <span class="${grpColor} font-bold">${trip.service}</span>
            </div>
        </div>`;
    });
    listContainer.innerHTML = html;
}

// Check URL Parameters to Force Isolating Driver Portal (Kiosk mode)
function checkUrlRoleParameter() {
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    
    if (roleParam === 'passenger') {
        const cpf = urlParams.get('cpf') || urlParams.get('matricula');
        if (cpf) {
            const cleanCpf = cpf.replace(/\D/g, '');
            passengerFixedCpf = cleanCpf;
            
            // Força a role do passageiro
            selectRole('passenger');
            
            // Prefill and disable inputs in HTML
            setTimeout(() => {
                const preInput = document.getElementById('pre-id');
                const passInput = document.getElementById('pass-id');
                if (preInput) {
                    preInput.value = cleanCpf;
                    preInput.readOnly = true;
                    preInput.style.pointerEvents = 'none';
                    preInput.style.opacity = '0.7';
                    // Dispara a busca automática no Pré-Agendamento
                    if (typeof lookupPreBookingCollaborator === 'function') {
                        lookupPreBookingCollaborator(cleanCpf);
                    }
                }
                if (passInput) {
                    passInput.value = cleanCpf;
                    passInput.readOnly = true;
                    passInput.style.pointerEvents = 'none';
                    passInput.style.opacity = '0.7';
                    // Dispara a busca automática no Totem
                    if (typeof lookupCollaborator === 'function') {
                        lookupCollaborator(cleanCpf);
                    }
                }
            }, 300);
        }
    } else if (roleParam === 'representative') {
        const area = urlParams.get('area') || urlParams.get('diretoria') || urlParams.get('departamento');
        if (area) {
            representativeFixedArea = decodeURIComponent(area);
            
            // Força a role de representante
            selectRole('representative');
            
            // Atualizar o título do perfil no topo
            setTimeout(() => {
                const activeProfileName = document.getElementById('active-profile-name');
                if (activeProfileName) {
                    activeProfileName.textContent = `Representante: ${representativeFixedArea}`;
                }
                // Recarregar a lista de colaboradores (já aplicando o filtro permanente)
                renderCollaboratorDatabaseTable();
            }, 300);
        }
    } else if (roleParam === 'driver') {
        selectRole('driver');
        
        // Hide global headers/navigation to make it a standalone mobile interface
        const mainHeader = document.querySelector('header');
        const tabsNav = document.getElementById('tabs-navigation');
        if (mainHeader) mainHeader.style.setProperty('display', 'none', 'important');
        if (tabsNav) tabsNav.style.setProperty('display', 'none', 'important');
        
        // Auto-login do motorista via link parametrizado do WhatsApp
        const name = urlParams.get('name');
        const cpf = urlParams.get('cpf');
        const company = urlParams.get('company');
        const phone = urlParams.get('phone');
        const vehicleType = urlParams.get('vehicleType');
        const plate = urlParams.get('plate');
        const service = urlParams.get('service');
        const origin = urlParams.get('origin');
        const destination = urlParams.get('destination');
        const startTime = urlParams.get('start_time');
        const endTime = urlParams.get('end_time');
        
        if (name && cpf) {
            const profile = {
                nome: decodeURIComponent(name),
                cpf: decodeURIComponent(cpf).replace(/\D/g, ''),
                empresa: company ? decodeURIComponent(company) : 'Prestador CCO',
                funcao: 'Motorista',
                telefone: phone ? decodeURIComponent(phone) : '(21) 99999-9999',
                placa_veiculo: plate ? decodeURIComponent(plate).toUpperCase() : 'AAA-0000',
                tipo_veiculo: vehicleType ? decodeURIComponent(vehicleType) : 'Van Executiva',
                service: service ? decodeURIComponent(service) : 'Vai e Vem',
                origin: origin ? decodeURIComponent(origin) : '',
                destination: destination ? decodeURIComponent(destination) : '',
                start_time: startTime ? decodeURIComponent(startTime) : '',
                end_time: endTime ? decodeURIComponent(endTime) : ''
            };
            
            // Persistir a sessão do motorista
            safeStorage.local.setItem('conexao_driver_profile', JSON.stringify(profile));
            
            // Pular direto para a tela de confirmação preenchida
            const cpfPanel = document.getElementById('driver-cpf-panel');
            const confirmPanel = document.getElementById('driver-confirm-profile-panel');
            if (cpfPanel) cpfPanel.classList.add('hidden');
            if (confirmPanel) confirmPanel.classList.remove('hidden');
            
            // Preencher labels do formulário de confirmação
            if (document.getElementById('drv-confirm-lbl-name')) document.getElementById('drv-confirm-lbl-name').textContent = profile.nome;
            if (document.getElementById('drv-confirm-lbl-cpf')) document.getElementById('drv-confirm-lbl-cpf').textContent = formatCpfString(profile.cpf);
            if (document.getElementById('drv-confirm-company')) document.getElementById('drv-confirm-company').value = profile.empresa;
            if (document.getElementById('drv-confirm-lbl-function')) document.getElementById('drv-confirm-lbl-function').textContent = profile.funcao;
            if (document.getElementById('drv-confirm-phone')) document.getElementById('drv-confirm-phone').value = profile.telefone;
            if (document.getElementById('drv-confirm-plate')) document.getElementById('drv-confirm-plate').value = profile.placa_veiculo;
            if (document.getElementById('drv-confirm-vehicle-type')) document.getElementById('drv-confirm-vehicle-type').value = profile.tipo_veiculo;
            if (document.getElementById('drv-confirm-service')) document.getElementById('drv-confirm-service').value = profile.service;
            
            // Pré-configurar a Rota e ocultar selects manuais no Portal do Motorista
            if (profile.origin && profile.destination) {
                const routeCard = document.getElementById('drv-scale-route-card');
                if (routeCard) {
                    document.getElementById('drv-scale-origin').textContent = profile.origin;
                    document.getElementById('drv-scale-destination').textContent = profile.destination;
                    document.getElementById('drv-scale-start').textContent = profile.start_time || '-';
                    document.getElementById('drv-scale-end').textContent = profile.end_time || '-';
                    routeCard.classList.remove('hidden');
                    
                    // Ocultar selects manuais de Base e Sentido e Switch de Simulação
                    const routeConfigPanel = document.getElementById('drv-route-config-panel');
                    if (routeConfigPanel) {
                        routeConfigPanel.classList.add('hidden');
                    }
                }
            }
        }
    }
}

// Name Autocomplete Search inside Driver Portal
function handleDriverNameAutocomplete(query) {
    const listContainer = document.getElementById('drv-autocomplete-list');
    if (!listContainer) return;
    
    const cleanQuery = query.trim().toLowerCase();
    if (cleanQuery.length < 2) {
        listContainer.innerHTML = '';
        listContainer.classList.add('hidden');
        return;
    }
    
    // Ensure database drivers is populated
    if (!db || !db.drivers) {
        db.drivers = [];
    }
    
    // Filter matches
    const searchSource = (db.drivers_map && db.drivers_map.length > 0) ? db.drivers_map : (db.drivers || []);
    const matches = searchSource.filter(d => {
        const dName = String(d.nome || '').toLowerCase();
        return dName.includes(cleanQuery);
    }).slice(0, 15); // limit to 15 suggestions for performance
    
    if (matches.length === 0) {
        listContainer.innerHTML = `
            <div class="px-3 py-2.5 text-gray-500 text-[10px] italic">
                Nenhum motorista localizado.
            </div>`;
        listContainer.classList.remove('hidden');
        return;
    }
    
    let html = '';
    matches.forEach(driver => {
        // Escape quotes for safe javascript string representation
        const escapedName = String(driver.nome).replace(/'/g, "\\'");
        const escapedCpf = String(driver.cpf || '').replace(/'/g, "\\'");
        const company = driver.empresa ? ` | ${driver.empresa}` : '';
        const vehicle = driver.tipo_veiculo ? ` (${driver.tipo_veiculo})` : '';
        
        html += `
        <button type="button" onclick="selectDriverFromAutocomplete('${escapedName}', '${escapedCpf}')" class="w-full text-left px-3.5 py-2.5 hover:bg-emerald-600/10 text-xs text-gray-200 hover:text-white transition duration-150 flex flex-col gap-0.5 border-b border-gray-900/40">
            <span class="font-bold text-white">${driver.nome}</span>
            <span class="text-[9px] text-gray-500 font-medium uppercase tracking-wider">${driver.tipo_contratacao || 'Motorista'}${company}${vehicle}</span>
        </button>`;
    });
    
    listContainer.innerHTML = html;
    listContainer.classList.remove('hidden');
}

// Select driver from autocomplete suggestions list
function selectDriverFromAutocomplete(nome, cpf) {
    // Find driver in database
    const searchSource = (db.drivers_map && db.drivers_map.length > 0) ? db.drivers_map : (db.drivers || []);
    const driver = searchSource.find(d => d.nome === nome && String(d.cpf || '') === String(cpf || ''));
    if (!driver) return;
    
    // Fill confirmation panel
    document.getElementById('drv-confirm-lbl-name').textContent = driver.nome;
    document.getElementById('drv-confirm-lbl-cpf').textContent = driver.cpf || "-";
    document.getElementById('drv-confirm-company').value = driver.empresa || "";
    document.getElementById('drv-confirm-lbl-function').textContent = driver.tipo_contratacao || "Motorista";
    
    document.getElementById('drv-confirm-phone').value = driver.telefone || "";
    document.getElementById('drv-confirm-plate').value = driver.placa_veiculo || "";
    document.getElementById('drv-confirm-vehicle-type').value = driver.tipo_veiculo || "";
    
    // Preset service group based on type
    const srvSelect = document.getElementById('drv-confirm-service');
    if (srvSelect) {
        if (driver.tipo_veiculo && (driver.tipo_veiculo.toUpperCase().includes('VAN') || driver.tipo_veiculo.toUpperCase().includes('MASTER'))) {
            srvSelect.value = 'Vai e Vem';
        } else if (driver.tipo_veiculo && driver.tipo_veiculo.toUpperCase().includes('EXEC')) {
            srvSelect.value = 'Veiculos Executivos';
        } else {
            srvSelect.value = 'Vai e Vem';
        }
    }
    
    // Clear autocomplete state
    document.getElementById('drv-name-autocomplete').value = '';
    document.getElementById('drv-autocomplete-list').classList.add('hidden');
    
    // Tratar escala e exibir card de confirmação de escala no login via autocomplete
    const scaleConfirmInfo = document.getElementById('drv-confirm-scale-info');
    if (driver.origin && driver.destination) {
        if (document.getElementById('drv-confirm-scale-origin')) document.getElementById('drv-confirm-scale-origin').textContent = driver.origin;
        if (document.getElementById('drv-confirm-scale-destination')) document.getElementById('drv-confirm-scale-destination').textContent = driver.destination;
        if (document.getElementById('drv-confirm-scale-start')) document.getElementById('drv-confirm-scale-start').textContent = driver.start_time || '-';
        if (document.getElementById('drv-confirm-scale-end')) document.getElementById('drv-confirm-scale-end').textContent = driver.end_time || '-';
        if (scaleConfirmInfo) scaleConfirmInfo.classList.remove('hidden');
    } else {
        if (scaleConfirmInfo) scaleConfirmInfo.classList.add('hidden');
    }
    
    // Toggle panels
    document.getElementById('driver-cpf-panel').classList.add('hidden');
    document.getElementById('driver-confirm-profile-panel').classList.remove('hidden');
}

// ==========================================
// --- CENTRAL DE TOOLTIPS DIN�MICOS ---
// ==========================================
document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    
    const text = target.getAttribute('data-tooltip');
    const tooltip = document.getElementById('global-tooltip');
    if (!tooltip) return;
    
    tooltip.innerHTML = text;
    tooltip.classList.remove('hidden');
    tooltip.classList.add('opacity-100');
    
    // Posicionamento
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2)}px`;
    tooltip.style.top = `${rect.bottom + 8 + window.scrollY}px`;
    
    // Ajustar se sair da viewport
    const tooltipRect = tooltip.getBoundingClientRect();
    if (tooltipRect.left < 10) {
        tooltip.style.left = '10px';
    } else if (tooltipRect.right > window.innerWidth - 10) {
        tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
    }
});

document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    
    const tooltip = document.getElementById('global-tooltip');
    if (tooltip) {
        tooltip.classList.add('hidden');
        tooltip.classList.remove('opacity-100');
    }
});

// ==========================================
// --- ARQUITETURA DE SEGURAN�!A E SESS�"ES ---
// ==========================================
function registerUserSession(role, customName = '', customId = '') {
    if (!db.sessions) db.sessions = [];
    
    let name = customName;
    let identifier = customId;
    
    if (!name) {
        if (role === 'manager') {
            name = 'Gestor CCO (Acesso Master)';
            identifier = 'MASTER-ADMIN';
        } else if (role === 'operator') {
            name = 'Operador CCO (Despacho)';
            identifier = 'OP-CCO';
        } else if (role === 'representative') {
            name = 'Representante Operacional de Área';
            identifier = 'REP-AREA';
        } else if (role === 'passenger') {
            name = 'Passageiro Anônimo (Totem)';
            identifier = 'TOTEM-PASS';
        } else {
            name = 'Acesso Geral';
            identifier = 'ANON';
        }
    }
    
    const sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    safeStorage.session.setItem('conexao_current_session_id', sessionId);
    
    const newSession = {
        id: sessionId,
        nome: name,
        identificador: identifier,
        perfil: role,
        login_timestamp: Date.now(),
        last_active_timestamp: Date.now(),
        ativo: true
    };
    
    // Limitar o histórico de sessões para não estourar o localStorage (últimas 100)
    if (db.sessions.length >= 100) {
        db.sessions.shift();
    }
    
    db.sessions.push(newSession);
    saveDatabase();
}

// Monitor de Sessões Periódico (Validação em Background)
setInterval(() => {
    const currentSessionId = safeStorage.session.getItem('conexao_current_session_id');
    const currentRole = safeStorage.session.getItem('conexao_role');
    
    if (currentSessionId && currentRole) {
        const saved = safeStorage.local.getItem('conexao_transportes_db');
        if (saved) {
            try {
                const latestDb = JSON.parse(saved);
                if (latestDb.sessions) {
                    const session = latestDb.sessions.find(s => s.id === currentSessionId);
                    
                    // Se a sessão atual foi desativada no banco pelo Admin
                    if (!session || session.ativo === false) {
                        forceLogoutUser();
                        return;
                    } else {
                        // Atualizar ping de atividade
                        session.last_active_timestamp = Date.now();
                        db.sessions = latestDb.sessions;
                        safeStorage.local.setItem('conexao_transportes_db', JSON.stringify(db));
                    }
                }
            } catch (e) {
                console.error("Erro no monitor de segurança:", e);
            }
        }
    }
    
    // Atualizar a tela administrativa em tempo real se o gestor estiver visualizando
    if (currentTab === 'access-management') {
        updateAccessManagement();
    }
}, 3000);

function forceLogoutUser() {
    safeStorage.session.removeItem('conexao_current_session_id');
    safeStorage.session.removeItem('conexao_role');
    safeStorage.local.removeItem('conexao_driver_profile');
    
    // Parar GPS se for motorista logado
    if (typeof stopDriverGpsSharing === 'function') {
        stopDriverGpsSharing(true);
    }
    
    currentRole = '';
    const welcome = document.getElementById('welcome-portal');
    if (welcome) welcome.classList.remove('hidden');
    
    applyRoleConfiguration('');
    showToast("Acesso Encerrado", "Sua sessão foi desconectada remotamente pelo administrador.", "danger");
}

function formatTimeElapsed(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

// ==========================================
// --- TELA: ADMINISTRA�!ÒO DE ACESSOS ---
// ==========================================
function updateAccessManagement() {
    if (currentTab !== 'access-management') return;
    
    const tbodySessions = document.getElementById('adm-table-sessions');
    const tbodyCheckins = document.getElementById('adm-table-checkins');
    const tbodyBoarded = document.getElementById('adm-table-boarded');
    const tbodyDrivers = document.getElementById('adm-table-drivers');
    
    if (!tbodySessions || !tbodyCheckins || !tbodyBoarded || !tbodyDrivers) return;
    
    // 1. Atualizar KPIs Rápidos
    const activeSessionsCount = (db.sessions || []).filter(s => s.ativo).length;
    const totalRegisteredCount = (db.collaborators || []).length + (db.accredited || []).length;
    const totalCheckinsCount = (db.bookings || []).filter(b => b.status === 'Confirmado').length;
    const totalBoardedCount = (db.bookings || []).filter(b => b.status === 'Embarcado').length;
    
    document.getElementById('adm-kpi-sessions').textContent = activeSessionsCount;
    document.getElementById('adm-kpi-registered').textContent = totalRegisteredCount;
    document.getElementById('adm-kpi-checkins').textContent = totalCheckinsCount;
    document.getElementById('adm-kpi-boarded').textContent = totalBoardedCount;
    
    // 2. Renderizar Sessões Ativas
    tbodySessions.innerHTML = '';
    const sortedSessions = [...(db.sessions || [])].sort((a, b) => {
        if (a.ativo && !b.ativo) return -1;
        if (!a.ativo && b.ativo) return 1;
        return b.login_timestamp - a.login_timestamp;
    });
    
    if (sortedSessions.length === 0) {
        tbodySessions.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhuma sessão registrada.</td></tr>`;
    } else {
        const currentSessionId = safeStorage.session.getItem('conexao_current_session_id');
        sortedSessions.forEach(s => {
            const timeElapsed = formatTimeElapsed(Date.now() - s.login_timestamp);
            const entryTime = new Date(s.login_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            let badgeProfileColor = 'status-pill text-blue-400 border-blue-500/20';
            let roleText = s.perfil;
            if (s.perfil === 'manager') { roleText = 'Master'; badgeProfileColor = 'status-pill text-rose-400 border-rose-500/20'; }
            else if (s.perfil === 'operator') { roleText = 'Operador'; badgeProfileColor = 'bg-teal-500/10 text-teal-400 border-teal-500/20'; }
            else if (s.perfil === 'representative') { roleText = 'Representante'; badgeProfileColor = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'; }
            else if (s.perfil === 'driver') { roleText = 'Motorista'; badgeProfileColor = 'status-pill text-amber-400 border-amber-500/20'; }
            else if (s.perfil === 'passenger') { roleText = 'Passageiro'; badgeProfileColor = 'bg-sky-500/10 text-sky-400 border-sky-500/20'; }
            
            let statusBadge = s.ativo 
                ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20 uppercase">Ativo</span>'
                : '<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-500 border border-gray-700 uppercase">Encerrado</span>';
                
            let actionBtn = '';
            if (s.ativo) {
                const isSelf = s.id === currentSessionId;
                actionBtn = `<button onclick="terminateSession('${s.id}')" class="bg-red-600/25 hover:bg-red-600 text-red-400 hover:text-white px-2.5 py-1 rounded-lg border border-red-500/20 text-[10px] uppercase font-bold transition duration-200 flex items-center gap-1">
                    <i class="fa-solid fa-power-off"></i> ${isSelf ? 'Sair' : 'Derrubar'}
                </button>`;
            } else {
                actionBtn = '<span class="text-gray-600 text-[10px] font-bold">-</span>';
            }
            
            const isSelfText = s.id === currentSessionId ? ' <span class="text-[9px] bg-blue-600/25 text-blue-400 px-1 py-0.2 rounded font-bold uppercase ml-1">Você</span>' : '';
            
            const tr = document.createElement('tr');
            tr.className = "border-b border-gray-900 hover:bg-gray-900/10 transition-colors";
            tr.innerHTML = `
                <td class="py-2.5 px-3 font-semibold text-white">${s.nome}${isSelfText}</td>
                <td class="py-2.5 px-3 font-mono text-gray-400">${s.identificador || '-'}</td>
                <td class="py-2.5 px-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeProfileColor}">${roleText}</span></td>
                <td class="py-2.5 px-3 text-center text-gray-300 font-mono">${entryTime}</td>
                <td class="py-2.5 px-3 text-center text-gray-300 font-mono">${s.ativo ? timeElapsed : '-'}</td>
                <td class="py-2.5 px-3 text-center">${statusBadge}</td>
                <td class="py-2.5 px-3 text-right flex justify-end">${actionBtn}</td>
            `;
            tbodySessions.appendChild(tr);
        });
    }
    
    // 3. Renderizar Histórico de Check-ins Recentes
    tbodyCheckins.innerHTML = '';
    const sortedCheckins = [...(db.bookings || [])]
        .filter(b => b.status === 'Confirmado' || b.status === 'Embarcado')
        .sort((a, b) => new Date(b.created_at || b.data) - new Date(a.created_at || a.data))
        .slice(0, 25);
        
    if (sortedCheckins.length === 0) {
        tbodyCheckins.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-gray-500">Nenhum check-in registrado recentemente.</td></tr>`;
    } else {
        sortedCheckins.forEach(b => {
            const tr = document.createElement('tr');
            tr.className = "border-b border-gray-955 hover:bg-gray-900/10 transition-colors";
            const dateStr = b.data + ' ' + (b.hora || '12:00');
            const labelId = b.matricula ? `MAT: ${b.matricula}` : `CPF: ${b.cpf || '-'}`;
            const statusClass = b.status === 'Embarcado' ? 'text-emerald-400 font-bold' : 'text-blue-400 font-medium';
            
            tr.innerHTML = `
                <td class="py-2 px-2 font-semibold text-white truncate max-w-[130px]">${b.nome}</td>
                <td class="py-2 px-2 text-gray-400 font-mono">${labelId}</td>
                <td class="py-2 px-2 text-center text-gray-400 font-mono">${dateStr}</td>
                <td class="py-2 px-2 text-right ${statusClass}">${b.status}</td>
            `;
            tbodyCheckins.appendChild(tr);
        });
    }
    
    // 4. Renderizar Embarques Confirmados (Período)
    tbodyBoarded.innerHTML = '';
    const sortedBoarded = [...(db.bookings || [])]
        .filter(b => b.status === 'Embarcado')
        .sort((a, b) => new Date(b.created_at || b.data) - new Date(a.created_at || a.data))
        .slice(0, 25);
        
    if (sortedBoarded.length === 0) {
        tbodyBoarded.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-gray-500">Nenhum embarque realizado.</td></tr>`;
    } else {
        sortedBoarded.forEach(b => {
            const tr = document.createElement('tr');
            tr.className = "border-b border-gray-955 hover:bg-gray-900/10 transition-colors";
            const timeStr = b.hora || '12:00';
            const labelId = b.matricula ? `MAT: ${b.matricula}` : `CPF: ${b.cpf || '-'}`;
            
            tr.innerHTML = `
                <td class="py-2 px-2 font-semibold text-white truncate max-w-[130px]">${b.nome}</td>
                <td class="py-2 px-2 text-gray-400 font-mono">${labelId}</td>
                <td class="py-2 px-2 text-gray-400">${b.origem} <i class="fa-solid fa-arrow-right text-[8px] mx-1 text-gray-500"></i> ${b.destino}</td>
                <td class="py-2 px-2 text-right text-emerald-400 font-mono">${timeStr}</td>
            `;
            tbodyBoarded.appendChild(tr);
        });
    }
    
    // 5. Renderizar Controle de Motoristas do Evento
    tbodyDrivers.innerHTML = '';
    const activeTrackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
    
    // Se houver mapa importado, usar ele. Senão, usar a lista geral padrão do banco de dados.
    const isUsingMap = db.drivers_map && db.drivers_map.length > 0;
    const driversList = isUsingMap ? db.drivers_map : (db.drivers || []);
    
    if (driversList.length === 0) {
        tbodyDrivers.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-gray-500">Nenhum motorista importado ou cadastrado na base.</td></tr>`;
    } else {
        driversList.forEach(d => {
            const isGpsActive = !!activeTrackers[d.nome] && activeTrackers[d.nome].remote_kill !== true;
            
            let isDriverLoggedIn = false;
            let plateText = d.placa_veiculo || '-';
            let vehicleText = d.tipo_veiculo || '-';
            let serviceText = d.service || (d.tipo_veiculo && d.tipo_veiculo.toUpperCase().includes('VAN') ? 'Vai e Vem' : 'Vai e Vem');
            let companyText = d.empresa || 'Empresa Parceira';
            
            const hasActiveSession = (db.sessions || []).some(s => s.perfil === 'driver' && String(s.identificador).replace(/\D/g, '') === String(d.cpf || '').replace(/\D/g, '') && s.ativo);
            
            if (hasActiveSession || isGpsActive) {
                isDriverLoggedIn = true;
                if (activeTrackers[d.nome]) {
                    plateText = activeTrackers[d.nome].vehicle || plateText;
                    serviceText = activeTrackers[d.nome].service || serviceText;
                }
            }
            
            const badgeLogin = isDriverLoggedIn 
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20 uppercase">Confirmado</span>'
                : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-500 border border-gray-700 uppercase">Não Logado</span>';
                
            const badgeGps = isGpsActive
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white animate-pulse uppercase"><i class="fa-solid fa-satellite-dish mr-1"></i>Transmitindo</span>'
                : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-500 border border-red-500/20 uppercase">Offline</span>';
                
            // Construir as Ações
            let actionsHtml = `<div class="flex flex-wrap gap-1.5 justify-center items-center">`;
            
            // Botão Copiar Link sempre para motoristas do mapa importado
            if (isUsingMap) {
                actionsHtml += `
                    <button onclick="openDriverLinkEditor('${d.nome.replace(/'/g, "\\'")}', '${d.cpf}')" class="bg-indigo-600/20 hover:bg-indigo-650 text-indigo-400 hover:text-white px-2 py-1 rounded-lg border border-indigo-500/20 text-[9px] uppercase font-black transition flex items-center gap-1 cursor-pointer" title="Revisar escala e gerar link do WhatsApp">
                        <i class="fa-solid fa-whatsapp text-emerald-400"></i> Link
                    </button>
                `;
            }
            
            // Botão Desconectar se ativo
            if (isDriverLoggedIn || isGpsActive) {
                actionsHtml += `
                    <button onclick="terminateDriverSession('${d.cpf}')" class="bg-rose-600/20 hover:bg-rose-600 text-rose-500 hover:text-white px-2 py-1 rounded-lg border border-rose-500/20 text-[9px] uppercase font-black transition flex items-center gap-1 cursor-pointer" title="Desconectar motorista remotamente">
                        <i class="fa-solid fa-right-from-bracket"></i> Sair
                    </button>
                `;
            }
            
            if (actionsHtml === `<div class="flex flex-wrap gap-1.5 justify-center items-center">`) {
                actionsHtml = `<span class="text-gray-500">-</span>`;
            } else {
                actionsHtml += `</div>`;
            }
            
            // Se for do mapa, exibir rota e horários previstos da escala na célula de detalhes
            let vehicleInfo = `${vehicleText} (Placa: ${plateText})`;
            if (isUsingMap && d.origin && d.destination) {
                vehicleInfo += `<div class="text-[9px] text-gray-500 mt-0.5 flex items-center gap-1"><i class="fa-solid fa-map-location text-indigo-400"></i> ${d.origin} <i class="fa-solid fa-arrow-right text-[7px]"></i> ${d.destination}</div>`;
                if (d.start_time) {
                    vehicleInfo += `<div class="text-[9px] text-gray-500 flex items-center gap-1"><i class="fa-solid fa-clock text-amber-500"></i> Previsto: ${d.start_time} às ${d.end_time || '-'}</div>`;
                }
            }
            
            const tr = document.createElement('tr');
            tr.className = "border-b border-gray-900 hover:bg-gray-900/10 transition-colors";
            tr.innerHTML = `
                <td class="py-2.5 px-3 font-semibold text-white">
                    ${d.nome}
                    ${isUsingMap ? '<span class="ml-1 text-[8px] bg-indigo-500/20 text-indigo-300 px-1 py-0.2 rounded font-bold uppercase tracking-wider">Escalado</span>' : ''}
                </td>
                <td class="py-2.5 px-3 text-gray-400 font-mono">${companyText}</td>
                <td class="py-2.5 px-3 text-gray-300">${vehicleInfo}</td>
                <td class="py-2.5 px-3 text-center text-indigo-400 font-bold">${serviceText}</td>
                <td class="py-2.5 px-3 text-center">${badgeLogin}</td>
                <td class="py-2.5 px-3 text-center">${badgeGps}</td>
                <td class="py-2.5 px-3 text-center">${actionsHtml}</td>
            `;
            tbodyDrivers.appendChild(tr);
        });
    }

    // 5. Renderizar Solicitantes Autorizados e Logs de Auditoria
    renderAuthorizedSolicitants();
    renderAuditLogs();
}

function renderAuthorizedSolicitants() {
    const tbody = document.getElementById('adm-table-solicitants');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const list = db.authorized_solicitants || [];
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="py-3 text-center text-gray-500">Nenhum ponto focal cadastrado.</td></tr>`;
        return;
    }
    
    list.forEach(s => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-950 hover:bg-gray-900/10 transition-colors";
        
        tr.innerHTML = `
            <td class="py-2 px-2">
                <strong class="text-white block font-semibold text-[11px]">${s.nome}</strong>
                <span class="text-[9px] text-gray-500">${s.cargo || 'Ponto Focal'} / ${s.departamento || 'TECNOLOGIA'}</span>
            </td>
            <td class="py-2 px-2 font-mono text-gray-400 text-xs">${s.matricula || s.cpf}</td>
            <td class="py-2 px-2 text-right">
                <button onclick="removeAuthorizedSolicitant('${s.matricula || s.cpf}')" class="bg-rose-500/10 hover:bg-rose-600 text-rose-450 hover:text-white p-1 rounded-lg border border-rose-500/20 text-[10px] uppercase font-bold transition duration-200">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAuditLogs() {
    const tbody = document.getElementById('adm-table-audit-logs');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    // Mostrar os logs mais recentes primeiro
    const logs = [...(db.booking_logs || [])].reverse();
    
    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-gray-500">Nenhum log de auditoria registrado.</td></tr>`;
        return;
    }
    
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-955 hover:bg-gray-900/10 transition-colors";
        
        // Formatar data e hora
        const timestamp = new Date(log.timestamp);
        const formattedDate = timestamp.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + 
                              timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        // Cor da ação
        let acaoBadge = '';
        if (log.acao === 'Agendado') {
            acaoBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-green-500/15 text-green-400 border border-green-500/20">Agendou</span>';
        } else if (log.acao === 'Cancelado') {
            acaoBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/20">Cancelou</span>';
        } else {
            acaoBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">Tentativa Negada</span>';
        }
        
        // Cor do autorizado
        let autColor = 'text-gray-400';
        if (log.autorizado === 'Sim') autColor = 'text-green-450 font-bold';
        else if (log.autorizado.includes('Autocadastro')) autColor = 'text-blue-400';
        else autColor = 'text-red-450 font-bold';
        
        tr.innerHTML = `
            <td class="py-2 px-2 text-gray-450 font-mono text-[10px] whitespace-nowrap">${formattedDate}</td>
            <td class="py-2 px-2 text-center">${acaoBadge}</td>
            <td class="py-2 px-2">
                <strong class="text-white block text-[11px] font-semibold truncate max-w-[120px]" title="${log.passageiro_nome}">${log.passageiro_nome}</strong>
                <span class="text-[9px] text-gray-550 font-mono">ID: ${log.passageiro_id}</span>
            </td>
            <td class="py-2 px-2">
                <strong class="text-gray-300 block text-[11px] font-semibold truncate max-w-[120px]" title="${log.solicitante_nome}">${log.solicitante_nome}</strong>
                <span class="text-[9px] text-gray-550 font-mono">ID: ${log.solicitante_id}</span>
            </td>
            <td class="py-2 px-2 text-center text-[10px] ${autColor}">${log.autorizado}</td>
            <td class="py-2 px-2 text-right text-gray-400 text-[10px] font-semibold">${log.canal}</td>
        `;
        tbody.appendChild(tr);
    });
}

function addAuthorizedSolicitant() {
    const input = document.getElementById('adm-new-solicitant-id');
    const msg = document.getElementById('adm-solicitant-msg');
    
    if (!input || !msg) return;
    
    const idVal = input.value.trim();
    if (!idVal) {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] text-red-400 font-bold";
        msg.textContent = "Digite uma matrícula ou CPF.";
        return;
    }
    
    // Verificar se a matrícula já está autorizada
    const exists = (db.authorized_solicitants || []).some(s => s.matricula === idVal || s.cpf === idVal);
    if (exists) {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] text-amber-400 font-bold";
        msg.textContent = "Este colaborador já está autorizado.";
        return;
    }
    
    // Buscar colaborador na base
    const person = findPerson(idVal);
    if (!person) {
        msg.classList.remove('hidden');
        msg.className = "text-[10px] text-red-400 font-bold";
        msg.textContent = "Colaborador não credenciado no evento.";
        return;
    }
    
    if (!db.authorized_solicitants) db.authorized_solicitants = [];
    
    db.authorized_solicitants.push({
        matricula: person.matricula || '',
        cpf: person.cpf || '',
        nome: person.nome,
        cargo: person.cargo || 'Ponto Focal',
        departamento: person.departamento || getN1Area(person)
    });
    
    saveDatabase();
    input.value = '';
    msg.classList.remove('hidden');
    msg.className = "text-[10px] text-green-400 font-bold";
    msg.textContent = `�S ${person.nome} autorizado com sucesso.`;
    
    renderAuthorizedSolicitants();
    
    setTimeout(() => {
        msg.classList.add('hidden');
    }, 3000);
}

function removeAuthorizedSolicitant(id) {
    if (confirm("Deseja realmente revogar a autorização deste ponto focal?")) {
        if (db.authorized_solicitants) {
            db.authorized_solicitants = db.authorized_solicitants.filter(s => s.matricula !== id && s.cpf !== id);
            saveDatabase();
            renderAuthorizedSolicitants();
            showToast("Autorização Revogada", "O colaborador não pode mais agendar para terceiros.", "warning");
        }
    }
}

function clearAuditLogs() {
    if (confirm("Deseja realmente limpar todos os logs de auditoria de agendamentos? Esta ação não pode ser desfeita.")) {
        db.booking_logs = [];
        saveDatabase();
        renderAuditLogs();
        showToast("Logs Limpos", "Histórico de logs de auditoria foi reiniciado.", "success");
    }
}

function terminateSession(sessionId) {
    if (confirm("Deseja realmente derrubar o acesso desta sessão?")) {
        const session = (db.sessions || []).find(s => s.id === sessionId);
        if (session) {
            session.ativo = false;
            saveDatabase();
            updateAccessManagement();
            showToast("Acesso Derrubado", `A sessão de ${session.nome} foi encerrada remotamente.`, "warning");
        }
    }
}

function terminateDriverSession(cpf) {
    if (confirm("Deseja realmente derrubar o acesso e suspender a transmissão do motorista?")) {
        const driver = db.drivers.find(d => String(d.cpf || '').replace(/\D/g, '') === String(cpf).replace(/\D/g, ''));
        if (driver) {
            if (db.sessions) {
                db.sessions.forEach(s => {
                    if (s.perfil === 'driver' && String(s.identificador).replace(/\D/g, '') === String(cpf).replace(/\D/g, '')) {
                        s.ativo = false;
                    }
                });
            }
            
            const trackers = JSON.parse(safeStorage.local.getItem('conexao_active_trackers') || '{}');
            if (trackers[driver.nome]) {
                trackers[driver.nome].remote_kill = true;
                safeStorage.local.setItem('conexao_active_trackers', JSON.stringify(trackers));
            }
            
            saveDatabase();
            updateAccessManagement();
            showToast("Motorista Desconectado", `O motorista ${driver.nome} foi desconectado e seu sinal GPS encerrado.`, "warning");
        }
    }
}

// ==========================================
// --- TELA: CENTRAL DE TUTORIAIS ---
// ==========================================
function switchTutorial(tutId) {
    document.querySelectorAll('.tut-panel').forEach(panel => {
        panel.classList.add('hidden');
    });
    
    const selectedPanel = document.getElementById(`tut-content-${tutId}`);
    if (selectedPanel) {
        selectedPanel.classList.remove('hidden');
    }
    
    document.querySelectorAll('.tut-btn').forEach(btn => {
        btn.className = "tut-btn text-left text-xs font-semibold px-4 py-3 rounded-xl hover:bg-gray-900 text-gray-400 hover:text-white transition flex items-center space-x-2.5";
    });
    
    const activeBtn = document.getElementById(`tut-btn-${tutId}`);
    if (activeBtn) {
        if (tutId === 'executive') {
            activeBtn.className = "tut-btn text-left text-xs font-semibold px-4 py-3 rounded-xl bg-amber-600/90 text-white shadow-lg shadow-amber-600/20 transition flex items-center space-x-2.5";
        } else {
            activeBtn.className = "tut-btn text-left text-xs font-semibold px-4 py-3 rounded-xl bg-indigo-650 text-white shadow-lg shadow-indigo-600/20 transition flex items-center space-x-2.5";
        }
    }
}

function downloadTutorialPDF(tutId) {
    const contentDiv = document.getElementById(`tut-content-${tutId}`);
    if (!contentDiv) {
        alert("Tutorial não encontrado.");
        return;
    }
    
    // Clonar o HTML do tutorial
    let htmlContent = contentDiv.innerHTML;
    
    // Remover o próprio botão de download do PDF para não aparecer na impressão
    htmlContent = htmlContent.replace(/<button[^>]*downloadTutorialPDF[^>]*>[\s\S]*?<\/button>/gi, '');
    
    // Abrir uma janela temporária
    const printWindow = window.open('', '_blank', 'width=850,height=850');
    if (!printWindow) {
        alert("Por favor, permita pop-ups para fazer o download do PDF.");
        return;
    }
    
    // Definir o título do documento com base no tipo
    let title = "Tutorial do Conexão Transportes";
    if (tutId === 'driver') title = "Manual do Motorista - Conexão Transportes";
    else if (tutId === 'passenger') title = "Manual do Passageiro - Conexão Transportes";
    else if (tutId === 'representative') title = "Manual do Representante - Conexão Transportes";
    else if (tutId === 'operator') title = "Manual do Time de Transportes - Conexão Transportes";
    else if (tutId === 'executive') title = "Manual de Gestão & Analytics - Conexão Transportes";
    
    // Escrever o conteúdo com layout otimizado para impressão (modo claro e limpo para salvar tinta)
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title}</title>
            <meta charset="utf-8">
            <script src="https://cdn.tailwindcss.com"></script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                @media print {
                    body {
                        background: white !important;
                        color: black !important;
                        padding: 10px !important;
                    }
                    .no-print {
                        display: none !important;
                    }
                }
                body {
                    font-family: system-ui, -apple-system, sans-serif;
                    padding: 30px;
                    background: #ffffff;
                    color: #0f172a;
                }
                .glass, .bg-gray-900\\/40, .bg-gray-900\\/50, .bg-gray-955, .bg-gray-950\\/50 {
                    background: #f8fafc !important;
                    border: 1px solid #e2e8f0 !important;
                    color: #1e293b !important;
                    padding: 16px !important;
                    border-radius: 12px !important;
                    margin-bottom: 12px !important;
                }
                .text-gray-400, .text-gray-500, .text-gray-300 {
                    color: #334155 !important;
                }
                .text-white {
                    color: #0f172a !important;
                    font-weight: 700 !important;
                }
                .border-gray-800, .border-gray-950, .border-gray-900 {
                    border-color: #e2e8f0 !important;
                }
                h2 {
                    color: #0f172a !important;
                }
                span.bg-emerald-500\\/10, span.bg-blue-500\\/10, span.bg-indigo-500\\/10, span.bg-teal-500\\/10, span.bg-amber-500\\/10 {
                    background-color: #f1f5f9 !important;
                    border-color: #cbd5e1 !important;
                    color: #0f172a !important;
                }
            </style>
        </head>
        <body>
            <div class="max-w-3xl mx-auto">
                <div class="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-200">
                    <i class="fa-solid fa-bus text-indigo-600 text-3xl"></i>
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">Conexão Transportes</h1>
                        <p class="text-[10px] text-slate-500">Documento Oficial de Instruções e Treinamento do Usuário</p>
                    </div>
                </div>
                <div class="space-y-6">
                    ${htmlContent}
                </div>
                <div class="mt-12 pt-4 border-t border-slate-200 text-center text-xs text-slate-400">
                    Documento gerado em ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} - Conexão Transportes Eventos
                </div>
            </div>
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                        window.close();
                    }, 600);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// ==========================================
// --- FLUXO: MAPA DE TRANSPORTE E LINKS ---
// ==========================================

// Dicionário local para geocodificação instantânea das bases e locais comuns no Rio de Janeiro
// Coordenadas geográficas terrestres de referência por Bairro (Portado do Agente RIG)
const BAIRROS_COORDS = {
    // ZONA OESTE
    "guaratiba": { lat: -22.986, lng: -43.593 },
    "pedra de guaratiba": { lat: -22.986, lng: -43.593 },
    "ilha de guaratiba": { lat: -22.986, lng: -43.593 },
    "curicica": { lat: -22.955, lng: -43.398 },
    "jacarepagua": { lat: -22.956, lng: -43.364 },
    "jacarepaguá": { lat: -22.956, lng: -43.364 },
    "barra da tijuca": { lat: -23.000, lng: -43.366 },
    "recreio": { lat: -23.018, lng: -43.468 },
    "recreio dos bandeirantes": { lat: -23.018, lng: -43.468 },
    "camorim": { lat: -22.969, lng: -43.407 },
    "vargem grande": { lat: -22.993, lng: -43.484 },
    "vargem pequena": { lat: -22.981, lng: -43.443 },
    "bangu": { lat: -22.879, lng: -43.465 },
    "campo grande": { lat: -22.900, lng: -43.559 },
    "santa cruz": { lat: -22.923, lng: -43.684 },
    "realengo": { lat: -22.875, lng: -43.428 },
    "padre miguel": { lat: -22.876, lng: -43.447 },
    "taquara": { lat: -22.923, lng: -43.366 },
    "freguesia": { lat: -22.940, lng: -43.341 },
    "pechincha": { lat: -22.933, lng: -43.355 },
    "tanque": { lat: -22.915, lng: -43.360 },

    // ZONA SUL
    "jardim botanico": { lat: -22.967, lng: -43.228 },
    "jardim botânico": { lat: -22.967, lng: -43.228 },
    "leblon": { lat: -22.984, lng: -43.223 },
    "ipanema": { lat: -22.984, lng: -43.204 },
    "copacabana": { lat: -22.971, lng: -43.182 },
    "botafogo": { lat: -22.951, lng: -43.180 },
    "flamengo": { lat: -22.935, lng: -43.177 },
    "laranjeiras": { lat: -22.933, lng: -43.186 },
    "catete": { lat: -22.926, lng: -43.176 },
    "gloria": { lat: -22.919, lng: -43.173 },
    "glória": { lat: -22.919, lng: -43.173 },
    "leme": { lat: -22.962, lng: -43.166 },
    "urca": { lat: -22.953, lng: -43.162 },
    "sao conrado": { lat: -22.993, lng: -43.253 },
    "são conrado": { lat: -22.993, lng: -43.253 },
    "rocinha": { lat: -22.988, lng: -43.249 },

    // ZONA NORTE & CENTRO
    "centro": { lat: -22.906, lng: -43.172 },
    "lapa": { lat: -22.913, lng: -43.180 },
    "mangueira": { lat: -22.903, lng: -43.235 },
    "sao cristovao": { lat: -22.899, lng: -43.222 },
    "são cristóvão": { lat: -22.899, lng: -43.222 },
    "benfica": { lat: -22.892, lng: -43.243 },
    "tijuca": { lat: -22.933, lng: -43.238 },
    "vila isabel": { lat: -22.914, lng: -43.245 },
    "maracana": { lat: -22.912, lng: -43.230 },
    "maracanã": { lat: -22.912, lng: -43.230 },
    "meier": { lat: -22.901, lng: -43.280 },
    "méier": { lat: -22.901, lng: -43.280 },
    "engenho de dentro": { lat: -22.894, lng: -43.294 },
    "madureira": { lat: -22.871, lng: -43.336 },
    "cascadura": { lat: -22.878, lng: -43.324 },
    "piedade": { lat: -22.890, lng: -43.308 },
    "ilha do governador": { lat: -22.809, lng: -43.208 },
    "galeao": { lat: -22.812, lng: -43.243 },
    "galeão": { lat: -22.812, lng: -43.243 },
    "penha": { lat: -22.834, lng: -43.276 },
    "olaria": { lat: -22.844, lng: -43.262 },
    "bonsucesso": { lat: -22.862, lng: -43.250 },

    // OUTROS MUNICÍPIOS / LOCALIDADES
    "niteroi": { lat: -22.883, lng: -43.103 },
    "niterói": { lat: -22.883, lng: -43.103 },
    "são gonçalo": { lat: -22.826, lng: -43.053 },
    "duque de caxias": { lat: -22.785, lng: -43.311 },
    "nova iguaçu": { lat: -22.757, lng: -43.460 },
    "alto da boa vista": { lat: -22.965, lng: -43.250 }
};

// Dicionário local para geocodificação de bases principais
const LOCAL_GEO_DICT = {
    'estúdios globo': [-22.9754, -43.4162],
    'estudios globo': [-22.9754, -43.4162],
    'projac': [-22.9754, -43.4162],
    'eg': [-22.9754, -43.4162],
    'jardim botânico': [-22.9691, -43.2244],
    'jardim botanico': [-22.9691, -43.2244],
    'jb': [-22.9691, -43.2244],
    'íon': [-23.0039, -43.3242],
    'íon barra': [-23.0039, -43.3242],
    'ion': [-23.0039, -43.3242],
    'ion barra': [-23.0039, -43.3242],
    'sambódromo': [-22.9119, -43.1970],
    'sambodromo': [-22.9119, -43.1970],
    'galeão': [-22.8134, -43.2494],
    'galeao': [-22.8134, -43.2494],
    'santos dumont': [-22.9111, -43.1627],
    'copacabana': [-22.9698, -43.1840],
    'barra': [-23.0068, -43.3115],
    'recreio': [-23.0189, -43.4682],
    'vargem grande': [-22.9934, -43.4939],
    'jacarepaguá': [-22.9304, -43.3368],
    'jacarepagua': [-22.9304, -43.3368],
    'barra da tijuca': [-23.0068, -43.3115]
};

// Helper para extrair o Bairro a partir do endereço estruturado
function extrairBairro(v) {
    if (!v) return "";
    const partes = String(v).split(",").map(p => p.trim()).filter(Boolean);
    return partes[partes.length - 1] || "";
}

// Geocodificação inteligente com dicionário local, georreferenciamento por bairro e API Nominatim (OSM)
async function geocodeAddress(address) {
    if (!address) return [-22.9068, -43.1729]; // Centro do Rio como padrão
    
    const clean = String(address).toLowerCase().trim();
    
    // 1. Tentar dicionário local de bases Globo/destinos
    for (const key of Object.keys(LOCAL_GEO_DICT)) {
        if (clean.includes(key) || key.includes(clean)) {
            return LOCAL_GEO_DICT[key];
        }
    }
    
    // 2. Tentar georreferenciamento de fidelidade por Bairro (Portado do Agente RIG)
    const bairro = extrairBairro(address).toLowerCase().replace(/['"´`]/g, "").trim();
    if (BAIRROS_COORDS[bairro]) {
        // Jitter muito pequeno (~200m) para dispersar marcadores mas evitar cair na água
        const lat = BAIRROS_COORDS[bairro].lat + (Math.random() - 0.5) * 0.002;
        const lng = BAIRROS_COORDS[bairro].lng + (Math.random() - 0.5) * 0.002;
        return [lat, lng];
    }
    
    // 3. Fallback: Consulta assíncrona Nominatim OpenStreetMap (restrita ao Rio de Janeiro)
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address + ', Rio de Janeiro, Brasil')}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'ConexaoTransportesCCO/1.0' } });
        const data = await res.json();
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
    } catch (e) {
        console.warn("Nominatim Geocode falhou:", e);
    }
    
    // 4. Fallback final seguro: Centro do Rio com jitter seguro de ~400 metros
    const latOffset = (Math.random() - 0.5) * 0.004;
    const lngOffset = (Math.random() - 0.5) * 0.004;
    return [-22.9068 + latOffset, -43.1729 + lngOffset];
}

// Importação do Excel da Escala de Motoristas (Mapa de Transporte) com Geocodificação Assíncrona e Colunas Alinhadas
function importDriverScheduleMap(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (typeof XLSX === 'undefined') {
        showToast("XLSX Indisponível", "A biblioteca de leitura de planilhas não foi carregada no navegador.", "danger");
        return;
    }
    
    showToast("Processando Escala", "Lendo arquivo e buscando coordenadas dos endereços de saída...", "info");
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 'A', defval: '' });
            
            const importedDrivers = [];
            
            // Loop sequencial assíncrono para geocodificação
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index];
                const name = String(row['F'] || '').trim(); // F = Motorista
                const plate = String(row['I'] || '').trim(); // I = Placa Veículo
                
                // Pular se for cabeçalho ou escalas sem motorista / serviços administrativos
                if (!name || name.toLowerCase() === 'motorista' || name.includes('LOGÍSTICA') || name.toLowerCase().includes('sem motorista')) {
                    continue;
                }
                
                const startTime = parseExcelDate(row['M']);
                const endTime = parseExcelDate(row['O']);
                const origin = String(row['L'] || 'Estúdios Globo').trim();
                const destination = String(row['N'] || getEventLocationName()).trim();
                
                // Geocodificação da localidade de saída
                const originCoords = await geocodeAddress(origin);
                
                // Gerar CPF numérico fictício baseado no nome do motorista para login
                let cpf = '00000000000';
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                    hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                cpf = String(Math.abs(hash)).padStart(11, '0').substring(0, 11);
                
                importedDrivers.push({
                    id: 'map_' + Date.now() + '_' + index,
                    nome: name,
                    cpf: cpf,
                    empresa: String(row['D'] || 'Prestador CCO').trim(), // D = Prestador do veículo!
                    telefone: String(row['G'] || '(21) 99999-9999').trim(), // G = Telefone Motorista!
                    tipo_veiculo: String(row['H'] || 'Van Executiva').trim(), // H = Tipo de Veículo!
                    placa_veiculo: plate.toUpperCase() || 'SEM PLACA',
                    service: mapExcelServiceGroup(row['P']), // P = Programa!
                    origin: origin,
                    destination: destination,
                    start_time: startTime,
                    end_time: endTime,
                    lat: originCoords[0],
                    lng: originCoords[1],
                    imported: true
                });
            }
            
            if (importedDrivers.length === 0) {
                showToast("Erro na Importação", "Nenhum motorista válido encontrado. Verifique se as colunas estão no formato correto.", "danger");
                return;
            }
            
            db.drivers_map = importedDrivers;
            saveDatabase();
            
            // Forçar atualização do CCO e do Mapa
            updateAccessManagement();
            if (typeof updateLiveMapMarkers === 'function') {
                updateLiveMapMarkers();
            }
            
            showToast("Importação Concluída", `${importedDrivers.length} motoristas e pontos de início importados com sucesso!`, "success");
        } catch(err) {
            console.error(err);
            showToast("Erro na Importação", "Falha ao processar planilha: " + err.message, "danger");
        }
    };
    reader.readAsArrayBuffer(file);
}

// Mapeamento dos grupos de serviço da planilha para o sistema local
function mapExcelServiceGroup(val) {
    if (!val) return 'Vai e Vem';
    const s = String(val).toLowerCase();
    if (s.includes('produção') || s.includes('producao')) {
        return 'Carros de producao';
    } else if (s.includes('executivo') || s.includes('executiva')) {
        return 'Veiculos Executivos';
    } else if (s.includes('outros') || s.includes('atendimento')) {
        return 'Outros atendimentos';
    } else {
        return 'Vai e Vem';
    }
}

// Conversão inteligente de datas do Excel serial para strings
function parseExcelDate(val) {
    if (!val) return '';
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    return String(val).trim();
}

// Abrir modal de edição antes de gerar link do WhatsApp
function openDriverLinkEditor(nome, cpf) {
    if (!db.drivers_map) return;
    const d = db.drivers_map.find(x => x.nome === nome && String(x.cpf) === String(cpf));
    if (!d) return;
    
    document.getElementById('drv-link-edit-id').value = d.id;
    document.getElementById('drv-link-edit-name').value = d.nome;
    document.getElementById('drv-link-edit-cpf').value = formatCpfString(d.cpf);
    document.getElementById('drv-link-edit-company').value = d.empresa;
    document.getElementById('drv-link-edit-phone').value = d.telefone;
    document.getElementById('drv-link-edit-vehicle-type').value = d.tipo_veiculo;
    document.getElementById('drv-link-edit-plate').value = d.placa_veiculo;
    document.getElementById('drv-link-edit-service').value = d.service || 'Vai e Vem';
    document.getElementById('drv-link-edit-origin').value = d.origin || '';
    document.getElementById('drv-link-edit-destination').value = d.destination || '';
    document.getElementById('drv-link-edit-start-time').value = d.start_time || '';
    document.getElementById('drv-link-edit-end-time').value = d.end_time || '';
    
    document.getElementById('modal-driver-link-editor').classList.remove('hidden');
    document.getElementById('modal-driver-link-editor').classList.add('flex');
}

function closeDriverLinkEditor() {
    document.getElementById('modal-driver-link-editor').classList.add('hidden');
    document.getElementById('modal-driver-link-editor').classList.remove('flex');
}

function formatCpfString(val) {
    const s = String(val || '').replace(/\D/g, '');
    if (s.length === 11) {
        return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }
    return s;
}

// Salva modificações do CCO e copia link parametrizado para o clipboard
function confirmAndCopyDriverLink() {
    const id = document.getElementById('drv-link-edit-id').value;
    if (!db.drivers_map) return;
    
    const index = db.drivers_map.findIndex(x => x.id === id);
    if (index === -1) return;
    
    const updated = {
        ...db.drivers_map[index],
        nome: document.getElementById('drv-link-edit-name').value.trim(),
        cpf: document.getElementById('drv-link-edit-cpf').value.replace(/\D/g, ''),
        empresa: document.getElementById('drv-link-edit-company').value.trim(),
        telefone: document.getElementById('drv-link-edit-phone').value.trim(),
        tipo_veiculo: document.getElementById('drv-link-edit-vehicle-type').value.trim(),
        placa_veiculo: document.getElementById('drv-link-edit-plate').value.trim().toUpperCase(),
        service: document.getElementById('drv-link-edit-service').value,
        origin: document.getElementById('drv-link-edit-origin').value.trim(),
        destination: document.getElementById('drv-link-edit-destination').value.trim(),
        start_time: document.getElementById('drv-link-edit-start-time').value.trim(),
        end_time: document.getElementById('drv-link-edit-end-time').value.trim()
    };
    
    db.drivers_map[index] = updated;
    saveDatabase();
    
    updateAccessManagement();
    
    // Obter URL parametrizada do motorista
    const finalUrl = getDriverUrl(updated);
    
    navigator.clipboard.writeText(finalUrl)
        .then(() => {
            showToast("Link Copiado!", `Os dados de ${updated.nome} foram salvos e o link do WhatsApp foi copiado com sucesso!`, "success");
        })
        .catch(err => {
            // Fallback de cópia manual
            const el = document.createElement('textarea');
            el.value = finalUrl;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Link Copiado!", `Link de ${updated.nome} copiado via fallback!`, "success");
        });
        
    closeDriverLinkEditor();
}

// Helper para montar a URL parametrizada de login do motorista
function getDriverUrl(driver) {
    const originUrl = window.location.origin + window.location.pathname;
    const queryParams = new URLSearchParams();
    queryParams.set('role', 'driver');
    queryParams.set('name', driver.nome);
    queryParams.set('cpf', driver.cpf);
    queryParams.set('company', driver.empresa);
    queryParams.set('phone', driver.telefone);
    queryParams.set('vehicleType', driver.tipo_veiculo);
    queryParams.set('plate', driver.placa_veiculo);
    queryParams.set('service', driver.service);
    queryParams.set('start_time', driver.start_time);
    queryParams.set('end_time', driver.end_time);
    queryParams.set('origin', driver.origin);
    queryParams.set('destination', driver.destination);
    return `${originUrl}?${queryParams.toString()}`;
}

// Cópia rápida do link do WhatsApp direto do marcador do mapa CCO
function copyDriverLinkFromMap(nome, cpf) {
    if (!db.drivers_map) return;
    const driver = db.drivers_map.find(d => d.nome === nome && String(d.cpf) === String(cpf));
    if (!driver) return;
    
    const finalUrl = getDriverUrl(driver);
    navigator.clipboard.writeText(finalUrl)
        .then(() => {
            showToast("Link Copiado!", `O link de login do motorista ${driver.nome} foi copiado!`, "success");
        })
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = finalUrl;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Link Copiado!", `O link de login do motorista ${driver.nome} foi copiado!`, "success");
        });
}

// Solicitar posição enviando link de login direto por WhatsApp
function requestPositionByWhatsapp(nome, telefone, cpf) {
    if (!db.drivers_map) return;
    const driver = db.drivers_map.find(d => d.nome === nome && String(d.cpf) === String(cpf));
    if (!driver) return;
    
    const finalUrl = getDriverUrl(driver);
    const cleanPhone = String(telefone || '').replace(/\D/g, '');
    const message = `Olá ${driver.nome}, por favor clique no link abaixo para compartilhar sua posição no mapa de transporte do evento:\n\n${finalUrl}\n\nObrigado!`;
    const whatsappUrl = `https://api.whatsapp.com/send?phone=55${cleanPhone}&text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
}

// Alternar visualização de mapa CCO em tela cheia (expandir/recolher sidebar)
let isCcoMapFullscreen = false;
function toggleCcoMapFullscreen() {
    const sidebar = document.getElementById('cco-tracking-sidebar');
    const container = document.getElementById('cco-tracking-map-container');
    const expandIcon = document.getElementById('btn-cco-map-expand-icon');
    const expandText = document.getElementById('btn-cco-map-expand-text');
    
    if (!sidebar || !container) return;
    
    isCcoMapFullscreen = !isCcoMapFullscreen;
    
    if (isCcoMapFullscreen) {
        sidebar.classList.add('hidden');
        container.classList.remove('lg:col-span-2');
        container.classList.add('lg:col-span-3');
        if (expandIcon) {
            expandIcon.classList.remove('fa-expand');
            expandIcon.classList.add('fa-compress');
        }
        if (expandText) expandText.textContent = 'Recolher';
    } else {
        sidebar.classList.remove('hidden');
        container.classList.remove('lg:col-span-3');
        container.classList.add('lg:col-span-2');
        if (expandIcon) {
            expandIcon.classList.remove('fa-compress');
            expandIcon.classList.add('fa-expand');
        }
        if (expandText) expandText.textContent = 'Expandir';
    }
    
    // Atualizar Leaflet tiles
    if (trackingMap) {
        setTimeout(() => {
            trackingMap.invalidateSize();
        }, 150);
    }
}

// =======================================================
// --- SIMULADOR DE VANS E DIMENSIONAMENTO DE FROTA ---
// =======================================================
let vanDemandChart = null;

function recalculateVanSimulation() {
    const capacitySelect = document.getElementById('sim-van-capacity');
    const dateSelect = document.getElementById('sim-van-date');
    const directionSelect = document.getElementById('sim-van-direction');
    const tbody = document.getElementById('sim-van-tbody');
    const lblTotalVans = document.getElementById('lbl-sim-total-vans');
    
    if (!capacitySelect || !dateSelect || !directionSelect || !tbody) return;
    
    const capacity = parseInt(capacitySelect.value) || 15;
    const dateVal = dateSelect.value;
    const direction = directionSelect.value; // BOTH, VAI, VEM
    
    tbody.innerHTML = '';
    
    // Filtrar agendamentos ativos na data selecionada
    let eventBookings = db.bookings.filter(b => b.data === dateVal && b.status !== 'Cancelado');
    
    // Filtrar por direção/escopo
    if (direction === 'VAI') {
        eventBookings = eventBookings.filter(b => b.destino === getEventLocationName());
    } else if (direction === 'VEM') {
        eventBookings = eventBookings.filter(b => b.origem === getEventLocationName());
    }
    
    // Agrupar passageiros por horário de viagem
    const timeGroups = {};
    eventBookings.forEach(b => {
        const time = String(b.hora || '00:00').substring(0, 5).trim();
        if (!time) return;
        
        if (!timeGroups[time]) {
            timeGroups[time] = 0;
        }
        timeGroups[time]++;
    });
    
    // Ordenar horários de forma cronológica
    const sortedTimes = Object.keys(timeGroups).sort((a, b) => {
        return a.localeCompare(b);
    });
    
    let grandTotalVans = 0;
    const chartLabels = [];
    const chartDataPassengers = [];
    const chartDataVans = [];
    
    if (sortedTimes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-gray-500 font-semibold">Nenhum agendamento ativo encontrado para esta combinação de filtros.</td></tr>`;
        if (lblTotalVans) lblTotalVans.textContent = '0';
        updateVanDemandChart([], [], []);
        return;
    }
    
    sortedTimes.forEach(time => {
        const agendados = timeGroups[time];
        const vehicles = Math.ceil(agendados / capacity);
        const seats = vehicles * capacity;
        const ociosos = seats - agendados;
        const efficiency = seats > 0 ? ((agendados / seats) * 100).toFixed(1) : "0.0";
        
        grandTotalVans += vehicles;
        
        // Dados do gráfico
        chartLabels.push(time);
        chartDataPassengers.push(agendados);
        chartDataVans.push(vehicles);
        
        // Cores e badges baseados em eficiência
        let effClass = 'text-emerald-400 font-bold';
        if (parseFloat(efficiency) < 50) {
            effClass = 'text-red-400 font-bold';
        } else if (parseFloat(efficiency) < 80) {
            effClass = 'text-amber-400 font-bold';
        }
        
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-900/20 border-b border-gray-900 transition-colors";
        tr.innerHTML = `
            <td class="py-3 px-4 font-bold text-gray-300 flex items-center gap-1.5"><i class="fa-solid fa-clock text-[10px] text-gray-500"></i>${time}</td>
            <td class="py-3 px-4 text-center text-white font-mono">${agendados}</td>
            <td class="py-3 px-4 text-center text-indigo-400 font-mono font-bold">${vehicles}</td>
            <td class="py-3 px-4 text-center text-gray-400 font-mono">${seats}</td>
            <td class="py-3 px-4 text-center text-gray-500 font-mono">${ociosos}</td>
            <td class="py-3 px-4 text-right font-mono ${effClass}">${efficiency}%</td>
        `;
        tbody.appendChild(tr);
    });
    
    if (lblTotalVans) {
        lblTotalVans.textContent = grandTotalVans;
    }
    
    updateVanDemandChart(chartLabels, chartDataPassengers, chartDataVans);
}

function updateVanDemandChart(labels, passengerData, vanData) {
    const ctx = document.getElementById('chart-van-demand');
    if (!ctx) return;
    
    if (vanDemandChart) {
        vanDemandChart.destroy();
    }
    
    vanDemandChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Passageiros Agendados',
                    data: passengerData,
                    backgroundColor: 'rgba(59, 130, 246, 0.65)', // Blue-500/65
                    borderColor: 'rgb(59, 130, 246)',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    yAxisID: 'y'
                },
                {
                    label: 'Veículos Necessários',
                    data: vanData,
                    type: 'line',
                    borderColor: 'rgb(249, 115, 22)', // Orange-500
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointBackgroundColor: 'rgb(249, 115, 22)',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.3,
                    yAxisID: 'y2'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9ca3af', // Gray-400
                        font: { size: 10, weight: 'bold' }
                    }
                },
                tooltip: {
                    padding: 10,
                    cornerRadius: 8,
                    titleFont: { size: 12, weight: 'bold' },
                    bodyFont: { size: 11 }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(75, 85, 99, 0.1)' },
                    ticks: { color: '#9ca3af', font: { size: 10, weight: 'bold' } }
                },
                y: {
                    position: 'left',
                    grid: { color: 'rgba(75, 85, 99, 0.1)' },
                    ticks: { color: '#9ca3af', font: { size: 10, weight: 'bold' } },
                    title: {
                        display: true,
                        text: 'Quantidade de Passageiros',
                        color: '#9ca3af',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                y2: {
                    position: 'right',
                    grid: { drawOnChartArea: false }, // avoid double lines
                    ticks: { color: '#f97316', font: { size: 10, weight: 'bold' }, stepSize: 1 },
                    title: {
                        display: true,
                        text: 'Quantidade de Veículos',
                        color: '#f97316',
                        font: { size: 10, weight: 'bold' }
                    }
                }
            }
        }
    });
}

// --- SISTEMA DE APRESENTA�!ÒO DE SLIDES INTERATIVO ---
const presentationData = {
    passenger: {
        title: "Passageiro",
        colorClass: "blue",
        bgClass: "bg-blue-600",
        icon: "fa-user-clock",
        borderColor: "border-blue-500/30",
        slides: [
            {
                title: "�x& Agendamento Individual",
                desc: "Acesse a aba <strong>'Portal de Pré-Agendamento'</strong>. Selecione se o agendamento é para <strong>'Mim mesmo'</strong> ou para <strong>'Outro Colaborador'</strong>. Ao agendar para terceiros, informe também o seu CPF/Matrícula como solicitante para validação e auditoria.",
                badge: "Etapa 1",
                mockup: `
                    <div class="bg-gray-900/60 border border-blue-500/20 rounded-xl p-3 space-y-1.5 text-left text-[11px] font-sans">
                        <div class="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Formulário de Pré-Agendamento</div>
                        <div class="grid grid-cols-2 gap-2 mt-1">
                            <div class="bg-gray-950 p-1.5 rounded border border-gray-800">
                                <span class="text-gray-500 block text-[8px] uppercase">Passageiro (CPF/Matrícula)</span>
                                <span class="text-white font-semibold">123.456.789-00</span>
                            </div>
                            <div class="bg-gray-950 p-1.5 rounded border border-gray-850">
                                <span class="text-indigo-400 block text-[8px] uppercase font-bold">Solicitante (Matrícula)</span>
                                <span class="text-white font-semibold">82093 (Ponto Focal)</span>
                            </div>
                        </div>
                        <div class="bg-emerald-500/10 border border-emerald-500/20 p-1.5 rounded text-emerald-400 text-[10px]">
                            <i class="fa-solid fa-shield-halved mr-1"></i> Solicitante Autorizado. Agendamento permitido e logado.
                        </div>
                    </div>
                `
            },
            {
                title: "�x� Multiplicação para Vários Dias",
                desc: "Se você precisar de transporte para múltiplos dias do evento, o sistema permite <strong>replicar o agendamento</strong> em massa. Basta marcar os dias desejados no calendário e clicar em gerar agendamento.",
                badge: "Etapa 2",
                mockup: `
                    <div class="bg-gray-900/60 border border-blue-500/20 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Replicação de Datas</div>
                        <div class="flex items-center space-x-2">
                            <span class="bg-blue-600 text-white font-bold px-2 py-0.5 rounded text-[9px]">�S 12/Set</span>
                            <span class="bg-blue-600 text-white font-bold px-2 py-0.5 rounded text-[9px]">�S 13/Set</span>
                            <span class="bg-blue-600 text-white font-bold px-2 py-0.5 rounded text-[9px]">�S 14/Set</span>
                            <span class="bg-gray-800 text-gray-500 font-bold px-2 py-0.5 rounded text-[9px]">15/Set</span>
                        </div>
                        <p class="text-[10px] text-gray-400">O sistema criará reservas individuais para cada um dos dias selecionados de uma só vez.</p>
                    </div>
                `
            },
            {
                title: "�x}x️ Cartão de Embarque Digital",
                desc: "Após a confirmação, o sistema gera o seu <strong>Cartão de Embarque Digital com QR Code</strong>. Salve o comprovante em PDF ou envie os dados de reserva diretamente para seu celular via WhatsApp para agilizar o embarque no evento.",
                badge: "Etapa 3",
                mockup: `
                    <div class="bg-gray-950 border border-blue-500/30 rounded-xl p-3 flex items-center justify-between text-left">
                        <div class="space-y-1 text-[10px]">
                            <div class="text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold uppercase w-max">RESERVA CONFIRMADA</div>
                            <div class="text-white font-bold">BILHETE DE EMBARQUE</div>
                            <div class="text-gray-400">Saída: Jardim Botânico</div>
                            <div class="text-gray-400">Destino: Estúdios Globo</div>
                        </div>
                        <div class="bg-white p-1 rounded-lg">
                            <i class="fa-solid fa-qrcode text-gray-950 text-2xl"></i>
                        </div>
                    </div>
                `
            },
            {
                title: "�x� Check-in Presencial (Totem)",
                desc: "Se você não fez o pré-agendamento, pode utilizar o <strong>Totem de Check-in Presencial</strong> na base física de embarque. Digite seu CPF/Matrícula na tela e seu bilhete com o QR Code será impresso ou gerado digitalmente de imediato.",
                badge: "Etapa 4",
                mockup: `
                    <div class="bg-gray-900/60 border border-blue-500/20 rounded-xl p-3 text-left space-y-2 text-[11px]">
                        <div class="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Totem Digital Local</div>
                        <div class="bg-gray-950 p-2 rounded border border-gray-800 text-center font-bold text-gray-400 text-xs">
                            [ Digite sua Matrícula ou CPF ]
                        </div>
                        <div class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1 rounded text-center text-[10px]">
                            Check-in Imediato
                        </div>
                    </div>
                `
            }
        ]
    },
    representative: {
        title: "Representante de Área",
        colorClass: "indigo",
        bgClass: "bg-indigo-600",
        icon: "fa-users-cog",
        borderColor: "border-indigo-500/30",
        slides: [
            {
                title: "�x� Credenciamento Coletivo",
                desc: "Como representante, você pode carregar uma base em massa de colaboradores no sistema. Vá até a aba <strong>'Importar Base'</strong> e faça o upload de uma lista de Excel/CSV para autorizar o credenciamento de toda a sua equipe.",
                badge: "Etapa 1",
                mockup: `
                    <div class="bg-gray-900/60 border border-indigo-500/20 rounded-xl p-3 text-left text-[11px] space-y-1.5">
                        <div class="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">Painel de Upload - Credenciados</div>
                        <div class="border-2 border-dashed border-gray-800 rounded-lg p-3 text-center text-gray-500 hover:border-indigo-500/40 transition">
                            <i class="fa-solid fa-cloud-arrow-up text-lg mb-1 text-indigo-400"></i>
                            <div class="text-[9px]">Arraste a base de credenciamento (.xlsx)</div>
                        </div>
                    </div>
                `
            },
            {
                title: "�x� Planilha de Modelo Oficial",
                desc: "Para agendar transporte em lote, utilize nossa <strong>Planilha Modelo CSV</strong>. Faça o download direto no portal de agendamento em lote, preencha os CPFs, datas e horários dos seus colaboradores nos campos corretos.",
                badge: "Etapa 2",
                mockup: `
                    <div class="bg-gray-900/60 border border-indigo-500/20 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">Modelo CSV Padronizado</div>
                        <div class="bg-gray-950 p-1.5 rounded border border-gray-800 flex items-center justify-between">
                            <span class="text-white text-[9px] font-mono"><i class="fa-regular fa-file-excel text-green-500 mr-1.5"></i>Modelo_Agendamento_CCO.csv</span>
                            <span class="bg-indigo-600 text-white font-bold px-2 py-0.5 rounded text-[8px] uppercase">Baixar</span>
                        </div>
                    </div>
                `
            },
            {
                title: "�x� Agendamento em Lote (Em Massa)",
                desc: "Arraste o arquivo CSV preenchido de volta para a aba <strong>'Agendamento em Lote'</strong>. O sistema lerá e validará as matrículas com a base cadastrada, criará agendamentos duplicados ou atualizações, e gerará os bilhetes de transporte em lote sem burocracia.",
                badge: "Etapa 3",
                mockup: `
                    <div class="bg-gray-955 border border-indigo-500/30 rounded-xl p-3 text-left space-y-2">
                        <div class="flex justify-between items-center text-[10px]">
                            <span class="text-white font-bold">Processando Agendamento Coletivo...</span>
                            <span class="text-indigo-400 font-bold font-mono">100%</span>
                        </div>
                        <div class="w-full bg-gray-900 rounded-full h-1.5">
                            <div class="bg-indigo-500 h-1.5 rounded-full" style="width: 100%"></div>
                        </div>
                        <div class="text-[9px] text-emerald-400 font-semibold flex items-center">
                            <i class="fa-solid fa-circle-check mr-1"></i> Sucesso: 45 agendamentos criados com sucesso!
                        </div>
                    </div>
                `
            }
        ]
    },
    operator: {
        title: "Operador de Transportes",
        colorClass: "teal",
        bgClass: "bg-teal-600",
        icon: "fa-bus-simple",
        borderColor: "border-teal-500/30",
        slides: [
            {
                title: "�x9 Gestão de Fila de Despacho",
                desc: "Na aba <strong>'Operação (Despacho)'</strong>, você monitora a fila em tempo real. Veja a quantidade de pessoas agendadas para cada horário e base física de partida, organizando o fluxo de forma integrada.",
                badge: "Etapa 1",
                mockup: `
                    <div class="bg-gray-900/60 border border-teal-500/20 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-teal-400 font-bold uppercase tracking-wider">Fila da Base: Jardim Botânico</div>
                        <div class="bg-gray-950 p-2 rounded border border-gray-800 flex justify-between items-center">
                            <div>
                                <span class="text-white font-bold">Van (08:30)</span>
                                <span class="text-gray-500 block text-[9px]">Destino: Estúdios Globo</span>
                            </div>
                            <span class="bg-teal-500/20 text-teal-400 font-bold px-2 py-0.5 rounded text-[10px]">12/15 Assentos</span>
                        </div>
                    </div>
                `
            },
            {
                title: "�a� Registrar Embarque e Tratar No-show",
                desc: "Quando o passageiro se apresenta no veículo, clique no botão azul <strong>'Embarcar'</strong> para confirmar a presença dele. Caso o passageiro não apareça, marque como <strong>'No-show'</strong>. O assento no veículo é liberado automaticamente e recalculado no painel global.",
                badge: "Etapa 2",
                mockup: `
                    <div class="bg-gray-900/60 border border-teal-500/20 rounded-xl p-3 text-left text-[11px] space-y-1.5">
                        <div class="flex justify-between items-center text-[10px] text-white">
                            <span class="font-bold">Colaborador: João Silva</span>
                            <span class="text-gray-500">Agendamento: 08:30</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 mt-1">
                            <button class="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1 rounded text-[10px] transition">Embarcar</button>
                            <button class="bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold py-1 rounded text-[10px] transition">No-show</button>
                        </div>
                    </div>
                `
            },
            {
                title: "�xa� Acionamento de Carros Extras",
                desc: "Em caso de lotação de passageiros sem agendamento ou emergência de produção, você pode criar viagens com <strong>'Carro Extra'</strong> clicando no botão no painel operacional. Preencha os dados e libere a saída da van ou veículo de imediato.",
                badge: "Etapa 3",
                mockup: `
                    <div class="bg-gray-955 border border-teal-500/30 rounded-xl p-3 text-left space-y-2 text-[11px]">
                        <div class="text-[10px] text-teal-400 font-bold uppercase tracking-wider">Acionar Viagem Extra</div>
                        <div class="grid grid-cols-2 gap-2">
                            <div class="bg-gray-900 p-1 rounded border border-gray-800 text-gray-400 text-[9px]">Veículo: Van (15 lug)</div>
                            <div class="bg-gray-900 p-1 rounded border border-gray-800 text-gray-400 text-[9px]">Placa: XYZ9A99</div>
                        </div>
                        <div class="bg-teal-600 text-white font-bold py-1 rounded text-center text-[10px]">
                            Confirmar Saída
                        </div>
                    </div>
                `
            }
        ]
    },
    driver: {
        title: "Motorista",
        colorClass: "emerald",
        bgClass: "bg-emerald-600",
        icon: "fa-truck-steering",
        borderColor: "border-emerald-500/30",
        slides: [
            {
                title: "�x Login Simplificado por CPF",
                desc: "No portal inicial do Conexão Transportes, acesse a aba <strong>'Motorista'</strong>. Digite o seu CPF. Se os dados constarem no credenciamento do CCO, o sistema abrirá o seu portal de controle imediatamente.",
                badge: "Etapa 1",
                mockup: `
                    <div class="bg-gray-900/60 border border-emerald-500/20 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Acesso do Motorista</div>
                        <div class="space-y-1">
                            <span class="text-gray-500 text-[8px] uppercase block">CPF do Condutor</span>
                            <input type="text" class="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-white text-[10px]" value="456.789.012-34" disabled>
                        </div>
                    </div>
                `
            },
            {
                title: "�xa� Confirmação dos Dados do Veículo",
                desc: "Confirme a placa do seu veículo, empresa contratada (ex: Coopertramo) e tipo de veículo. Digite e confirme essas informações básicas para inicializar o seu rastreamento operacional no evento.",
                badge: "Etapa 2",
                mockup: `
                    <div class="bg-gray-900/60 border border-emerald-500/20 rounded-xl p-3 text-left text-[11px] space-y-1">
                        <div class="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Veículo do Motorista</div>
                        <div class="text-white font-semibold">Placa: RIR2D45 (Coopertramo)</div>
                        <div class="text-gray-400 text-[9px]">Tipo: Van Executiva (15 Assentos)</div>
                    </div>
                `
            },
            {
                title: "�x� Conectar GPS e Enviar Sinal",
                desc: "Clique no botão verde <strong>'Conectar GPS'</strong> e permita o acesso à geolocalização no navegador do celular. A partir de então, o sistema passará a <strong>transmitir sua posição física em tempo real</strong> para o CCO.",
                badge: "Etapa 3",
                mockup: `
                    <div class="bg-gray-955 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between text-[11px]">
                        <div class="space-y-0.5">
                            <span class="text-emerald-400 font-bold block"><i class="fa-solid fa-circle animate-pulse mr-1"></i>SINAL ATIVO</span>
                            <span class="text-gray-500 text-[9px] font-mono">Lat: -22.9032 Lon: -43.1735</span>
                        </div>
                        <div class="bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 text-[9px] px-2 py-1 rounded font-bold uppercase">
                            Transmitindo
                        </div>
                    </div>
                `
            },
            {
                title: "⏱️ Iniciar e Encerrar Corridas",
                desc: "Quando der a partida física no veículo com passageiros, clique em <strong>'Início Corrida'</strong> para disparar o relógio de trajeto. Ao desembarcar os passageiros, clique em <strong>'Término Corrida'</strong> para registrar a viagem.",
                badge: "Etapa 4",
                mockup: `
                    <div class="bg-gray-900/60 border border-emerald-500/20 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Controle do Trajeto</div>
                        <div class="grid grid-cols-2 gap-2">
                            <button class="bg-emerald-600 text-white font-bold py-1.5 rounded text-[10px]">Início Corrida</button>
                            <button class="bg-rose-600/30 text-rose-400 font-bold py-1.5 rounded text-[10px]" disabled>Término Corrida</button>
                        </div>
                        <p class="text-[9px] text-gray-500">Mantenha a tela do seu celular ligada durante as corridas para evitar suspensão do sinal de GPS pelo celular.</p>
                    </div>
                `
            }
        ]
    },
    manager: {
        title: "Acesso Master (Administrador)",
        colorClass: "amber",
        bgClass: "bg-amber-600",
        icon: "fa-sliders-h",
        borderColor: "border-amber-500/30",
        slides: [
            {
                title: "�x` Gráficos Operacionais e Financeiros",
                desc: "Como Master, acesse a aba <strong>'Gestão & Analytics'</strong>. Avalie os gráficos de ocupação da frota, controle de aderência dos agendamentos e o **Simulador de Perdas Financeiras** geradas por no-show.",
                badge: "Etapa 1",
                mockup: `
                    <div class="bg-gray-900/60 border border-amber-500/20 rounded-xl p-3 text-left text-[11px] space-y-1.5">
                        <div class="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Simulador de Perdas Financeiras</div>
                        <div class="bg-gray-950 p-2 rounded border border-gray-800 flex justify-between items-center">
                            <div>
                                <span class="text-gray-500 block text-[8px] uppercase">Custo de Assentos Ociosos</span>
                                <span class="text-red-400 font-bold text-xs">R$ 1.850,00</span>
                            </div>
                            <div class="text-right">
                                <span class="text-gray-500 block text-[8px] uppercase">Taxa de No-Show</span>
                                <span class="text-amber-400 font-bold text-xs">15.4%</span>
                            </div>
                        </div>
                    </div>
                `
            },
            {
                title: "�x�️ Rastreamento Live e Filtros de Serviço",
                desc: "Monitore a localização em tempo real da frota de motoristas ativos no **mapa Leaflet**. Filtre a exibição de acordo com o tipo de serviço contratado (Vans de Produção, Vai e Vem Geral ou Carros Especiais).",
                badge: "Etapa 2",
                mockup: `
                    <div class="bg-gray-900/60 border border-amber-500/20 rounded-xl p-3 text-left text-[11px] space-y-1.5">
                        <div class="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Rastreamento de Frota (Leaflet)</div>
                        <div class="bg-gray-955 h-10 rounded border border-gray-850 flex items-center justify-center text-gray-500 text-[10px]">
                            <i class="fa-solid fa-map-location-dot mr-1.5 text-emerald-400"></i> Mapa de Geoposicionamento Ativo
                        </div>
                    </div>
                `
            },
            {
                title: "�x� Auditoria, Sessões Ativas e Segurança",
                desc: "Na aba <strong>'Administração de Acessos'</strong>, você audita sessões ativas e acompanha o **Log de Auditoria de Agendamentos** em tempo real (quem agendou quem e quando). Gerencie também os **Pontos Focais Autorizados** para agendamento de terceiros e derrube sessões suspeitas.",
                badge: "Etapa 3",
                mockup: `
                    <div class="bg-gray-900/60 border border-amber-500/20 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Log de Auditoria de Agendamento</div>
                        <div class="bg-gray-950 p-2 rounded border border-gray-800 space-y-1 text-[9px]">
                            <div class="flex justify-between font-bold text-white">
                                <span>Ação: Agendou (Site)</span>
                                <span class="text-green-400">Autorizado</span>
                            </div>
                            <div class="text-gray-400">Passageiro: João Silva (Matrícula: 5543)</div>
                            <div class="text-gray-500">Solicitante: Admin Master (Matrícula: 123456)</div>
                        </div>
                    </div>
                `
            },
            {
                title: "�x� Integração e Status SMTP",
                desc: "Configure as conexões de e-mail conectando a aplicação ao servidor SMTP (através do servidor Python local na porta 8000). Isso permite que o sistema envie e-mails reais de confirmação de agendamentos e alertas automáticos de embarque aos colaboradores.",
                badge: "Etapa 4",
                mockup: `
                    <div class="bg-gray-955 border border-amber-500/30 rounded-xl p-3 text-left text-[11px] space-y-2">
                        <div class="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Status do Servidor Local</div>
                        <div class="flex items-center space-x-2">
                            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span class="text-white font-bold">Servidor Python Ativo (Porta 8000)</span>
                        </div>
                        <p class="text-[9px] text-gray-500">Envio de e-mails automatizado habilitado via smtp_config.json.</p>
                    </div>
                `
            }
        ]
    }
};

let currentPresRole = "passenger";
let currentPresSlide = 0;

function openPresentation(role) {
    currentPresRole = role || "passenger";
    currentPresSlide = 0;
    
    // Mostra o modal
    const modal = document.getElementById("modal-presentation");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
    
    // Atualiza classes das abas de perfil do modal
    updatePresentationTabs();
    
    // Renderiza slides
    renderPresentationSlides();
}

function closePresentation() {
    const modal = document.getElementById("modal-presentation");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function switchPresentationRole(role) {
    currentPresRole = role;
    currentPresSlide = 0;
    updatePresentationTabs();
    renderPresentationSlides();
}

function updatePresentationTabs() {
    const tabs = document.querySelectorAll(".pres-tab");
    tabs.forEach(tab => {
        tab.className = "pres-tab px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition border border-gray-800 bg-gray-900/50 text-gray-400 hover:text-white";
    });
    
    const activeTab = document.getElementById(`pres-tab-${currentPresRole}`);
    if (activeTab) {
        const data = presentationData[currentPresRole];
        activeTab.className = `pres-tab px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition border border-transparent ${data.bgClass} text-white shadow-lg`;
    }
}

function renderPresentationSlides() {
    const data = presentationData[currentPresRole];
    const slide = data.slides[currentPresSlide];
    
    // Atualizar ícone do cabeçalho
    const headerIconContainer = document.getElementById("pres-header-icon-container");
    const headerIcon = document.getElementById("pres-header-icon");
    
    if (headerIconContainer && headerIcon) {
        headerIconContainer.className = `p-2.5 rounded-xl text-white ${data.bgClass}`;
        headerIcon.className = `fa-solid ${data.icon} text-xl animate-pulse`;
    }
    
    // Container do slide
    const slideContainer = document.getElementById("pres-slide-container");
    if (slideContainer) {
        slideContainer.innerHTML = `
            <div class="space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] ${data.bgClass} text-white font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                        ${slide.badge}
                    </span>
                    <span class="text-[10px] text-gray-500 font-bold">
                        ${data.title}
                    </span>
                </div>
                
                <h4 class="text-sm font-black text-white leading-tight">
                    ${slide.title}
                </h4>
                
                <p class="text-xs text-gray-300 leading-relaxed font-sans">
                    ${slide.desc}
                </p>
            </div>
            
            <!-- Mockup Visual Dinâmico -->
            <div class="pt-2">
                ${slide.mockup}
            </div>
        `;
    }
    
    // Renderizar dots
    const dotsContainer = document.getElementById("pres-dots-container");
    if (dotsContainer) {
        dotsContainer.innerHTML = "";
        data.slides.forEach((_, idx) => {
            const dot = document.createElement("button");
            dot.className = `w-2 h-2 rounded-full transition-all duration-300 ${idx === currentPresSlide ? (data.bgClass + ' w-4') : 'bg-gray-700'}`;
            dot.onclick = () => {
                currentPresSlide = idx;
                renderPresentationSlides();
            };
            dotsContainer.appendChild(dot);
        });
    }
    
    // Ajustar botões Anterior / Próximo
    const btnPrev = document.getElementById("pres-btn-prev");
    if (btnPrev) {
        btnPrev.disabled = currentPresSlide === 0;
    }
    
    const btnNextText = document.getElementById("pres-btn-next-text");
    const btnNextIcon = document.getElementById("pres-btn-next-icon");
    const btnNext = document.getElementById("pres-btn-next");
    
    if (btnNext) {
        btnNext.className = `hover:brightness-110 text-white font-bold px-4 py-2 rounded-xl text-xs transition duration-200 flex items-center space-x-1.5 shadow-lg ${data.bgClass}`;
    }
    
    if (btnNextText && btnNextIcon) {
        if (currentPresSlide === data.slides.length - 1) {
            btnNextText.textContent = "Concluir";
            btnNextIcon.className = "fa-solid fa-check";
        } else {
            btnNextText.textContent = "Próximo";
            btnNextIcon.className = "fa-solid fa-arrow-right";
        }
    }
}

function nextPresentationSlide() {
    const data = presentationData[currentPresRole];
    if (currentPresSlide < data.slides.length - 1) {
        currentPresSlide++;
        renderPresentationSlides();
    } else {
        closePresentation();
    }
}

function prevPresentationSlide() {
    if (currentPresSlide > 0) {
        currentPresSlide--;
        renderPresentationSlides();
    }
}

async function refreshLiveDbViewer() {
    const tbody = document.getElementById('db-live-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-xs text-blue-400"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Buscando dados no Render...</td></tr>';
    
    try {
        const res = await fetch(getApiUrl() + '/bookings');
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        
        document.getElementById('db-live-count').textContent = data.length;
        document.getElementById('db-live-time').textContent = new Date().toLocaleTimeString();
        document.getElementById('db-live-status').innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i> Conectado';
        
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-xs text-gray-500">Nenhum agendamento encontrado no banco.</td></tr>';
            return;
        }
        
        // Renderizar os últimos 50 do mais recente para o mais antigo
        tbody.innerHTML = data.slice(-50).reverse().map(b => `
        <tr>
            <td class="p-3 text-xs text-gray-400 border-b border-gray-800/50 font-mono">${b.id || '-'}</td>
            <td class="p-3 text-xs text-white border-b border-gray-800/50 font-bold">${b.passageiro_nome} <span class="text-[9px] text-gray-500 font-normal block">CPF: ${b.passageiro_matricula}</span></td>
            <td class="p-3 text-xs text-gray-300 border-b border-gray-800/50">${b.base_saida} <i class="fa-solid fa-arrow-right text-[8px] mx-1 text-gray-600"></i> ${b.base_destino}<br><span class="text-[9px] text-indigo-400">${b.data_viagem} às ${b.horario_saida}</span></td>
            <td class="p-3 border-b border-gray-800/50"><span class="status-pill text-emerald-400 px-2 py-1 rounded text-[9px] font-bold uppercase">${b.status}</span></td>
        </tr>
        `).join('');
        
    } catch(err) {
        console.error("Erro Live DB:", err);
        document.getElementById('db-live-status').innerHTML = '<i class="fa-solid fa-circle-xmark mr-1 text-rose-500"></i> Erro de Conexão';
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-xs text-rose-500">Erro ao acessar banco de dados. A API está online?</td></tr>';
    }
}

// =========================================================================
// WEBSOCKETS (REAL-TIME CHECK-IN)
// =========================================================================
if (typeof io !== 'undefined') {
    const socket = io(getApiUrl().replace('/api', ''));
    
    socket.on('booking_checked_in', (updatedBooking) => {
        const localBooking = db.bookings.find(b => b.id === updatedBooking.id);
        if (localBooking) {
            localBooking.status = 'Embarcado';
            localBooking.status_checkin = updatedBooking.status_checkin || 'Sincronizado';
            
            // Atualiza a UI se o gestor/motorista estiver na tela de opera��o
            if (typeof refreshOperationList === 'function' && currentTab === 'operation') {
                refreshOperationList();
            }
        }
    });
}






// --- DRILL-DOWN ANALITICO ---
window.currentDrillDownData = [];

window.openDrillDownModal = function(areaName, statusType) {
    const titleEl = document.getElementById('drilldown-title');
    const subtitleEl = document.getElementById('drilldown-subtitle');
    const tbody = document.getElementById('drilldown-tbody');
    const countEl = document.getElementById('drilldown-count');
    
    if(!titleEl || !tbody) return;

    // Traduzir o status
    let typeName = '';
    let bookingsFiltro = [];
    const activeDates = getEventDates();
    let allValidBookings = db.bookings.filter(b => activeDates.includes(b.data) && isValidBookingForReports(b));

    // Se for 'OUTROS', filtra aqueles cujo N1 = OUTROS
    // Se for nome exato, filtra por N1 == areaName
    const areaBookings = allValidBookings.filter(b => {
        const p = findPerson(b.matricula || b.cpf) || b;
        const n1 = getN1Area(p);
        return areaName === 'OUTROS' ? (n1 === 'OUTROS' || !n1) : (n1 === areaName);
    });

    if (statusType === 'planejado') {
        typeName = 'Agendados (Planejado)';
        bookingsFiltro = areaBookings.filter(b => b.status === 'Agendado' || b.status === 'No-Show' || b.status === 'Embarcado');
    } else if (statusType === 'boarded') {
        typeName = 'Embarques no Hor�rio (OK)';
        bookingsFiltro = areaBookings.filter(b => b.status === 'Embarcado' && b.status_checkin === 'No Hor�rio');
    } else if (statusType === 'boarded_offtime') {
        typeName = 'Embarques Fora de Hor�rio';
        bookingsFiltro = areaBookings.filter(b => b.status === 'Embarcado' && (b.status_checkin === 'Adiantado' || b.status_checkin === 'Atrasado'));
    } else if (statusType === 'encaixe') {
        typeName = 'Encaixes (Sem Agendamento Inicial)';
        bookingsFiltro = areaBookings.filter(b => b.status === 'Embarcado' && b.status_checkin === 'Encaixe');
    } else if (statusType === 'noshow') {
        typeName = 'No-Show (Faltantes)';
        bookingsFiltro = areaBookings.filter(b => b.status === 'No-Show');
    } else if (statusType === 'naoutilizou') {
        typeName = 'N�o Utilizou';
        bookingsFiltro = areaBookings.filter(b => b.status === 'Agendado' && (new Date(b.data + 'T' + b.hora) < new Date()));
    }
    
    // Sort por data/hora
    bookingsFiltro.sort((a, b) => {
        const d1 = new Date(a.data + 'T' + a.hora);
        const d2 = new Date(b.data + 'T' + b.hora);
        return d1 - d2;
    });

    window.currentDrillDownData = bookingsFiltro;

    titleEl.textContent = areaName;
    subtitleEl.textContent = typeName;
    countEl.textContent = bookingsFiltro.length + " registro(s)";
    tbody.innerHTML = '';

    if (bookingsFiltro.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-gray-500 text-xs">Nenhum registro encontrado.</td></tr>';
    } else {
        bookingsFiltro.forEach(b => {
            const passId = (b.matricula || b.cpf || '-').replace(/\D/g, '');
            const maskedId = passId.length === 11 ? '***.' + passId.substring(3,6) + '.' + passId.substring(6,9) + '-**' : passId;
            const pNome = b.nome || 'N�o identificado';
            
            let statusPill = `<span class="status-pill text-emerald-400 border-emerald-500/20 px-2 py-0.5 text-[9px] uppercase">${b.status}</span>`;
            if (b.status === 'Agendado') statusPill = `<span class="status-pill text-blue-400 border-blue-500/20 px-2 py-0.5 text-[9px] uppercase">Agendado</span>`;
            if (b.status === 'No-Show') statusPill = `<span class="status-pill text-red-400 border-red-500/20 px-2 py-0.5 text-[9px] uppercase">No-Show</span>`;
            
            if (b.status_checkin) {
                statusPill += `<br><span class="text-[8px] text-gray-400 mt-0.5 block">${b.status_checkin}</span>`;
            }

            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-800/30 transition border-b border-gray-800/30";
            tr.innerHTML = `
                <td class="py-2.5 px-4">
                    <div class="font-bold text-white text-xs">${safeEscapeHtml(pNome)}</div>
                    <div class="text-[9px] text-gray-500 font-mono">${safeEscapeHtml(maskedId)}</div>
                </td>
                <td class="py-2.5 px-4">${statusPill}</td>
                <td class="py-2.5 px-4 text-xs text-gray-300">
                    ${safeEscapeHtml(b.origem || 'EG')} <i class="fa-solid fa-arrow-right text-[8px] mx-1 text-gray-600"></i> ${safeEscapeHtml(b.destino || 'Local Evento')}
                </td>
                <td class="py-2.5 px-4 text-xs font-mono text-indigo-300">${safeEscapeHtml(b.data || '')} às ${safeEscapeHtml(b.hora || '')}</td>
                <td class="py-2.5 px-4 text-right text-[10px] text-gray-400">${safeEscapeHtml(b.solicitante_nome || b.solicitante || b.solicitante_id || '-')}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    document.getElementById('drilldown-modal').classList.remove('hidden');
}

window.closeDrillDownModal = function() {
    document.getElementById('drilldown-modal').classList.add('hidden');
}

window.exportDrillDownCSV = function() {
    if(!window.currentDrillDownData || window.currentDrillDownData.length === 0) return;
    
    let csv = "NOME,IDENTIFICADOR,STATUS,DETALHE_CHECKIN,ORIGEM,DESTINO,DATA,HORA,SOLICITANTE\n";
    window.currentDrillDownData.forEach(b => {
        csv += `"${b.nome || ''}","${b.cpf || b.matricula || ''}","${b.status || ''}","${b.status_checkin || ''}","${b.origem || ''}","${b.destino || ''}","${b.data || ''}","${b.hora || ''}","${b.solicitante || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `analitico_drilldown.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


window.runRobotAudit = async function() {
    const loading = document.getElementById('robot-audit-loading');
    const results = document.getElementById('robot-audit-results');
    const empty = document.getElementById('robot-audit-empty');
    if (!results) return;
    
    if (loading) loading.classList.remove('hidden');
    results.classList.add('hidden');
    if (empty) empty.classList.add('hidden');
    
    let issues = [];
    
    const activeBookings = (db.bookings || []).filter(b => b.status !== 'Cancelado');
    
    // Verifica duplicidades
    const seen = new Map();
    activeBookings.forEach(b => {
        const key = `${b.matricula || b.cpf}_${b.data}_${b.origem}_${b.destino}_${b.hora}`;
        if (seen.has(key)) {
            issues.push({
                type: 'Agendamento Duplicado',
                severity: 'Alta',
                title: `Duplicidade: ${b.nome || 'Passageiro'}`,
                desc: `Múltiplos agendamentos ativos identificados para o mesmo dia e horário (${b.data} às ${b.hora}).`
            });
        } else {
            seen.set(key, true);
        }
    });
    
    // Verifica agendamentos sem nome
    activeBookings.forEach(b => {
        if (!b.nome || b.nome.trim() === '' || b.nome === 'Não identificado') {
            issues.push({
                type: 'Cadastro Incompleto',
                severity: 'Média',
                title: `Passageiro sem Nome (ID: ${b.id})`,
                desc: `O agendamento na data ${b.data} ${b.hora} não possui nome completo associado.`
            });
        }
    });
    
    // Consulta diagnóstico do servidor se disponível
    try {
        const res = await fetch(`${getApiUrl()}/system-health`);
        if (res.ok) {
            const data = await res.json();
            if (data.issues && data.issues.length > 0) {
                data.issues.forEach(i => {
                    issues.push({
                        type: i.type || 'Anomalia Detectada',
                        severity: 'Alta',
                        title: i.error || 'Alerta no Banco',
                        desc: i.cause || i.resolution || ''
                    });
                });
            }
        }
    } catch(e) {}
    
    if (loading) loading.classList.add('hidden');
    
    if (issues.length === 0) {
        if (empty) empty.classList.remove('hidden');
    } else {
        results.classList.remove('hidden');
        results.innerHTML = issues.map(i => `
            <div class="bg-gray-900 border border-amber-500/30 p-4 rounded-xl space-y-2">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] uppercase font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">${i.type}</span>
                    <span class="text-[9px] font-bold text-rose-400 uppercase">${i.severity}</span>
                </div>
                <h5 class="text-xs font-bold text-white">${i.title}</h5>
                <p class="text-[11px] text-gray-400 leading-normal">${i.desc}</p>
            </div>
        `).join('');
    }
};
