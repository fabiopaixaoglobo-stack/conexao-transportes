// RIT-Monitoring Unified Widget Engine - Shared Module

(function() {
    console.log("[RIT-MONITORING] Initializing unified monitoring module...");

    // Store state in localStorage to sync between windows/apps if necessary
    const STATE_KEY = 'rit_manual_monitorings';
    
    function getManualMonitorings() {
        try {
            return JSON.parse(localStorage.getItem(STATE_KEY) || '[]');
        } catch (e) {
            console.error('[RIT-MONITORING] Error reading manual monitorings:', e);
            return [];
        }
    }

    function saveManualMonitoring(item) {
        try {
            const list = getManualMonitorings();
            list.push(item);
            localStorage.setItem(STATE_KEY, JSON.stringify(list));
            console.log('[RIT-MONITORING] Manual monitoring saved:', item);
        } catch (e) {
            console.error('[RIT-MONITORING] Error saving manual monitoring:', e);
        }
    }

    // HTML Template to inject into the tab container
    const HTML_TEMPLATE = `
    <div class="rit-layout-container">
        <aside class="rit-sidebar">
            <div class="rit-panel">
                <div class="rit-panel-title">Status Operacional <div class="rit-badge rit-badge-status-active" style="background:#10B981; color:#000;">ESTÁGIO 2</div></div>
                <div style="font-size:12px; font-weight:700; color:var(--rit-accent);">28°C ☀️ RIO DE JANEIRO</div>
            </div>
            <div class="rit-panel">
                <div class="rit-panel-title">Georreferenciamento & Resumo</div>
                <div id="rit-geo-status" style="font-size:10px; color:var(--rit-muted);">Base carregada e sincronizada.</div>
                <div id="rit-resumo" style="font-size:11px; font-weight:700; color:var(--rit-accent);">Importados: 0 | Compartilhando: 0</div>
            </div>
            <div class="rit-panel grow">
                <div class="rit-panel-title">Fila de Atendimentos</div>
                <div id="rit-lista-atendimentos" class="rit-list-box">
                    <div style="text-align:center; padding:20px; color:var(--rit-muted); font-size:12px;">Nenhum atendimento na fila.</div>
                </div>
            </div>
        </aside>
        <section class="rit-map-area">
            <div class="rit-filter-bar">
                <select id="rit-filtro-programa" class="rit-select"><option value="">Programa</option></select>
                <select id="rit-filtro-bairro" class="rit-select"><option value="">Bairro</option></select>
                <select id="rit-filtro-tipo" class="rit-select"><option value="">Veículo</option></select>
                <select id="rit-filtro-status" class="rit-select">
                    <option value="">Todos atendimentos</option>
                    <option value="Em viagem">Em viagem</option>
                    <option value="Aguardando">Aguardando</option>
                </select>
                <button id="rit-btn-limpar" class="rit-btn rit-btn-secondary">Limpar</button>
                <button id="rit-btn-manual" class="rit-btn" style="background:#f5a623; color:#000;"><i class="fa-solid fa-plus mr-1"></i> + Novo Monitoramento</button>
                <div style="flex-grow:1; text-align:right; display:flex; justify-content:flex-end; gap:8px;">
                    <button id="rit-btn-camadas" class="rit-btn rit-btn-secondary">🗺️ Camadas</button>
                    <button id="rit-btn-centralizar" class="rit-btn">Centralizar Mapa</button>
                </div>
                <div id="rit-menu-camadas" style="display:none; position:absolute; top:50px; right:150px; background:#0a0f1c; border:1px solid var(--rit-border-color); border-radius:6px; padding:6px; z-index:1000;">
                    <button onclick="window.ritMonitoring.setMapLayer('mapa')" style="background:none; border:none; color:#fff; width:100%; text-align:left; padding:4px; font-size:11px; cursor:pointer;">🗺️ Mapa</button>
                    <button onclick="window.ritMonitoring.setMapLayer('satelite')" style="background:none; border:none; color:#fff; width:100%; text-align:left; padding:4px; font-size:11px; cursor:pointer;">🛰️ Satélite</button>
                    <button onclick="window.ritMonitoring.setMapLayer('terreno')" style="background:none; border:none; color:#fff; width:100%; text-align:left; padding:4px; font-size:11px; cursor:pointer;">⛰️ Terreno</button>
                </div>
            </div>
            <div id="rit-map-canvas" class="rit-map-canvas"></div>
        </section>
    </div>

    <!-- Modal de Inserção Manual de Contingência -->
    <div id="rit-modal-manual" class="rit-modal">
        <div class="rit-modal-content">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--rit-border-color); padding-bottom:8px;">
                <h3 style="margin:0; color:var(--rit-accent); font-size:14px; text-transform:uppercase;"><i class="fa-solid fa-file-signature"></i> Novo Monitoramento Manual</h3>
                <button onclick="window.ritMonitoring.closeManualModal()" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer;">&times;</button>
            </div>
            <form id="rit-form-manual" onsubmit="window.ritMonitoring.handleManualSubmit(event)" class="rit-form-grid">
                <div class="rit-form-group rit-form-group-full">
                    <label class="rit-label">Nome do Programa/Produto</label>
                    <input type="text" id="rit-m-programa" class="rit-input" required placeholder="Ex: Estúdio A - Novela" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Nome do Motorista</label>
                    <input type="text" id="rit-m-motorista" class="rit-input" required placeholder="Nome completo" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Contato (Telefone/WhatsApp)</label>
                    <input type="text" id="rit-m-telefone" class="rit-input" required placeholder="DDD + Número" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Veículo (Tipo/Modelo)</label>
                    <input type="text" id="rit-m-veiculo" class="rit-input" required placeholder="Ex: VAN ou Executivo" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Placa do Veículo</label>
                    <input type="text" id="rit-m-placa" class="rit-input" required placeholder="Ex: ABC-1234" />
                </div>
                <div class="rit-form-group rit-form-group-full">
                    <label class="rit-label">Nome do Passageiro/Produtor</label>
                    <input type="text" id="rit-m-passageiro" class="rit-input" required placeholder="Ex: Diretor de Produção ou Nome" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Local de Saída</label>
                    <input type="text" id="rit-m-saida" class="rit-input" required placeholder="Origem da viagem" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Destino (Bairro/Local)</label>
                    <input type="text" id="rit-m-destino" class="rit-input" required placeholder="Bairro destino" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Horário de Início</label>
                    <input type="text" id="rit-m-inicio" class="rit-input" required placeholder="Ex: 08:30" />
                </div>
                <div class="rit-form-group">
                    <label class="rit-label">Horário de Término</label>
                    <input type="text" id="rit-m-fim" class="rit-input" required placeholder="Ex: 10:00" />
                </div>
                <div class="rit-form-group rit-form-group-full" style="margin-top:8px;">
                    <button type="submit" class="rit-btn" style="width:100%;">Salvar e Gerar Solicitação</button>
                </div>
            </form>
        </div>
    </div>
    `;

    class RitMonitoringController {
        constructor() {
            this.map = null;
            this.tileLayers = {};
            this.markers = new Map();
            this.atendimentos = [];
            this.activeTrackers = [];
            this.filters = { programa: '', bairro: '', tipo: '', status: '' };
        }

        init(containerId) {
            const container = document.getElementById(containerId);
            if (!container) {
                console.error(`[RIT-MONITORING] Container #${containerId} not found.`);
                return;
            }
            container.innerHTML = HTML_TEMPLATE;

            // Initialize Map
            try {
                this.map = L.map('rit-map-canvas', {
                    zoomControl: true,
                    attributionControl: false
                }).setView([-22.9068, -43.1729], 11);

                this.tileLayers = {
                    mapa: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }),
                    satelite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
                    terreno: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
                };

                this.tileLayers.mapa.addTo(this.map);
                console.log("[RIT-MONITORING] Leaflet map initialized successfully.");
            } catch (e) {
                console.error("[RIT-MONITORING] Error initializing Leaflet map:", e);
            }

            // Bind Event Listeners
            document.getElementById('rit-btn-manual').addEventListener('click', () => this.openManualModal());
            document.getElementById('rit-btn-limpar').addEventListener('click', () => this.clearFilters());
            document.getElementById('rit-btn-centralizar').addEventListener('click', () => this.centralizeMap());
            
            const btnCamadas = document.getElementById('rit-btn-camadas');
            btnCamadas.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = document.getElementById('rit-menu-camadas');
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            });
            document.addEventListener('click', () => {
                const menu = document.getElementById('rit-menu-camadas');
                if (menu) menu.style.display = 'none';
            });

            // Bind filter change events
            ['rit-filtro-programa', 'rit-filtro-bairro', 'rit-filtro-tipo', 'rit-filtro-status'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('change', () => {
                        this.filters.programa = document.getElementById('rit-filtro-programa').value;
                        this.filters.bairro = document.getElementById('rit-filtro-bairro').value;
                        this.filters.tipo = document.getElementById('rit-filtro-tipo').value;
                        this.filters.status = document.getElementById('rit-filtro-status').value;
                        this.render();
                    });
                }
            });

            // Start Sync loops
            this.syncData();
            setInterval(() => this.syncData(), 8000);
        }

        setMapLayer(type) {
            Object.values(this.tileLayers).forEach(layer => this.map.removeLayer(layer));
            if (this.tileLayers[type]) {
                this.tileLayers[type].addTo(this.map);
            }
        }

        openManualModal() {
            document.getElementById('rit-modal-manual').style.display = 'flex';
        }

        closeManualModal() {
            document.getElementById('rit-modal-manual').style.display = 'none';
            document.getElementById('rit-form-manual').reset();
        }

        handleManualSubmit(e) {
            e.preventDefault();
            console.log("[RIT-MONITORING] Processing manual monitoring insertion...");
            const item = {
                id: 'man_' + Date.now(),
                programa: document.getElementById('rit-m-programa').value,
                motorista: document.getElementById('rit-m-motorista').value,
                telefone: document.getElementById('rit-m-telefone').value,
                tipoVeiculo: document.getElementById('rit-m-veiculo').value,
                placa: document.getElementById('rit-m-placa').value,
                passageiro: document.getElementById('rit-m-passageiro').value,
                origem: document.getElementById('rit-m-saida').value,
                destino: document.getElementById('rit-m-destino').value,
                dataHoraInicioRaw: document.getElementById('rit-m-inicio').value,
                dataHoraFimRaw: document.getElementById('rit-m-fim').value,
                statusAtendimento: 'AGUARDANDO',
                isManual: true
            };

            saveManualMonitoring(item);
            this.closeManualModal();
            this.syncData();

            // WhatsApp link trigger
            let telClean = String(item.telefone).replace(/\D/g, '');
            if (telClean.length === 10 || telClean.length === 11) {
                telClean = '55' + telClean;
            }
            const msgText = `Prezado Sr. ${item.motorista},\n\nSolicitamos a ativação do acompanhamento de rota para o atendimento de contingência no Portal do Motorista - Conexão Transportes RJ / Agente RIT:\n\n• Produto/Programa: ${item.programa}\n• Passageiro: ${item.passageiro}\n• Veículo: ${item.tipoVeiculo} (${item.placa})\n• Saída: ${item.origem}\n• Destino: ${item.destino}\n\nFavor compartilhar sua posição iniciando o rastreamento no link abaixo:\n🔗 ${window.location.origin}/motorista.html?id=${item.id}\n\nObrigado.`;
            const waUrl = `https://wa.me/${telClean}?text=${encodeURIComponent(msgText)}`;
            window.open(waUrl, '_blank');
        }

        clearFilters() {
            ['rit-filtro-programa', 'rit-filtro-bairro', 'rit-filtro-tipo', 'rit-filtro-status'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            this.filters = { programa: '', bairro: '', tipo: '', status: '' };
            this.render();
        }

        centralizeMap() {
            if (this.map) {
                this.map.setView([-22.9068, -43.1729], 11);
            }
        }

        async syncData() {
            try {
                // Fetch from Backend
                const host = window.location.hostname;
                const apiBase = (host === 'localhost' || host === '127.0.0.1') && window.location.port === '8000' ? 'http://localhost:8000/api' : '/api';
                
                let fetchedRotas = [];
                try {
                    const rotasRes = await fetch(`${apiBase}/rotas/listar`);
                    if (rotasRes.ok) {
                        const data = await rotasRes.json();
                        fetchedRotas = data.resultados || [];
                    }
                } catch (e) {
                    console.warn("[RIT-MONITORING] Failed to list server rotas, using manual and cache.");
                }

                let fetchedTrackers = [];
                try {
                    const trackRes = await fetch(`${apiBase}/gps/active-trackers`);
                    if (trackRes.ok) {
                        fetchedTrackers = await trackRes.json();
                    } else {
                        // Fallback to active endpoint
                        const trackRes2 = await fetch(`${apiBase}/gps/active`);
                        if (trackRes2.ok) {
                            fetchedTrackers = await trackRes2.json();
                        }
                    }
                } catch (e) {
                    console.warn("[RIT-MONITORING] Failed to get active gps trackers from server, trying localStorage.");
                    const localTrackers = JSON.parse(localStorage.getItem('conexao_active_trackers') || '{}');
                    fetchedTrackers = Object.values(localTrackers);
                }

                // Merge Manual and Auto
                const manuals = getManualMonitorings();
                
                // Keep manual items first, then server items
                const combined = [...manuals];
                
                fetchedRotas.forEach(r => {
                    // Check if already mapped to prevent duplicate
                    const exists = combined.some(x => String(x.id) === String(r.id) || String(x.placa) === String(r.placa_veiculo));
                    if (!exists) {
                        combined.push({
                            id: r.id,
                            programa: r.programa,
                            motorista: r.motorista_nome || r.motorista,
                            telefone: r.motorista_telefone || r.telefone,
                            tipoVeiculo: r.tipo_veiculo || r.tipoVeiculo,
                            placa: r.placa_veiculo || r.placa,
                            passageiro: r.passageiro,
                            origem: r.origem,
                            destino: r.destino,
                            dataHoraInicioRaw: r.horario,
                            dataHoraFimRaw: r.horario_termino,
                            statusAtendimento: r.status_atendimento || 'AGUARDANDO'
                        });
                    }
                });

                this.atendimentos = combined;
                this.activeTrackers = Array.isArray(fetchedTrackers) ? fetchedTrackers : [];
                
                // Auto active status update for manual
                this.atendimentos.forEach(a => {
                    const online = this.activeTrackers.some(t => 
                        (t.motorista_name || '').trim().toLowerCase() === (a.motorista || '').trim().toLowerCase() ||
                        (t.id_rota && String(t.id_rota) === String(a.id))
                    );
                    if (online) {
                        a.statusAtendimento = 'EM VIAGEM';
                    }
                });

                this.updateFiltersOptions();
                this.render();
            } catch (e) {
                console.error("[RIT-MONITORING] Error in syncData loop:", e);
            }
        }

        updateFiltersOptions() {
            const progs = new Set();
            const bairros = new Set();
            const tipos = new Set();

            this.atendimentos.forEach(a => {
                if (a.programa) progs.add(a.programa);
                if (a.destino) bairros.add(a.destino);
                if (a.tipoVeiculo) tipos.add(a.tipoVeiculo);
            });

            this.populateSelect('rit-filtro-programa', progs, this.filters.programa, 'Programa');
            this.populateSelect('rit-filtro-bairro', bairros, this.filters.bairro, 'Bairro');
            this.populateSelect('rit-filtro-tipo', tipos, this.filters.tipo, 'Veículo');
        }

        populateSelect(id, set, currentVal, placeholder) {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = `<option value="">${placeholder}</option>`;
            Array.from(set).sort().forEach(val => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                if (val === currentVal) opt.selected = true;
                select.appendChild(opt);
            });
        }

        render() {
            const listEl = document.getElementById('rit-lista-atendimentos');
            if (!listEl) return;

            // Apply Filters
            const filtered = this.atendimentos.filter(a => {
                if (this.filters.programa && a.programa !== this.filters.programa) return false;
                if (this.filters.bairro && a.destino !== this.filters.bairro) return false;
                if (this.filters.tipo && a.tipoVeiculo !== this.filters.tipo) return false;
                if (this.filters.status) {
                    if (this.filters.status === 'Em viagem' && a.statusAtendimento !== 'EM VIAGEM') return false;
                    if (this.filters.status === 'Aguardando' && a.statusAtendimento === 'EM VIAGEM') return false;
                }
                return true;
            });

            listEl.innerHTML = '';
            
            // Update counts
            const total = this.atendimentos.length;
            const onlineCount = this.activeTrackers.length;
            document.getElementById('rit-resumo').textContent = `Importados: ${total} | Compartilhando: ${onlineCount}`;

            if (filtered.length === 0) {
                listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--rit-muted); font-size:11px;">Nenhum atendimento corresponde aos filtros.</div>`;
            }

            filtered.forEach(a => {
                const isOnline = this.activeTrackers.some(t => 
                    (t.motorista_name || '').trim().toLowerCase() === (a.motorista || '').trim().toLowerCase() ||
                    (t.id_rota && String(t.id_rota) === String(a.id))
                );

                const card = document.createElement('div');
                card.className = 'rit-card';
                if (isOnline) card.style.borderColor = '#10B981';

                let waBtn = '';
                if (a.telefone && !isOnline) {
                    let telClean = String(a.telefone).replace(/\D/g, '');
                    if (telClean.length === 10 || telClean.length === 11) telClean = '55' + telClean;
                    const msgText = `Prezado Sr. ${a.motorista},\n\nSolicitamos a ativação do acompanhamento de rota para o atendimento de contingência no Portal do Motorista - Conexão Transportes RJ / Agente RIT:\n\n• Produto/Programa: ${a.programa}\n• Passageiro: ${a.passageiro}\n• Veículo: ${a.tipoVeiculo} (${a.placa})\n• Saída: ${a.origem}\n• Destino: ${a.destino}\n\nFavor compartilhar sua posição iniciando o rastreamento no link abaixo:\n🔗 ${window.location.origin}/motorista.html?id=${a.id}\n\nObrigado.`;
                    waBtn = `
                        <a href="https://wa.me/${telClean}?text=${encodeURIComponent(msgText)}" target="_blank" class="rit-btn" style="background:#25D366; color:#04111a; text-decoration:none; display:inline-block; font-size:10px; padding:4px 8px; border-radius:4px;">
                            💬 Solicitar
                        </a>
                    `;
                }

                const discBtn = isOnline ? `
                    <button onclick="window.ritMonitoring.disconnectDriver('${a.motorista}', '${a.id}')" class="rit-btn rit-btn-danger" style="font-size:10px; padding:4px 8px; border-radius:4px;">
                        🛑 Desconectar
                    </button>
                ` : '';

                card.innerHTML = `
                    <div class="rit-card-row">
                        <span class="rit-badge rit-badge-program">${a.programa}</span>
                        <span class="rit-badge ${isOnline ? 'rit-badge-status-active' : 'rit-badge-status-waiting'}">${isOnline ? 'EM VIAGEM' : 'AGUARDANDO'}</span>
                    </div>
                    <div class="rit-text-bold" style="font-size:12px; margin-bottom:4px;">👤 Motorista: ${a.motorista}</div>
                    <div style="font-size:10px; color:var(--rit-muted); margin-bottom:4px;">📞 Contato: ${a.telefone || 'N/D'}</div>
                    <div style="font-size:11px; margin-bottom:4px;">👤 Passageiro/Produtor: ${a.passageiro || 'Não informado'}</div>
                    <div style="font-size:10px; color:var(--rit-muted); margin-bottom:4px;">🚗 Placa: ${a.placa} (${a.tipoVeiculo})</div>
                    <div style="font-size:11px; color:var(--rit-muted);">📍 Destino: ${a.destino}</div>
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        ${waBtn}
                        ${discBtn}
                    </div>
                `;

                listEl.appendChild(card);
            });

            this.updateMapMarkers();
        }

        updateMapMarkers() {
            if (!this.map) return;

            // Clear old markers
            this.markers.forEach(m => this.map.removeLayer(m));
            this.markers.clear();

            this.activeTrackers.forEach(t => {
                const name = t.motorista_name || t.motorista || 'Motorista';
                const speed = t.speed || 0;
                const timestamp = t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '--:--:--';
                
                // Find matching itinerary
                const match = this.atendimentos.find(a => 
                    (a.motorista || '').trim().toLowerCase() === name.trim().toLowerCase() ||
                    (t.id_rota && String(t.id_rota) === String(a.id))
                ) || {};

                const popupHtml = `
                    <div style="padding:4px; font-family:'Inter',sans-serif; color:white; min-width:230px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px; margin-bottom:8px;">
                            <b style="color:var(--rit-accent); font-size:12px;">👤 ${name}</b>
                            <span class="rit-badge rit-badge-status-active" style="background:#10B981; color:#000;">EM VIAGEM</span>
                        </div>
                        <div style="font-size:11px; line-height:1.6; display:flex; flex-direction:column; gap:4px;">
                            <div><b>Passageiro/Produtor:</b> ${match.passageiro || 'Não informado'}</div>
                            <div><b>Programa:</b> ${match.programa || 'Não informado'}</div>
                            <div><b>Veículo:</b> ${match.tipoVeiculo || 'N/D'} (${match.placa || 'N/D'})</div>
                            <div><b>Contato:</b> ${match.telefone || 'N/D'}</div>
                            <div><b>Saída:</b> ${match.origem || 'Não informado'}</div>
                            <div><b>Destino:</b> ${match.destino || 'Não informado'}</div>
                            <div><b>Horários:</b> ${match.dataHoraInicioRaw || 'N/D'} - ${match.dataHoraFimRaw || 'N/D'}</div>
                            <div style="border-top:1px dashed rgba(255,255,255,0.1); margin:4px 0; padding-top:4px;">
                                <b>Velocidade:</b> ${speed} km/h | <b>Atualizado:</b> ${timestamp}
                            </div>
                            <div style="border-top:1px dashed rgba(255,255,255,0.1); padding-top:4px; font-size:10px;">
                                <b>📍 Endereço Atual:</b> <span id="rit-addr-${name.replace(/\s+/g, '-')}" style="color:#8a99a8;">Buscando endereço...</span>
                            </div>
                            <div style="margin-top:10px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;">
                                <button onclick="window.ritMonitoring.disconnectDriver('${name}', '${match.id || ''}')" style="background:#EF4444; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-size:11px; font-weight:800; width:100%; cursor:pointer; text-align:center;">
                                    Desconectar Transmissão
                                </button>
                            </div>
                        </div>
                    </div>
                `;

                // Custom DivIcon style to represent driver
                const icon = L.divIcon({
                    className: 'rit-map-marker',
                    html: `<div style="background-color:#10B981; width:22px; height:22px; border-radius:50%; border:2.5px solid #fff; box-shadow:0 0 10px #10B981; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-car-side" style="color:#000; font-size:9px;"></i></div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                });

                if (t.lat && t.lng) {
                    const marker = L.marker([parseFloat(t.lat), parseFloat(t.lng)], { icon }).addTo(this.map);
                    marker.bindPopup(popupHtml);
                    
                    marker.on('popupopen', () => {
                        this.reverseGeocode(t.lat, t.lng, `rit-addr-${name.replace(/\s+/g, '-')}`);
                    });

                    this.markers.set(name, marker);
                }
            });
        }

        async reverseGeocode(lat, lng, elementId) {
            const cacheKey = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
            window._geoCache = window._geoCache || {};
            if (window._geoCache[cacheKey]) {
                const el = document.getElementById(elementId);
                if (el) el.textContent = window._geoCache[cacheKey];
                return;
            }
            try {
                const res = await fetch(`/api/cor/reverse-geocode?lat=${lat}&lng=${lng}`).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json();
                    const addr = data.display_name || data.address || 'Rio de Janeiro, RJ';
                    window._geoCache[cacheKey] = addr;
                    const el = document.getElementById(elementId);
                    if (el) el.textContent = addr;
                } else {
                    const el = document.getElementById(elementId);
                    if (el) el.textContent = 'Rio de Janeiro, RJ';
                }
            } catch (e) {
                const el = document.getElementById(elementId);
                if (el) el.textContent = 'Rio de Janeiro, RJ';
            }
        }

        async disconnectDriver(name, id) {
            if (!confirm(`Deseja realmente desconectar a transmissão do motorista ${name}?`)) return;
            console.log(`[RIT-MONITORING] Sending disconnection request for: "${name}" / id: "${id}"`);
            
            try {
                const host = window.location.hostname;
                const apiBase = (host === 'localhost' || host === '127.0.0.1') && window.location.port === '8000' ? 'http://localhost:8000/api' : '/api';
                const res = await fetch(`${apiBase}/gps/desconectar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ motorista: name, id_rota: id })
                });
                
                if (res.ok) {
                    alert(`Motorista ${name} desconectado com sucesso!`);
                    this.syncData();
                } else {
                    console.error('[RIT-MONITORING] Failed disconnect endpoint response:', res.statusText);
                    // Local disconnect fallback if server fails
                    const trackers = JSON.parse(localStorage.getItem('conexao_active_trackers') || '{}');
                    delete trackers[name];
                    localStorage.setItem('conexao_active_trackers', JSON.stringify(trackers));
                    this.syncData();
                }
            } catch (e) {
                console.error('[RIT-MONITORING] Error disconnecting driver:', e);
            }
        }
    }

    // Export class to window global scope
    window.ritMonitoring = new RitMonitoringController();
})();
