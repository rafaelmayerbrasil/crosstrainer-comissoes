// ═══════════════════════════════════════════════════════════════════════
// CrossTainer — Módulo Professores · Serviços e Helpers compartilhados
// Etapa 2 do Sprint 1
//
// Conteúdo:
//   • Helpers: mascararCpf · getInitials · avatarHtml · internAlertHtml ·
//              fmt · formatDate · safeServerTimestamp
//   • AuditService.log
//   • ModalityService: list · getById · create · update · deactivate · activate
//   • TeacherService:  list · getById · getCounts · create · update ·
//                      deactivate · activate
//   • SalaryService:   get · upsert (com histórico automático)
//
// Padrão de retorno uniforme:
//   { success: true,  data: ... }
//   { success: false, error: 'mensagem', code: 'firebase-code' }
//
// Todas as operações de escrita registram em audit_log automaticamente.
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const BR_OFFSET_HOURS = 3;  // UTC-3, sem DST desde 2019

// ────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────

/**
 * Mascara CPF para LGPD (P05).
 *   "123.456.789-00"   → "***.456.789-**"
 *   "12345678900"      → "***.456.789-**"
 *   ""/null/inválido   → ""
 */
function mascararCpf(cpfCompleto) {
  if (!cpfCompleto) return '';
  // Se já está mascarado, retorna como está
  if (String(cpfCompleto).includes('*')) return String(cpfCompleto);
  const digits = String(cpfCompleto).replace(/\D/g, '');
  if (digits.length !== 11) return '';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

/**
 * Extrai iniciais de um nome para usar em avatar.
 *   "Lucas Mendes da Silva" → "LS"
 *   "Ana"                   → "AN"
 */
function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renderiza HTML de avatar com cor baseada no tipo de professor.
 */
function avatarHtml(name, type, size = 36) {
  const colors = {
    efetivo:    { bg: 'var(--orange-glow)', border: 'var(--orange)', text: 'var(--orange)' },
    estagiario: { bg: 'var(--green-bg)',    border: 'var(--green)',  text: 'var(--green)' },
    eventual:   { bg: 'var(--yellow-bg)',   border: 'var(--yellow)', text: 'var(--yellow)' },
  };
  const c = colors[type] || { bg: 'var(--surface3)', border: 'var(--border)', text: 'var(--text2)' };
  const fontSize = Math.max(10, Math.floor(size * 0.4));
  return `<div style="
    width:${size}px;height:${size}px;border-radius:8px;
    background:${c.bg};border:1.5px solid ${c.border};color:${c.text};
    display:inline-flex;align-items:center;justify-content:center;
    font-weight:700;font-size:${fontSize}px;flex-shrink:0;
  ">${getInitials(name)}</div>`;
}

/**
 * Badge de alerta para estagiários próximos dos 12 meses de contrato (RN20).
 *   < 0 dias: vencido
 *   <= 30 dias: alerta crítico
 *   sem alerta caso contrário
 */
function internAlertHtml(teacher) {
  if (!teacher || teacher.type !== 'estagiario' || !teacher.internshipStartDate) return '';
  const start = teacher.internshipStartDate.toDate
    ? teacher.internshipStartDate.toDate()
    : new Date(teacher.internshipStartDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 12);
  const now = new Date();
  const days = Math.floor((end - now) / 86400000);

  if (days < 0) {
    return `<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:var(--red-bg);color:var(--red);font-weight:700;">VENCIDO há ${-days}d</span>`;
  }
  if (days <= 30) {
    return `<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:var(--yellow-bg);color:var(--yellow);font-weight:700;">12 meses em ${days}d</span>`;
  }
  return '';
}

/** Formata número como moeda BR. */
function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Formata Timestamp do Firestore como dd/mm/yyyy. Aceita também Date ou string ISO. */
function formatDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR');
  } catch { return '—'; }
}

/** Converte string ISO ou Date para Firestore Timestamp. Null se vazio. */
function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof firebase.firestore.Timestamp) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return firebase.firestore.Timestamp.fromDate(d);
}

function serverTs() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function currentUserId() {
  return AppState.currentUser ? AppState.currentUser.uid : null;
}
function currentUserName() {
  return (AppState.userProfile && AppState.userProfile.name) ||
         (AppState.currentUser && AppState.currentUser.email) ||
         '(desconhecido)';
}
function currentUserRoles() {
  if (!AppState.userProfile) return '';
  const profiles = AppState.userProfile.profiles || [AppState.userProfile.role];
  return profiles.filter(Boolean).join(',');
}

// ────────────────────────────────────────────────────────────────────────
// Sprint 6c — Helpers de Período Aquisitivo (CLT)
// ────────────────────────────────────────────────────────────────────────

/**
 * Retorna a data de início para contagem de períodos aquisitivos.
 * Efetivo → hireDate. Estagiário → internshipStartDate.
 * Eventual → null (sem direito).
 * Fallback: createdAt do teacher (com flag estimatedStartDate).
 */
function getEntitlementStartDate(teacher) {
  if (!teacher) return null;
  if (teacher.type === 'eventual') return null;

  if (teacher.type === 'efetivo' && teacher.hireDate) {
    return teacher.hireDate.toDate ? teacher.hireDate.toDate() : new Date(teacher.hireDate);
  }
  if (teacher.type === 'estagiario' && teacher.internshipStartDate) {
    return teacher.internshipStartDate.toDate ? teacher.internshipStartDate.toDate() : new Date(teacher.internshipStartDate);
  }
  // Fallback: createdAt
  if (teacher.createdAt) {
    return teacher.createdAt.toDate ? teacher.createdAt.toDate() : new Date(teacher.createdAt);
  }
  return null;
}

/**
 * Adiciona N meses a uma data preservando fim de mês quando aplicável.
 * Ex: 31/01 + 1m → 28/02 (ou 29/02 em bissexto), não 03/03.
 */
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Se o dia "estourou" pra próximo mês, volta pro último dia do mês alvo
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }
  return d;
}

/**
 * Lista todos os períodos aquisitivos do professor (passados + atual).
 * Retorna array ordenado por index (1, 2, 3...).
 */
function listAcquisitionPeriods(teacher, asOfDate) {
  asOfDate = asOfDate || new Date();
  const start = getEntitlementStartDate(teacher);
  if (!start) return [];

  const periods = [];
  let cursor = new Date(start);
  let index = 1;

  while (cursor <= asOfDate) {
    const endDate = addMonths(cursor, 12);
    endDate.setDate(endDate.getDate() - 1);

    periods.push({
      index,
      startDate: new Date(cursor),
      endDate: new Date(endDate),
      entitledDays: 30,
    });

    cursor = addMonths(cursor, 12);
    index++;
    if (index > 100) break; // safety net
  }

  return periods;
}

/**
 * Encontra o período aquisitivo atual (o último que contém asOfDate).
 */
function findCurrentPeriod(periods, asOfDate) {
  asOfDate = asOfDate || new Date();
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].startDate <= asOfDate && asOfDate <= periods[i].endDate) {
      return { ...periods[i], isCurrent: true };
    }
  }
  return null;
}

/** Escapa HTML para prevenir XSS em dados vindos do Firestore. */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ────────────────────────────────────────────────────────────────────────
// AUDIT SERVICE
// ────────────────────────────────────────────────────────────────────────

const AuditService = {
  /**
   * Lista entries do audit_log. Apenas Admin tem permissão (RN21 + Security Rule).
   * @param {Object} filters
   * @param {string} [filters.entityType] - filtra por tipo (ex: 'teacher')
   * @param {string} [filters.entityId]   - filtra por id da entidade
   * @param {number} [filters.limit]      - máximo de registros (default 100)
   */
  async list(filters = {}) {
    try {
      let q = db.collection('audit_log');
      // Aplica filtros server-side quando possível (entityType usa índice simples)
      if (filters.entityType) {
        q = q.where('entityType', '==', filters.entityType);
      }
      // limit ANTES de orderBy pra não exigir índice composto desnecessário
      const lim = filters.limit || 100;
      const snap = await q.limit(lim * 2).get();
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filtra por entityId client-side (evita índice composto)
      if (filters.entityId) {
        data = data.filter(e => e.entityId === filters.entityId);
      }
      // Ordena DESC por timestamp client-side
      data.sort((a, b) => {
        const ta = a.timestamp && a.timestamp.toMillis ? a.timestamp.toMillis() : 0;
        const tb = b.timestamp && b.timestamp.toMillis ? b.timestamp.toMillis() : 0;
        return tb - ta;
      });
      return { success: true, data: data.slice(0, lim) };
    } catch (err) {
      console.error('[AuditService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Grava entry em audit_log.
   * @param {Object} params
   * @param {string} params.type         - ex: 'teacher_created'
   * @param {string} params.details      - descrição livre
   * @param {string} [params.entityType] - ex: 'teacher'
   * @param {string} [params.entityId]
   * @param {Object} [params.before]     - estado anterior (serializável)
   * @param {Object} [params.after]      - estado novo
   */
  async log({ type, details, entityType, entityId, before, after, module }) {
    if (!currentUserId()) {
      console.warn('[AuditService.log] Sem usuário autenticado, log abortado');
      return { success: false, error: 'unauthenticated' };
    }
    try {
      const docRef = await db.collection('audit_log').add({
        type,
        details: details || '',
        // Fix 18/05/2026: aceitar `module` como parâmetro (antes era hardcoded 'professores',
        // o que causava entries de agenda/substituição/cobertura ficarem todas como 'professores'
        // e a query por module='agenda' não retornar nada).
        module: module || 'professores',
        entityType: entityType || null,
        entityId: entityId || null,
        before: before ? sanitizeForAudit(before) : null,
        after: after ? sanitizeForAudit(after) : null,
        userId: currentUserId(),
        userName: currentUserName(),
        role: currentUserRoles(),
        unitId: null,
        timestamp: serverTs(),
      });
      return { success: true, data: { id: docRef.id } };
    } catch (err) {
      console.error('[AuditService.log]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

/**
 * Remove campos não-serializáveis (FieldValue sentinels) antes de gravar no log,
 * para evitar referências circulares ou Timestamp pendente.
 */
function sanitizeForAudit(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const cleaned = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && v.constructor && v.constructor.name === 'FieldValueImpl') {
      continue; // pula serverTimestamp() sentinels
    }
    if (v && v.toDate && typeof v.toDate === 'function') {
      cleaned[k] = v.toDate().toISOString(); // Timestamp → string ISO
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

// ────────────────────────────────────────────────────────────────────────
// UNIT SERVICE — leitura apenas (coleção existente do módulo de Comissões)
// ────────────────────────────────────────────────────────────────────────

const UnitService = {
  async list() {
    try {
      const snap = await db.collection('units').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[UnitService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────
// MODALITY SERVICE
// ────────────────────────────────────────────────────────────────────────

const ModalityService = {
  async list() {
    try {
      const snap = await db.collection('modalities').orderBy('name').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[ModalityService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getById(id) {
    try {
      const doc = await db.collection('modalities').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Modalidade não encontrada' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  },

  async create({ name, description = '' }) {
    if (!name || name.trim().length < 2) {
      return { success: false, error: 'Nome inválido (mínimo 2 caracteres)' };
    }
    try {
      const after = {
        name: name.trim(),
        description: description.trim(),
        isActive: true,
        createdAt: serverTs(),
        createdBy: currentUserId(),
      };
      const ref = await db.collection('modalities').add(after);
      await AuditService.log({
        type: 'modality_created',
        details: `Modalidade "${after.name}" criada`,
        entityType: 'modality',
        entityId: ref.id,
        after,
      });
      return { success: true, data: { id: ref.id, ...after } };
    } catch (err) {
      console.error('[ModalityService.create]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async update(id, { name, description }) {
    try {
      const ref = db.collection('modalities').doc(id);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Modalidade não encontrada' };
      const before = beforeDoc.data();
      const after = {
        name: name !== undefined ? String(name).trim() : before.name,
        description: description !== undefined ? String(description).trim() : (before.description || ''),
        updatedAt: serverTs(),
        updatedBy: currentUserId(),
      };
      if (after.name.length < 2) return { success: false, error: 'Nome inválido' };
      await ref.update(after);
      await AuditService.log({
        type: 'modality_updated',
        details: `Modalidade "${before.name}" atualizada`,
        entityType: 'modality',
        entityId: id,
        before, after,
      });
      return { success: true, data: { id, ...before, ...after } };
    } catch (err) {
      console.error('[ModalityService.update]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async setActive(id, active) {
    try {
      const ref = db.collection('modalities').doc(id);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Modalidade não encontrada' };
      const before = doc.data();
      const after = { isActive: !!active, updatedAt: serverTs(), updatedBy: currentUserId() };
      await ref.update(after);
      await AuditService.log({
        type: active ? 'modality_activated' : 'modality_deactivated',
        details: `Modalidade "${before.name}" ${active ? 'reativada' : 'inativada'}`,
        entityType: 'modality',
        entityId: id,
        before, after,
      });
      return { success: true };
    } catch (err) {
      console.error('[ModalityService.setActive]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async deactivate(id) { return this.setActive(id, false); },
  async activate(id)   { return this.setActive(id, true);  },
};

// ────────────────────────────────────────────────────────────────────────
// TEACHER SERVICE
// ────────────────────────────────────────────────────────────────────────

const TeacherService = {
  async list(filters = {}) {
    try {
      const snap = await db.collection('teachers').orderBy('name').get();
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (filters.type)            data = data.filter(t => t.type === filters.type);
      if (filters.isActive !== undefined) data = data.filter(t => t.isActive === filters.isActive);
      if (filters.modalityId)      data = data.filter(t => (t.modalityIds || []).includes(filters.modalityId));
      if (filters.unitId)          data = data.filter(t => (t.unitIds || []).includes(filters.unitId));
      if (filters.search) {
        const q = String(filters.search).toLowerCase();
        data = data.filter(t =>
          (t.name || '').toLowerCase().includes(q) ||
          (t.email || '').toLowerCase().includes(q)
        );
      }
      return { success: true, data };
    } catch (err) {
      console.error('[TeacherService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getById(id) {
    try {
      const doc = await db.collection('teachers').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Professor não encontrado' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getCounts() {
    try {
      const snap = await db.collection('teachers').get();
      const all = snap.docs.map(d => d.data());
      const active = all.filter(t => t.isActive);
      return {
        success: true,
        data: {
          total:        all.length,
          ativos:       active.length,
          inativos:     all.length - active.length,
          efetivos:     active.filter(t => t.type === 'efetivo').length,
          estagiarios:  active.filter(t => t.type === 'estagiario').length,
          eventuais:    active.filter(t => t.type === 'eventual').length,
        }
      };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  },

  async create(teacherData) {
    const err = validateTeacher(teacherData);
    if (err) return { success: false, error: err };
    try {
      const after = {
        userId: teacherData.userId || null,
        name: teacherData.name.trim(),
        email: teacherData.email.trim().toLowerCase(),
        phone: teacherData.phone || '',
        cpf: mascararCpf(teacherData.cpf),
        type: teacherData.type,
        unitIds: teacherData.unitIds || [],
        primaryUnitId: teacherData.primaryUnitId || (teacherData.unitIds && teacherData.unitIds[0]) || null,
        modalityIds: teacherData.modalityIds || [],
        hireDate: toTimestamp(teacherData.hireDate),
        contractEndDate: toTimestamp(teacherData.contractEndDate),
        internshipStartDate: toTimestamp(teacherData.internshipStartDate),
        isActive: true,
        notes: teacherData.notes || '',
        createdAt: serverTs(),
        createdBy: currentUserId(),
      };
      const ref = await db.collection('teachers').add(after);
      await AuditService.log({
        type: 'teacher_created',
        details: `Professor "${after.name}" (${after.type}) criado`,
        entityType: 'teacher',
        entityId: ref.id,
        after,
      });
      return { success: true, data: { id: ref.id, ...after } };
    } catch (err) {
      console.error('[TeacherService.create]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async update(id, updates) {
    try {
      const ref = db.collection('teachers').doc(id);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Professor não encontrado' };
      const before = beforeDoc.data();

      // Mascarar CPF se vier completo
      if (updates.cpf) updates.cpf = mascararCpf(updates.cpf);

      // Converter datas string → Timestamp
      ['hireDate', 'contractEndDate', 'internshipStartDate'].forEach(f => {
        if (updates[f] !== undefined && !(updates[f] instanceof firebase.firestore.Timestamp)) {
          updates[f] = toTimestamp(updates[f]);
        }
      });

      const after = {
        ...updates,
        updatedAt: serverTs(),
        updatedBy: currentUserId(),
      };

      await ref.update(after);
      await AuditService.log({
        type: 'teacher_updated',
        details: `Professor "${before.name}" atualizado`,
        entityType: 'teacher',
        entityId: id,
        before, after,
      });
      return { success: true, data: { id, ...before, ...after } };
    } catch (err) {
      console.error('[TeacherService.update]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async setActive(id, active) {
    try {
      const ref = db.collection('teachers').doc(id);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Professor não encontrado' };
      const before = doc.data();
      const after = { isActive: !!active, updatedAt: serverTs(), updatedBy: currentUserId() };
      await ref.update(after);
      await AuditService.log({
        type: active ? 'teacher_activated' : 'teacher_deactivated',
        details: `Professor "${before.name}" ${active ? 'reativado' : 'inativado'}`,
        entityType: 'teacher',
        entityId: id,
        before, after,
      });
      return { success: true };
    } catch (err) {
      console.error('[TeacherService.setActive]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async deactivate(id) { return this.setActive(id, false); },
  async activate(id)   { return this.setActive(id, true);  },
};

/**
 * Validações da spec § 9.1 (Cadastro de Professor).
 * Retorna string com mensagem de erro ou null se válido.
 */
function validateTeacher(d) {
  if (!d || typeof d !== 'object') return 'Dados inválidos';
  if (!d.name || d.name.trim().length < 3) return 'Nome inválido (mínimo 3 caracteres)';
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'Email inválido';
  if (!d.cpf) return 'CPF obrigatório';
  const digits = String(d.cpf).replace(/\D/g, '');
  if (digits.length !== 11 && !String(d.cpf).includes('*')) return 'CPF deve ter 11 dígitos';
  if (!['efetivo', 'estagiario', 'eventual'].includes(d.type)) return 'Tipo inválido (efetivo, estagiario ou eventual)';
  if (!d.unitIds || !d.unitIds.length) return 'Selecione ao menos uma unidade';
  if (!d.modalityIds || !d.modalityIds.length) return 'Selecione ao menos uma modalidade';
  if (d.type === 'estagiario') {
    if (!d.contractEndDate) return 'Data de fim do contrato é obrigatória para estagiários';
    if (!d.internshipStartDate) return 'Data de início do estágio é obrigatória';
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// SALARY SERVICE — ⛔ APENAS Admin (validado por Security Rules)
// ────────────────────────────────────────────────────────────────────────

const SalaryService = {
  /**
   * Lê dados salariais. Para não-admin retorna permission-denied.
   * Para teacher sem doc de salário, retorna { success: true, data: null }.
   */
  async get(teacherId) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    try {
      const doc = await db.collection('teacher_salaries').doc(teacherId).get();
      if (!doc.exists) return { success: true, data: null };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      // Se for permission-denied, é esperado para não-admin
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Cria ou atualiza dados salariais.
   * Toda mudança de valor monetário é registrada automaticamente em salaryHistory.
   *
   * Mini-sprint 1.5:
   *   B-01 — cada entry de histórico ganha `effectiveDate` (quando o novo valor passa a valer)
   *          e `effectiveNote` (motivo opcional). Default vem do frontend.
   *          Validação: effectiveDate >= effectiveDate da entry mais recente.
   *   B-02 — aceita `mealAllowance`, `transportAllowance`, `otherBenefits` (array de {nome, valor}).
   *          VR e VT são tracked atomicamente. otherBenefits é tracked como snapshot completo.
   */
  async upsert(teacherId, salaryData) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    const err = validateSalary(salaryData);
    if (err) return { success: false, error: err };

    try {
      const ref = db.collection('teacher_salaries').doc(teacherId);
      const beforeDoc = await ref.get();
      const before = beforeDoc.exists ? beforeDoc.data() : null;

      const previousHistory = before && Array.isArray(before.salaryHistory) ? [...before.salaryHistory] : [];
      const nowTs = firebase.firestore.Timestamp.now();
      const uid = currentUserId();
      const uname = currentUserName();

      // ── B-01: normaliza effectiveDate vinda do frontend (Date | string YYYY-MM-DD | Timestamp) ──
      const effectiveTs = normalizeEffectiveDate(salaryData.effectiveDate) || nowTs;
      const effectiveNote = (salaryData.effectiveNote || '').toString().slice(0, 500);

      // Validação temporal: effectiveDate não pode ser anterior à entry mais recente do histórico.
      // (Edge case Sprint 5/6: retroatividade em mês fechado — a checar lá.)
      const lastEffectiveTs = previousHistory.reduce((acc, e) => {
        const ts = e.effectiveDate && e.effectiveDate.toMillis ? e.effectiveDate.toMillis() : 0;
        return ts > acc ? ts : acc;
      }, 0);
      if (lastEffectiveTs && effectiveTs.toMillis() < lastEffectiveTs) {
        return {
          success: false,
          error: 'A data de início de validade não pode ser anterior à última alteração registrada.'
        };
      }

      // ── Tracking de campos atômicos (números) ──
      const fieldsToTrack = [
        'hourlyRate',
        'internMonthlyStipend',
        'internMonthlyLimitHours',
        'internProportionalHourlyRate',
        'mealAllowance',         // 🆕 B-02
        'transportAllowance',    // 🆕 B-02
      ];

      fieldsToTrack.forEach(field => {
        if (salaryData[field] !== undefined && salaryData[field] !== (before && before[field])) {
          previousHistory.push({
            changedAt: nowTs,
            changedBy: uid,
            changedByName: uname,
            field,
            previousValue: (before && before[field]) ?? null,
            newValue: salaryData[field],
            effectiveDate: effectiveTs,   // 🆕 B-01
            effectiveNote,                // 🆕 B-01
          });
        }
      });

      // ── B-02: tracking do otherBenefits (array) via snapshot completo ──
      if (salaryData.otherBenefits !== undefined) {
        const prevSnap = JSON.stringify((before && before.otherBenefits) || []);
        const nextSnap = JSON.stringify(salaryData.otherBenefits || []);
        if (prevSnap !== nextSnap) {
          previousHistory.push({
            changedAt: nowTs,
            changedBy: uid,
            changedByName: uname,
            field: 'otherBenefits',
            previousValue: (before && before.otherBenefits) || [],
            newValue: salaryData.otherBenefits || [],
            effectiveDate: effectiveTs,
            effectiveNote,
          });
        }
      }

      const after = {
        teacherId,
        remunerationType: salaryData.remunerationType || (before && before.remunerationType) || 'hora_aula',
        hourlyRate: salaryData.hourlyRate ?? (before && before.hourlyRate) ?? null,
        internMonthlyStipend: salaryData.internMonthlyStipend ?? (before && before.internMonthlyStipend) ?? null,
        internMonthlyLimitHours: salaryData.internMonthlyLimitHours ?? (before && before.internMonthlyLimitHours) ?? null,
        // FIX Etapa 7 — antes esse campo era derivado só de hours*60, descartando os minutos.
        // Agora respeita o que o frontend calcula (hours*60 + minutes) com precisão até 1 min.
        internMonthlyLimitMinutes: salaryData.internMonthlyLimitMinutes ?? (
          salaryData.internMonthlyLimitHours != null
            ? salaryData.internMonthlyLimitHours * 60
            : (before && before.internMonthlyLimitMinutes) ?? null
        ),
        internProportionalHourlyRate: salaryData.internProportionalHourlyRate ?? (before && before.internProportionalHourlyRate) ?? null,
        // 🆕 B-02 — benefícios mensais
        mealAllowance:      salaryData.mealAllowance      ?? (before && before.mealAllowance)      ?? null,
        transportAllowance: salaryData.transportAllowance ?? (before && before.transportAllowance) ?? null,
        otherBenefits:      salaryData.otherBenefits      ?? (before && before.otherBenefits)      ?? null,
        salaryHistory: previousHistory,
        updatedAt: serverTs(),
        updatedBy: uid,
      };

      await ref.set(after, { merge: true });

      await AuditService.log({
        type: before ? 'salary_updated' : 'salary_created',
        details: `Dados salariais ${before ? 'atualizados' : 'criados'} (teacherId: ${teacherId})`,
        entityType: 'teacher_salary',
        entityId: teacherId,
        before, after,
      });

      return { success: true, data: after };
    } catch (err) {
      console.error('[SalaryService.upsert]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// Helper B-01: normaliza effectiveDate (Date | string YYYY-MM-DD | Timestamp) pra Firestore.Timestamp
function normalizeEffectiveDate(val) {
  if (!val) return null;
  if (val && typeof val.toMillis === 'function') return val; // já é Timestamp
  if (val instanceof Date) return firebase.firestore.Timestamp.fromDate(val);
  if (typeof val === 'string') {
    // Espera "YYYY-MM-DD" do <input type="date">. Cria meia-noite local.
    const [y, m, d] = val.split('-').map(Number);
    if (y && m && d) return firebase.firestore.Timestamp.fromDate(new Date(y, m - 1, d));
  }
  return null;
}

function validateSalary(s) {
  if (!s || typeof s !== 'object') return 'Dados salariais inválidos';

  // Campos monetários atômicos (B-01 originais + B-02 benefícios)
  const NUMERIC_FIELDS = [
    'hourlyRate',
    'internMonthlyStipend',
    'internMonthlyLimitHours',
    'internProportionalHourlyRate',
    'mealAllowance',
    'transportAllowance',
  ];

  // Pelo menos um dos campos salariais primários deve estar presente.
  // Benefícios (VR/VT/Outros) sozinhos não bastam para criar um registro inicial.
  const hasPrimaryValue = ['hourlyRate', 'internMonthlyStipend', 'internMonthlyLimitHours', 'internProportionalHourlyRate']
    .some(f => s[f] !== undefined && s[f] !== null);
  if (!hasPrimaryValue) return 'Informe ao menos um valor salarial primário (hora-aula ou bolsa).';

  // Não-negatividade dos campos numéricos
  for (const f of NUMERIC_FIELDS) {
    if (s[f] !== undefined && s[f] !== null && (typeof s[f] !== 'number' || !Number.isFinite(s[f]) || s[f] < 0)) {
      return `Valor inválido para ${f}: deve ser número não-negativo.`;
    }
  }

  // B-02 — otherBenefits deve ser null ou array de {nome:string, valor:number>=0}
  if (s.otherBenefits !== undefined && s.otherBenefits !== null) {
    if (!Array.isArray(s.otherBenefits)) return 'otherBenefits deve ser um array.';
    for (let i = 0; i < s.otherBenefits.length; i++) {
      const item = s.otherBenefits[i];
      if (!item || typeof item !== 'object') return `Item ${i + 1} de "Outros benefícios" inválido.`;
      if (typeof item.nome !== 'string' || !item.nome.trim()) {
        return `Item ${i + 1} de "Outros benefícios" precisa ter um nome.`;
      }
      if (typeof item.valor !== 'number' || !Number.isFinite(item.valor) || item.valor < 0) {
        return `Item "${item.nome}" precisa ter valor numérico não-negativo.`;
      }
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// SPRINT 2 — SCHEDULE SERVICES (Agenda Semanal Recorrente)
// ════════════════════════════════════════════════════════════════════════
// Coleções:
//   • schedule_templates — 1 template padrão por unidade (auto-criado)
//   • schedule_slots — slots recorrentes (weekday + HH:MM)
//   • classes — instâncias reais (Sprint 3, geradas por Cloud Function)
// Permissões: admin, admin_gestao, supervisao (todos podem CRUD na agenda)
// ────────────────────────────────────────────────────────────────────────

// ─── Helpers de horário ─────────────────────────────────────────────────

const WEEKDAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEKDAY_LABEL_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Converte 'HH:MM' para total de minutos desde 00:00. Retorna null se inválido. */
function timeToMinutes(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** Converte minutos para 'HH:MM' (zero-padded). */
function minutesToTime(min) {
  if (!Number.isFinite(min) || min < 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Duração em minutos entre dois HH:MM (assume mesmo dia). Negativo se invertido. */
function minutesBetween(start, end) {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  if (a === null || b === null) return null;
  return b - a;
}

/**
 * Dois slots se sobrepõem se:
 *   - estão no mesmo weekday E
 *   - intervalos [start, end) têm interseção não-vazia.
 * Tolerância: slots que apenas "encostam" (a.end == b.start) NÃO são conflito.
 */
function slotsOverlap(a, b) {
  if (a.weekday !== b.weekday) return false;
  const aStart = timeToMinutes(a.startTime);
  const aEnd   = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd   = timeToMinutes(b.endTime);
  if ([aStart, aEnd, bStart, bEnd].includes(null)) return false;
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

/**
 * Detecta conflitos do mesmo PROFESSOR no mesmo weekday.
 * Decisão D6 (sprint-2-agenda.md): mesmo professor + horário sobreposto = BLOQUEIA.
 * Mesma sala/horário com OUTRO professor = OK (academia pode rodar 2 modalidades simultâneas).
 *
 * @param newSlot — { weekday, startTime, endTime, teacherId } sendo criado/editado
 * @param existingSlots — array de slots ativos a comparar
 * @param ignoreSlotId — opcional, ignora este id na comparação (caso de edição do próprio slot)
 * @returns array de slots em conflito (vazio = sem conflito)
 */
function detectSlotConflict(newSlot, existingSlots, ignoreSlotId = null) {
  if (!newSlot || !Array.isArray(existingSlots)) return [];
  return existingSlots.filter(s =>
    s.id !== ignoreSlotId &&
    s.isActive !== false &&
    s.teacherId === newSlot.teacherId &&
    slotsOverlap(s, newSlot)
  );
}

// ─── ScheduleTemplateService ────────────────────────────────────────────

const ScheduleTemplateService = {
  /** Lista templates de uma unidade (ativos + inativos). */
  async list(unitId) {
    if (!unitId) return { success: false, error: 'unitId obrigatório' };
    try {
      const snap = await db.collection('schedule_templates').where('unitId', '==', unitId).get();
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return { success: true, data };
    } catch (err) {
      console.error('[ScheduleTemplateService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Garante que existe 1 template padrão ativo pra unidade.
   * Se não existir, cria. Retorna o template (existente ou recém-criado).
   * Sprint 2 decisão D2: 1 template padrão por unidade (múltiplos = backlog Sprint 2.5).
   */
  async getOrCreateDefault(unit) {
    if (!unit || !unit.id) return { success: false, error: 'unit obrigatório com id' };
    try {
      const existing = await this.list(unit.id);
      if (!existing.success) return existing;
      const active = existing.data.find(t => t.isActive !== false);
      if (active) return { success: true, data: active, created: false };

      // Cria template padrão
      const ref = db.collection('schedule_templates').doc();
      const now = firebase.firestore.Timestamp.now();
      const uid = currentUserId();
      const tpl = {
        unitId: unit.id,
        name: `Grade Padrão ${unit.name || unit.id}`,
        isActive: true,
        validFrom: now,
        validTo: null,
        createdAt: serverTs(),
        createdBy: uid,
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.set(tpl);

      await AuditService.log({
        type: 'schedule_template_created',
        details: `Template padrão "${tpl.name}" criado automaticamente`,
        entityType: 'schedule_template',
        entityId: ref.id,
        before: null, after: { ...tpl, id: ref.id },
        module: 'agenda',
      });

      return { success: true, data: { id: ref.id, ...tpl }, created: true };
    } catch (err) {
      console.error('[ScheduleTemplateService.getOrCreateDefault]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Renomeia/atualiza um template. */
  async update(templateId, patch) {
    if (!templateId) return { success: false, error: 'templateId obrigatório' };
    try {
      const ref = db.collection('schedule_templates').doc(templateId);
      const beforeDoc = await ref.get();
      const before = beforeDoc.exists ? beforeDoc.data() : null;
      const uid = currentUserId();
      const after = {
        ...(patch.name      !== undefined && { name: patch.name }),
        ...(patch.isActive  !== undefined && { isActive: patch.isActive }),
        ...(patch.validTo   !== undefined && { validTo: patch.validTo }),
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.update(after);
      await AuditService.log({
        type: 'schedule_template_updated',
        details: `Template "${before?.name || templateId}" atualizado`,
        entityType: 'schedule_template',
        entityId: templateId,
        before, after,
        module: 'agenda',
      });
      return { success: true };
    } catch (err) {
      console.error('[ScheduleTemplateService.update]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ─── ScheduleSlotService ────────────────────────────────────────────────

function validateSlot(s) {
  if (!s || typeof s !== 'object') return 'Dados do slot inválidos';
  if (!s.unitId) return 'unitId obrigatório';
  if (!s.templateId) return 'templateId obrigatório';
  if (typeof s.weekday !== 'number' || s.weekday < 0 || s.weekday > 6) {
    return 'Dia da semana inválido';
  }
  const startMin = timeToMinutes(s.startTime);
  const endMin = timeToMinutes(s.endTime);
  if (startMin === null) return 'Horário de início inválido (use HH:MM)';
  if (endMin === null)   return 'Horário de fim inválido (use HH:MM)';
  if (endMin <= startMin) return 'Horário de fim deve ser maior que o de início';
  if (endMin - startMin < 15) return 'Duração mínima do slot é 15 minutos';
  if (!s.modalityId) return 'Modalidade obrigatória';
  if (!s.teacherId)  return 'Professor obrigatório';
  return null;
}

const ScheduleSlotService = {
  /**
   * Lista slots de uma unidade.
   * @param unitId
   * @param opts.includeInactive — default false
   */
  async listByUnit(unitId, opts = {}) {
    if (!unitId) return { success: false, error: 'unitId obrigatório' };
    try {
      const snap = await db.collection('schedule_slots').where('unitId', '==', unitId).get();
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!opts.includeInactive) {
        data = data.filter(s => s.isActive !== false);
      }
      return { success: true, data };
    } catch (err) {
      console.error('[ScheduleSlotService.listByUnit]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async create(slotData) {
    const err = validateSlot(slotData);
    if (err) return { success: false, error: err };
    try {
      const ref = db.collection('schedule_slots').doc();
      const uid = currentUserId();
      const startMin = timeToMinutes(slotData.startTime);
      const endMin = timeToMinutes(slotData.endTime);
      const after = {
        templateId: slotData.templateId,
        unitId: slotData.unitId,
        weekday: slotData.weekday,
        startTime: slotData.startTime,
        endTime: slotData.endTime,
        durationMinutes: endMin - startMin,
        modalityId: slotData.modalityId,
        teacherId: slotData.teacherId,
        isActive: true,
        notes: (slotData.notes || '').toString().slice(0, 200),
        createdAt: serverTs(),
        createdBy: uid,
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.set(after);
      await AuditService.log({
        type: 'slot_created',
        details: `Slot ${WEEKDAY_LABEL_SHORT[after.weekday]} ${after.startTime}-${after.endTime} criado`,
        entityType: 'schedule_slot',
        entityId: ref.id,
        before: null, after: { ...after, id: ref.id },
        module: 'agenda',
      });
      return { success: true, data: { id: ref.id, ...after } };
    } catch (err) {
      console.error('[ScheduleSlotService.create]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async update(slotId, patch) {
    if (!slotId) return { success: false, error: 'slotId obrigatório' };
    const err = validateSlot({ ...patch, unitId: patch.unitId || 'placeholder', templateId: patch.templateId || 'placeholder' });
    if (err && !err.includes('obrigatório')) return { success: false, error: err };
    try {
      const ref = db.collection('schedule_slots').doc(slotId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Slot não encontrado' };
      const before = beforeDoc.data();
      const uid = currentUserId();
      const startMin = timeToMinutes(patch.startTime ?? before.startTime);
      const endMin = timeToMinutes(patch.endTime ?? before.endTime);
      const after = {
        ...(patch.weekday    !== undefined && { weekday: patch.weekday }),
        ...(patch.startTime  !== undefined && { startTime: patch.startTime }),
        ...(patch.endTime    !== undefined && { endTime: patch.endTime }),
        durationMinutes: endMin - startMin,
        ...(patch.modalityId !== undefined && { modalityId: patch.modalityId }),
        ...(patch.teacherId  !== undefined && { teacherId: patch.teacherId }),
        ...(patch.notes      !== undefined && { notes: (patch.notes || '').toString().slice(0, 200) }),
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.update(after);
      await AuditService.log({
        type: 'slot_updated',
        details: `Slot ${WEEKDAY_LABEL_SHORT[before.weekday]} ${before.startTime}-${before.endTime} atualizado`,
        entityType: 'schedule_slot',
        entityId: slotId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });
      return { success: true };
    } catch (err) {
      console.error('[ScheduleSlotService.update]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async deactivate(slotId) {
    return this._toggleActive(slotId, false, 'slot_deactivated', 'inativado');
  },

  async activate(slotId) {
    return this._toggleActive(slotId, true, 'slot_activated', 'reativado');
  },

  async _toggleActive(slotId, isActive, auditType, verb) {
    if (!slotId) return { success: false, error: 'slotId obrigatório' };
    try {
      const ref = db.collection('schedule_slots').doc(slotId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Slot não encontrado' };
      const before = beforeDoc.data();
      const uid = currentUserId();
      const after = { isActive, updatedAt: serverTs(), updatedBy: uid };
      await ref.update(after);
      await AuditService.log({
        type: auditType,
        details: `Slot ${WEEKDAY_LABEL_SHORT[before.weekday]} ${before.startTime}-${before.endTime} ${verb}`,
        entityType: 'schedule_slot',
        entityId: slotId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });
      return { success: true };
    } catch (err) {
      console.error('[ScheduleSlotService._toggleActive]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ════════════════════════════════════════════════════════════════════════
// SPRINT 3a — CLASS SERVICE (Instâncias reais de aula geradas por CF)
// ════════════════════════════════════════════════════════════════════════
// Coleção: classes/{slotId}_{YYYYMMDD}
// Geração: Cloud Function generateClassesForUpcomingWeeks (4 semanas rolling)
// Status: prevista | realizada | cancelada | nao_realizada | substituida (Sprint 3b)
// ────────────────────────────────────────────────────────────────────────

const CLASS_STATUS_LABEL = {
  prevista:       'Prevista',
  realizada:      'Realizada',
  cancelada:      'Cancelada',
  nao_realizada:  'Não realizada',
  substituida:    'Substituída',
};

const CLASS_STATUS_COLOR = {
  prevista:       { bg: 'rgba(94,168,255,0.15)',  border: '#5EA8FF', text: '#5EA8FF' },
  realizada:      { bg: 'rgba(140,200,90,0.15)',  border: '#8CC85A', text: '#8CC85A' },
  cancelada:      { bg: 'rgba(255,100,100,0.15)', border: '#FF6464', text: '#FF6464' },
  nao_realizada:  { bg: 'rgba(255,180,80,0.15)',  border: '#FFB450', text: '#FFB450' },
  substituida:    { bg: 'rgba(180,120,255,0.15)', border: '#B478FF', text: '#B478FF' },
};

// ─── Helpers de data ────────────────────────────────────────────────────

/** Início da semana (segunda) zerada (00:00) em horário local. */
function getStartOfWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();              // 0=Dom..6=Sáb
  const diff = day === 0 ? -6 : 1 - day;  // distância pra segunda
  date.setDate(date.getDate() + diff);
  return date;
}

/** Fim da semana (domingo) 23:59:59. */
function getEndOfWeek(d) {
  const start = getStartOfWeek(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** YYYY-MM-DD pra ID composto. */
function ymdFromDate(d) {
  const date = (d && d.toDate) ? d.toDate() : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/** Formato BR "Seg, 18/05/2026". */
function formatDateBR(ts) {
  if (!ts) return '—';
  const d = (ts && ts.toDate) ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const wd = WEEKDAY_LABEL_SHORT[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${wd}, ${dd}/${mm}/${yyyy}`;
}

const ClassService = {
  /**
   * Lista aulas de um professor num intervalo de datas.
   * @param teacherId
   * @param opts.from — Date | Timestamp (inclusivo)
   * @param opts.to — Date | Timestamp (inclusivo)
   * @param opts.includeAllStatuses — default true
   */
  async listByTeacher(teacherId, opts = {}) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    try {
      const fromTs = opts.from
        ? (opts.from.toDate ? opts.from : firebase.firestore.Timestamp.fromDate(opts.from))
        : null;
      const toTs = opts.to
        ? (opts.to.toDate ? opts.to : firebase.firestore.Timestamp.fromDate(opts.to))
        : null;

      let q = db.collection('classes').where('teacherId', '==', teacherId);
      if (fromTs) q = q.where('scheduledDate', '>=', fromTs);
      if (toTs)   q = q.where('scheduledDate', '<=', toTs);
      q = q.orderBy('scheduledDate', 'asc');

      const snap = await q.get();
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return { success: true, data };
    } catch (err) {
      console.error('[ClassService.listByTeacher]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getById(classId) {
    if (!classId) return { success: false, error: 'classId obrigatório' };
    try {
      const doc = await db.collection('classes').doc(classId).get();
      if (!doc.exists) return { success: false, error: 'Aula não encontrada' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      console.error('[ClassService.getById]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Altera status da aula. Só admin/gestao/supervisao (validado por Security Rule).
   * Sprint 3a aceita: prevista, realizada, cancelada, nao_realizada.
   * Status 'substituida' só via fluxo de Substituição (Sprint 3b).
   */
  async updateStatus(classId, newStatus, note = '') {
    if (!classId) return { success: false, error: 'classId obrigatório' };
    const allowed = ['prevista', 'realizada', 'cancelada', 'nao_realizada'];
    if (!allowed.includes(newStatus)) {
      return { success: false, error: `Status inválido: ${newStatus}` };
    }
    try {
      const ref = db.collection('classes').doc(classId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Aula não encontrada' };
      if (beforeDoc.data().monthClosingId) {
        return { success: false, error: 'Aula em mês fechado não pode ser alterada.' };
      }
      const before = beforeDoc.data();
      const uid = currentUserId();
      const after = {
        status: newStatus,
        adjustedBy: uid,
        adjustedAt: serverTs(),
        adjustmentNote: (note || '').toString().slice(0, 500) || null,
        updatedAt: serverTs(),
      };
      // Se mudando pra cancelada, registra como cancellationNote também
      if (newStatus === 'cancelada' && note) {
        after.cancellationNote = note.toString().slice(0, 500);
      }
      await ref.update(after);
      await AuditService.log({
        type: 'class_status_changed',
        details: `Status mudou de "${CLASS_STATUS_LABEL[before.status] || before.status}" para "${CLASS_STATUS_LABEL[newStatus]}"`,
        entityType: 'class',
        entityId: classId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });
      return { success: true };
    } catch (err) {
      console.error('[ClassService.updateStatus]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ════════════════════════════════════════════════════════════════════════
// SPRINT 3b — NOTIFICATIONS + SUBSTITUTIONS + COVERAGE
// ════════════════════════════════════════════════════════════════════════

// ─── Constantes de tipos de notificação ─────────────────────────────────
const NOTIF_TYPE_META = {
  substitution_requested:  { icon: '🔄', title: 'Pedido de substituição' },
  substitution_accepted:   { icon: '✅', title: 'Substituição aceita' },
  substitution_rejected:   { icon: '❌', title: 'Substituição recusada' },
  substitution_cancelled:  { icon: '🚫', title: 'Substituição cancelada' },
  coverage_available:      { icon: '🆘', title: 'Cobertura disponível' },
  coverage_taken:          { icon: '👍', title: 'Cobertura aceita' },
  coverage_cancelled:      { icon: '🚫', title: 'Cobertura cancelada' },
  recibo_emitido:          { icon: '📄', title: 'Recibo emitido' },
  pagamento_confirmado:    { icon: '💰', title: 'Pagamento confirmado' },
  vacation_requested:      { icon: '🏖️', title: 'Solicitação de férias' },
  vacation_approved:       { icon: '✅', title: 'Férias aprovadas' },
  vacation_rejected:       { icon: '❌', title: 'Férias recusadas' },
  vacation_cancelled:      { icon: '🚫', title: 'Férias canceladas' },
};

const SUBSTITUTION_STATUS_LABEL = {
  pending:   'Pendente',
  accepted:  'Aceita',
  rejected:  'Recusada',
  cancelled: 'Cancelada',
};

const COVERAGE_STATUS_LABEL = {
  open:      'Aberta',
  taken:     'Pega',
  cancelled: 'Cancelada',
};

// ─── NotificationService ────────────────────────────────────────────────

const NotificationService = {
  /** Lista notif NÃO LIDAS do user, ordenadas por mais recente. */
  async listUnread(userId, limit = 50) {
    if (!userId) return { success: false, error: 'userId obrigatório' };
    try {
      const snap = await db.collection('notifications')
        .where('recipientUserId', '==', userId)
        .where('isRead', '==', false)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[NotificationService.listUnread]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Lista as N últimas LIDAS pra aba histórico. */
  async listRead(userId, limit = 50) {
    if (!userId) return { success: false, error: 'userId obrigatório' };
    try {
      const snap = await db.collection('notifications')
        .where('recipientUserId', '==', userId)
        .where('isRead', '==', true)
        .orderBy('readAt', 'desc')
        .limit(limit)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[NotificationService.listRead]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async markAsRead(notifId) {
    if (!notifId) return { success: false, error: 'notifId obrigatório' };
    try {
      await db.collection('notifications').doc(notifId).update({
        isRead: true,
        readAt: serverTs(),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  },

  async markAllAsRead(userId) {
    if (!userId) return { success: false, error: 'userId obrigatório' };
    try {
      const snap = await db.collection('notifications')
        .where('recipientUserId', '==', userId)
        .where('isRead', '==', false)
        .get();
      if (snap.empty) return { success: true, count: 0 };
      const batch = db.batch();
      const now = serverTs();
      snap.docs.forEach(d => batch.update(d.ref, { isRead: true, readAt: now }));
      await batch.commit();
      return { success: true, count: snap.size };
    } catch (err) {
      console.error('[NotificationService.markAllAsRead]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Cria uma notificação. Usado client-side quando o ato é direto (ex: criar substituição).
   * Para fluxos disparados por CF (cobertura), CF cria diretamente via admin.firestore().
   */
  async create({ recipientUserId, type, title, body, link = null }) {
    if (!recipientUserId || !type) return { success: false, error: 'recipientUserId e type obrigatórios' };
    try {
      const meta = NOTIF_TYPE_META[type] || {};
      await db.collection('notifications').add({
        recipientUserId,
        type,
        title: title || meta.title || 'Notificação',
        body: body || '',
        link,
        isRead: false,
        readAt: null,
        createdAt: serverTs(),
      });
      return { success: true };
    } catch (err) {
      console.error('[NotificationService.create]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ─── SubstitutionService ────────────────────────────────────────────────

const SubstitutionService = {
  /**
   * Cria pedido de substituição direta.
   * @param {object} p - { classId, substituteTeacherId, substituteUserId, reason }
   */
  async create({ classId, substituteTeacherId, substituteUserId, reason }) {
    if (!classId) return { success: false, error: 'classId obrigatório' };
    if (!substituteTeacherId) return { success: false, error: 'Escolha um substituto' };

    try {
      const classDoc = await db.collection('classes').doc(classId).get();
      if (!classDoc.exists) return { success: false, error: 'Aula não encontrada' };
      const cls = classDoc.data();
      if (cls.monthClosingId) return { success: false, error: 'Aula em mês fechado.' };

      const now = new Date();
      const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
      const wasRetroactive = aulaDate < now;

      const ref = db.collection('substitutions').doc();
      const uid = currentUserId();
      const data = {
        classId,
        requestingTeacherId: cls.teacherId,
        requestingUserId: uid,
        substituteTeacherId,
        substituteUserId: substituteUserId || null,
        reason: (reason || '').toString().slice(0, 500),
        status: 'pending',
        wasRetroactive,
        isOfficial: false,
        requestedAt: serverTs(),
        respondedAt: null,
        responseNote: null,
        createdBy: uid,
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.set(data);

      // Notifica substituto (se vinculado a um user)
      if (substituteUserId) {
        await NotificationService.create({
          recipientUserId: substituteUserId,
          type: 'substitution_requested',
          body: buildSubstitutionNotifBody(cls, 'Pedido de substituição'),
          link: { type: 'substitution', id: ref.id },
        });
      }

      await AuditService.log({
        type: 'substitution_created',
        details: `Pedido de substituição criado (classId: ${classId})`,
        entityType: 'substitution', entityId: ref.id,
        before: null, after: { ...data, id: ref.id },
        module: 'agenda',
      });

      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[SubstitutionService.create]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async accept(subId, note = '') {
    return this._respond(subId, 'accepted', note);
  },

  async reject(subId, note = '') {
    return this._respond(subId, 'rejected', note);
  },

  async _respond(subId, newStatus, note) {
    if (!subId) return { success: false, error: 'subId obrigatório' };
    try {
      const ref = db.collection('substitutions').doc(subId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();
      if (before.status !== 'pending') {
        return { success: false, error: `Pedido já está como "${SUBSTITUTION_STATUS_LABEL[before.status]}".` };
      }
      const uid = currentUserId();
      const after = {
        status: newStatus,
        respondedAt: serverTs(),
        responseNote: (note || '').toString().slice(0, 500) || null,
        isOfficial: newStatus === 'accepted',
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.update(after);
      await AuditService.log({
        type: `substitution_${newStatus}`,
        details: `Substituição ${SUBSTITUTION_STATUS_LABEL[newStatus]}`,
        entityType: 'substitution', entityId: subId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });
      // Notif pro titular sobre aceite/recusa criada pela CF processSubstitutionAcceptance
      // (no caso de reject, criamos direto aqui — CF só dispara em accept pra fazer trabalho na class)
      if (newStatus === 'rejected') {
        await NotificationService.create({
          recipientUserId: before.requestingUserId,
          type: 'substitution_rejected',
          body: 'Seu pedido de substituição foi recusado.' + (note ? ' Motivo: ' + note : ''),
          link: { type: 'substitution', id: subId },
        });
      }
      return { success: true };
    } catch (err) {
      console.error('[SubstitutionService._respond]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async cancel(subId) {
    if (!subId) return { success: false, error: 'subId obrigatório' };
    try {
      const ref = db.collection('substitutions').doc(subId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();
      if (before.status !== 'pending') {
        return { success: false, error: 'Só pedidos pendentes podem ser cancelados.' };
      }
      const uid = currentUserId();
      const after = {
        status: 'cancelled',
        respondedAt: serverTs(),
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.update(after);
      await AuditService.log({
        type: 'substitution_cancelled',
        details: 'Pedido de substituição cancelado pelo titular',
        entityType: 'substitution', entityId: subId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });
      if (before.substituteUserId) {
        await NotificationService.create({
          recipientUserId: before.substituteUserId,
          type: 'substitution_cancelled',
          body: 'Um pedido de substituição direcionado a você foi cancelado.',
          link: { type: 'substitution', id: subId },
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Lista pedidos PENDENTES direcionados a este user. */
  async listPendingForSubstitute(userId) {
    if (!userId) return { success: false, error: 'userId obrigatório' };
    try {
      const snap = await db.collection('substitutions')
        .where('substituteUserId', '==', userId)
        .where('status', '==', 'pending')
        .orderBy('requestedAt', 'desc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[SubstitutionService.listPendingForSubstitute]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ─── CoverageService ────────────────────────────────────────────────────

const CoverageService = {
  /**
   * Cria pedido de cobertura aberta (sem substituto indicado).
   * @param {object} p - { classId, reason }
   */
  async request({ classId, reason }) {
    if (!classId) return { success: false, error: 'classId obrigatório' };
    try {
      const classDoc = await db.collection('classes').doc(classId).get();
      if (!classDoc.exists) return { success: false, error: 'Aula não encontrada' };
      const cls = classDoc.data();
      if (cls.monthClosingId) return { success: false, error: 'Aula em mês fechado.' };

      const now = new Date();
      const aulaDate = cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : new Date(cls.scheduledDate);
      const wasRetroactive = aulaDate < now;

      const ref = db.collection('coverage_applications').doc();
      const uid = currentUserId();
      const data = {
        classId,
        requestingTeacherId: cls.teacherId,
        requestingUserId: uid,
        modalityId: cls.modalityId,
        reason: (reason || '').toString().slice(0, 500),
        status: 'open',
        wasRetroactive,
        pickedByTeacherId: null,
        pickedByUserId: null,
        pickedAt: null,
        notifiedUserIds: [],  // CF vai preencher
        requestedAt: serverTs(),
        createdBy: uid,
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.set(data);
      // Notificações em massa são feitas pela CF notifyTeachersAboutCoverage
      await AuditService.log({
        type: 'coverage_requested',
        details: `Cobertura aberta solicitada (classId: ${classId})`,
        entityType: 'coverage_application', entityId: ref.id,
        before: null, after: { ...data, id: ref.id },
        module: 'agenda',
      });
      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[CoverageService.request]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Tenta pegar uma cobertura aberta. Transação evita 2 picks simultâneos.
   * @param {object} p - { coverageId, pickerTeacherId, pickerUserId }
   */
  async pick({ coverageId, pickerTeacherId, pickerUserId }) {
    if (!coverageId) return { success: false, error: 'coverageId obrigatório' };
    if (!pickerTeacherId) return { success: false, error: 'pickerTeacherId obrigatório' };
    try {
      const ref = db.collection('coverage_applications').doc(coverageId);
      const result = await db.runTransaction(async (txn) => {
        const doc = await txn.get(ref);
        if (!doc.exists) throw new Error('Cobertura não encontrada');
        const cov = doc.data();
        if (cov.status !== 'open') {
          throw new Error('Já foi pega por outro professor ou foi cancelada.');
        }
        txn.update(ref, {
          status: 'taken',
          pickedByTeacherId: pickerTeacherId,
          pickedByUserId: pickerUserId,
          pickedAt: serverTs(),
          updatedAt: serverTs(),
          updatedBy: pickerUserId,
        });
        return cov;
      });
      await AuditService.log({
        type: 'coverage_picked',
        details: `Cobertura ${coverageId} pega pelo teacher ${pickerTeacherId}`,
        entityType: 'coverage_application', entityId: coverageId,
        before: result, after: { ...result, status: 'taken', pickedByTeacherId: pickerTeacherId, pickedByUserId: pickerUserId },
        module: 'agenda',
      });
      // CF processCoveragePick atualiza classes + notifica titular
      return { success: true };
    } catch (err) {
      console.error('[CoverageService.pick]', err);
      return { success: false, error: err.message };
    }
  },

  async cancel(coverageId) {
    if (!coverageId) return { success: false, error: 'coverageId obrigatório' };
    try {
      const ref = db.collection('coverage_applications').doc(coverageId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Cobertura não encontrada' };
      const before = beforeDoc.data();
      if (before.status !== 'open') {
        return { success: false, error: 'Só coberturas abertas podem ser canceladas.' };
      }
      const uid = currentUserId();
      const after = {
        status: 'cancelled',
        updatedAt: serverTs(),
        updatedBy: uid,
      };
      await ref.update(after);
      await AuditService.log({
        type: 'coverage_cancelled',
        details: 'Cobertura aberta cancelada pelo titular',
        entityType: 'coverage_application', entityId: coverageId,
        before, after: { ...before, ...after },
        module: 'agenda',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Lista coberturas ABERTAS aptas pra este teacher (modalidade compatível).
   * Filtragem por modalidade é feita client-side via lista de modalityIds do teacher.
   */
  async listOpenForTeacher(teacherModalityIds = []) {
    try {
      const snap = await db.collection('coverage_applications')
        .where('status', '==', 'open')
        .orderBy('requestedAt', 'desc')
        .get();
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const apt = teacherModalityIds.length === 0
        ? all
        : all.filter(c => teacherModalityIds.includes(c.modalityId));
      return { success: true, data: apt };
    } catch (err) {
      console.error('[CoverageService.listOpenForTeacher]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// Helper para corpo das notificações de substituição
function buildSubstitutionNotifBody(cls, prefix = '') {
  const date = cls.scheduledDate && cls.scheduledDate.toDate ? cls.scheduledDate.toDate() : null;
  const dStr = date ? formatDateBR(date) : '';
  return `${prefix ? prefix + ' · ' : ''}${dStr} · ${cls.startTime}–${cls.endTime}`;
}

// ════════════════════════════════════════════════════════════════════════
// SPRINT 4a — CLOSING SERVICE (Fechamento Mensal)
// ════════════════════════════════════════════════════════════════════════
// Fluxo:
//   1. Admin seleciona unidade + mês/ano
//   2. ClosingService.preview() consolida classes realizadas/substituidas
//      do mês, agrupa por professor, calcula horas e valores
//   3. Admin revisa e clica "Fechar mês"
//   4. Cloud Function closeMonth cria monthly_closings + congela classes
// ────────────────────────────────────────────────────────────────────────

/**
 * Calcula horas totais de um array de classes.
 * Feriado (isHoliday) conta em dobro (P02).
 * @param {Array} classes — array de objetos de aula com durationMinutes e isHoliday
 * @returns {number} horas decimais (ex: 24.5)
 */
function calculateTeacherHours(classes, scaleTypesMap = null) {
  if (!Array.isArray(classes) || classes.length === 0) return 0;
  let totalMinutes = 0;
  for (const c of classes) {
    const mins = (typeof c.durationMinutes === 'number' && c.durationMinutes > 0) ? c.durationMinutes : 0;
    let weight = 1;
    // Peso variável por tipo de escala (Sprint 5a)
    if (c.specialScaleType && scaleTypesMap && scaleTypesMap.has(c.specialScaleType)) {
      weight = scaleTypesMap.get(c.specialScaleType).weight || 1;
    } else if (c.isHoliday === true) {
      weight = 2;  // fallback retrocompat (P02)
    }
    totalMinutes += mins * weight;
  }
  return totalMinutes / 60;
}

/**
 * Encontra os valores salariais efetivos no último dia do mês.
 * Percorre o salaryHistory de trás pra frente: começa com valores atuais
 * e "rebobina" mudanças com effectiveDate > targetDate.
 *
 * @param {Object} salary — doc de teacher_salaries
 * @param {Date} date — data-alvo (último dia do mês)
 * @returns {Object} snapshot dos campos salariais válidos na data
 */
function getEffectiveSalaryAt(salary, date) {
  if (!salary) return {};
  const result = { ...salary };
  const targetMs = date.getTime();

  if (!Array.isArray(salary.salaryHistory) || salary.salaryHistory.length === 0) {
    return result;
  }

  // Ordena por effectiveDate decrescente (mais recente primeiro)
  const sorted = [...salary.salaryHistory].sort((a, b) => {
    const ta = (a.effectiveDate && a.effectiveDate.toMillis) ? a.effectiveDate.toMillis() : 0;
    const tb = (b.effectiveDate && b.effectiveDate.toMillis) ? b.effectiveDate.toMillis() : 0;
    return tb - ta;
  });

  // Rebobina mudanças que ocorreram depois da data-alvo
  for (const entry of sorted) {
    const entryMs = (entry.effectiveDate && entry.effectiveDate.toMillis) ? entry.effectiveDate.toMillis() : 0;
    if (entryMs > targetMs) {
      result[entry.field] = entry.previousValue;
    }
  }

  return result;
}

/**
 * Retorna o internMonthlyStipend vigente em uma data específica.
 * Espelha a lógica de getEffectiveSalaryAt: percorre salaryHistory
 * rebobinando mudanças com effectiveDate > targetDate.
 */
function getEffectiveStipendAt(salaryData, date) {
  if (!salaryData) return 0;
  let stipend = salaryData.internMonthlyStipend || 0;
  const targetMs = date.getTime();

  if (!Array.isArray(salaryData.salaryHistory) || salaryData.salaryHistory.length === 0) {
    return stipend;
  }

  const sorted = [...salaryData.salaryHistory].sort((a, b) => {
    const ta = (a.effectiveDate && a.effectiveDate.toMillis) ? a.effectiveDate.toMillis() : 0;
    const tb = (b.effectiveDate && b.effectiveDate.toMillis) ? b.effectiveDate.toMillis() : 0;
    return tb - ta;
  });

  for (const entry of sorted) {
    const entryMs = (entry.effectiveDate && entry.effectiveDate.toMillis) ? entry.effectiveDate.toMillis() : 0;
    if (entryMs > targetMs && entry.field === 'internMonthlyStipend') {
      stipend = entry.previousValue;
    }
  }

  return stipend;
}

/**
 * Calcula valor a pagar para um professor.
 * Branch:
 *   - Efetivo/Eventual: horas × hourlyRate + VR + VT + Outros
 *   - Estagiário (bolsa): bolsa fixa (até limite) + proporcional do excedente + VR + VT + Outros
 *
 * @param {Object} teacher — doc de teachers
 * @param {Object} salary — doc de teacher_salaries (pode ser null)
 * @param {number} hours — horas calculadas por calculateTeacherHours()
 * @param {Date} lastDayOfMonth — último dia do mês para snapshot salarial
 * @returns {Object} { total, valorHoras, mealAllowance, transportAllowance, totalOutros, ...internDetails }
 */
function calculateTeacherValue(teacher, salary, hours, lastDayOfMonth) {
  if (!salary) {
    return {
      total: 0,
      valorHoras: 0,
      mealAllowance: 0,
      transportAllowance: 0,
      otherBenefits: [],
      totalOutros: 0,
      isInternProportional: false,
      internStipendUsed: null,
      internExcessHours: null,
      internExcessValue: null,
      hourlyRate: 0,
    };
  }

  const effective = getEffectiveSalaryAt(salary, lastDayOfMonth);

  const hourlyRate = (typeof effective.hourlyRate === 'number' && effective.hourlyRate > 0)
    ? effective.hourlyRate : 0;
  const meal = (typeof effective.mealAllowance === 'number') ? effective.mealAllowance : 0;
  const transport = (typeof effective.transportAllowance === 'number') ? effective.transportAllowance : 0;
  const otherBenefits = Array.isArray(effective.otherBenefits) ? effective.otherBenefits : [];
  const totalOutros = otherBenefits.reduce((sum, b) => sum + ((typeof b.valor === 'number') ? b.valor : 0), 0);

  let valorHoras = 0;
  let isInternProportional = false;
  let internStipendUsed = null;
  let internExcessHours = null;
  let internExcessValue = null;

  const isIntern = teacher.type === 'estagiario' && salary.remunerationType !== 'hora_aula';

  if (isIntern) {
    // Estagiário com bolsa — D6: usa internMonthlyLimitMinutes como threshold
    const limitMinutes = (typeof effective.internMonthlyLimitMinutes === 'number' && effective.internMonthlyLimitMinutes > 0)
      ? effective.internMonthlyLimitMinutes
      : ((typeof effective.internMonthlyLimitHours === 'number') ? effective.internMonthlyLimitHours * 60 : 0);
    const limitHours = limitMinutes / 60;
    const stipend = (typeof effective.internMonthlyStipend === 'number') ? effective.internMonthlyStipend : 0;
    const propRate = (typeof effective.internProportionalHourlyRate === 'number') ? effective.internProportionalHourlyRate : 0;

    if (hours <= limitHours) {
      valorHoras = stipend;
      internStipendUsed = stipend;
    } else {
      const excessHours = hours - limitHours;
      const excessValue = excessHours * propRate;
      valorHoras = stipend + excessValue;
      isInternProportional = true;
      internStipendUsed = stipend;
      internExcessHours = excessHours;
      internExcessValue = excessValue;
    }
  } else {
    // Efetivo ou eventual: horas × R$/h
    valorHoras = hours * hourlyRate;
  }

  const total = valorHoras + meal + transport + totalOutros;

  return {
    total,
    valorHoras,
    mealAllowance: meal,
    transportAllowance: transport,
    otherBenefits,
    totalOutros,
    hourlyRate,
    isInternProportional,
    internStipendUsed,
    internExcessHours,
    internExcessValue,
  };
}

const ClosingService = {
  /**
   * Retorna o ID composto do fechamento.
   * Formato: `${unitId}_${year}-${month}` (ex: unit-cp_2026-05)
   */
  getClosingId(unitId, year, month) {
    return `${unitId}_${year}-${String(month).padStart(2, '0')}`;
  },

  /**
   * Preview do fechamento — consolida classes do mês sem gravar nada.
   * Busca classes (realizada + substituida), agrupa por teacherId,
   * busca dados de teacher + salary, calcula horas e valores.
   *
   * @param {string} unitId
   * @param {number} year
   * @param {number} month — 1-12
   * @returns {{success, data: {unitId, year, month, teachers[], totals{}}}}
   */
  async preview(unitId, year, month) {
    if (!unitId) return { success: false, error: 'unitId obrigatório' };
    if (!year || !month) return { success: false, error: 'year e month obrigatórios' };

    try {
      // 1) Define intervalo do mês em horário BR (Bug D — usar boundaries locais)
      //    Janeiro: new Date(2026, 0, 1, 0, 0, 0) a new Date(2026, 0, 31, 23, 59, 59, 999)
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);  // day 0 do mês seguinte = último dia

      // 2) Query classes da unidade no intervalo
      const snap = await db.collection('classes')
        .where('unitId', '==', unitId)
        .where('scheduledDate', '>=', startDate)
        .where('scheduledDate', '<=', endDate)
        .get();

      const allClasses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 3) Filtra apenas status que contam pro fechamento (D9)
      const validClasses = allClasses.filter(c =>
        c.status === 'realizada' || c.status === 'substituida'
      );

      if (validClasses.length === 0) {
        return {
          success: true,
          data: {
            unitId, year, month,
            teachers: [],
            totals: { classesRealizadas: 0, totalHoras: 0, totalValor: 0 },
            isEmpty: true,
          },
        };
      }

      // 4) Extrai teacherIds únicos
      const teacherIds = [...new Set(validClasses.map(c => c.teacherId).filter(Boolean))];

      // 5) Busca docs de teachers
      const teacherMap = {};
      const teacherPromises = teacherIds.map(async (tid) => {
        const doc = await db.collection('teachers').doc(tid).get();
        if (doc.exists) teacherMap[tid] = { id: doc.id, ...doc.data() };
      });
      await Promise.all(teacherPromises);

      // 6) Busca docs de salary
      const salaryMap = {};
      const salaryPromises = teacherIds.map(async (tid) => {
        try {
          const doc = await db.collection('teacher_salaries').doc(tid).get();
          if (doc.exists) salaryMap[tid] = { id: doc.id, ...doc.data() };
        } catch (_) { /* permission-denied pra não-admin — ignora */ }
      });
      await Promise.all(salaryPromises);

      // 6b) Busca special_scale_types pra cálculo de peso (Sprint 5a)
      const stSnap = await db.collection('special_scale_types').get();
      const scaleTypesMap = new Map(stSnap.docs.map(d => [d.id, d.data()]));

      // 7) Agrupa classes por teacherId
      const grouped = {};
      for (const c of validClasses) {
        if (!grouped[c.teacherId]) grouped[c.teacherId] = [];
        grouped[c.teacherId].push(c);
      }

      // 8) Calcula por professor
      const teacherResults = [];
      let totalHoras = 0, totalValor = 0, totalClasses = 0;

      for (const [tid, classes] of Object.entries(grouped)) {
        const teacher = teacherMap[tid] || { id: tid, name: '(desconhecido)', type: 'efetivo' };
        const salary = salaryMap[tid] || null;

        const hours = calculateTeacherHours(classes, scaleTypesMap);
        const value = calculateTeacherValue(teacher, salary, hours, endDate);

        teacherResults.push({
          teacherId: tid,
          teacherName: teacher.name || '(desconhecido)',
          teacherType: teacher.type || 'efetivo',
          classesCount: classes.length,
          totalHoras: hours,
          hourlyRate: value.hourlyRate || 0,
          valorHoras: value.valorHoras,
          mealAllowance: value.mealAllowance,
          transportAllowance: value.transportAllowance,
          otherBenefits: value.otherBenefits,
          totalOutros: value.totalOutros,
          valorTotal: value.total,
          isInternProportional: value.isInternProportional,
          internStipendUsed: value.internStipendUsed,
          internExcessHours: value.internExcessHours,
          internExcessValue: value.internExcessValue,
        });

        totalHoras += hours;
        totalValor += value.total;
        totalClasses += classes.length;
      }

      // Ordena por nome
      teacherResults.sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'pt-BR'));

      return {
        success: true,
        data: {
          unitId, year, month,
          teachers: teacherResults,
          totals: {
            classesRealizadas: totalClasses,
            totalHoras: Math.round(totalHoras * 100) / 100,
            totalValor: Math.round(totalValor * 100) / 100,
          },
          isEmpty: false,
        },
      };
    } catch (err) {
      console.error('[ClosingService.preview]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Lista fechamentos de uma unidade, ordenados por ano/mês decrescente.
   */
  async list(unitId) {
    if (!unitId) return { success: false, error: 'unitId obrigatório' };
    try {
      const snap = await db.collection('monthly_closings')
        .where('unitId', '==', unitId)
        .get();

      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Ordena client-side: ano desc, mês desc
      data.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

      return { success: true, data };
    } catch (err) {
      console.error('[ClosingService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /**
   * Busca detalhe de um fechamento específico.
   */
  async getById(closingId) {
    if (!closingId) return { success: false, error: 'closingId obrigatório' };
    try {
      const doc = await db.collection('monthly_closings').doc(closingId).get();
      if (!doc.exists) return { success: false, error: 'Fechamento não encontrado' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      console.error('[ClosingService.getById]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ─── ReceiptService ─────────────────────────────────────────────────────

const ReceiptService = {
  /**
   * Emite um recibo individual com numeração atômica.
   * Transação: lê counter + cria recibo + abate créditos + atualiza counter.
   */
  async emit({ closingId, teacherId }) {
    if (!closingId || !teacherId) return { success: false, error: 'closingId e teacherId obrigatórios' };
    try {
      const counterRef = db.collection('meta').doc('receipt_counter');

      const result = await db.runTransaction(async (txn) => {
        // 1. Lê closing
        const closingDoc = await txn.get(db.collection('monthly_closings').doc(closingId));
        if (!closingDoc.exists) throw new Error('Fechamento não encontrado');
        const closing = closingDoc.data();
        const teacherEntry = (closing.teachers || []).find(t => t.teacherId === teacherId);
        if (!teacherEntry) throw new Error('Professor não está neste fechamento');

        // 2. Lê + incrementa contador
        const counterDoc = await txn.get(counterRef);
        const nextNumber = (counterDoc.exists ? counterDoc.data().value : 0) + 1;

        // 3. Busca créditos pendentes do professor (fora da transação pra evitar
        //    que a transação leia muitos docs)
        const credSnap = await db.collection('creditos_professores')
          .where('teacherId', '==', teacherId)
          .where('status', '==', 'pendente')
          .get();
        const creditos = credSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Ordena FIFO por registeredAt
        creditos.sort((a, b) => {
          const ta = a.registeredAt && a.registeredAt.toMillis ? a.registeredAt.toMillis() : 0;
          const tb = b.registeredAt && b.registeredAt.toMillis ? b.registeredAt.toMillis() : 0;
          return ta - tb;
        });
        const totalCredito = creditos.reduce((s, c) => s + (c.valor || 0), 0);

        const valorLiquido = (teacherEntry.valorTotal || 0) - totalCredito;

        // 4. Cria o receipt
        const receiptRef = db.collection('receipts').doc();
        const receiptData = {
          number: nextNumber,
          numberFormatted: String(nextNumber).padStart(4, '0'),
          closingId,
          unitId: closing.unitId || '',
          unitName: closing.unitName || '',
          year: closing.year,
          month: closing.month,
          teacherId,
          teacherName: teacherEntry.teacherName || '',
          teacherCpf: teacherEntry.teacherCpf || '',
          teacherType: teacherEntry.teacherType || '',
          closingValorTotal: teacherEntry.valorTotal || 0,
          closingValorHoras: teacherEntry.valorHoras || 0,
          closingHoras: teacherEntry.totalHoras || 0,
          creditosAplicados: creditos.map(c => ({
            creditoId: c.id, valor: c.valor,
            reciboOrigemNum: c.reciboOrigemNum, periodoOrigem: c.periodoOrigem
          })),
          totalCreditoAplicado: totalCredito,
          valorLiquido,
          // Sprint 6b — dados de férias pro recibo
          hasVacation: (teacherEntry.vacationDetails || []).length > 0,
          vacationValue: teacherEntry.vacationValue || 0,
          vacationDaysInMonth: teacherEntry.vacationDaysInMonth || 0,
          isVacationOnly: teacherEntry.isVacationOnly || false,
          vacationDetails: (teacherEntry.vacationDetails || []).map(vd => ({
            periodStart: vd.periodStart,
            periodEnd: vd.periodEnd,
            daysInMonth: vd.daysInMonth,
            paymentMode: vd.paymentMode || 'manual',
            baseMonthly: vd.baseMonthly || 0,
            proportionalBase: vd.proportionalBase || vd.proportionalValue || 0,
            oneThirdValue: vd.oneThirdValue || 0,
            proportionalValue: vd.proportionalValue || 0,
          })),
          status: 'aguardando_pagamento',
          emittedAt: serverTs(), emittedBy: currentUserId(), emittedByName: currentUserName(),
          paidAt: null, paidBy: null, paymentRecordId: null,
          createdAt: serverTs(), updatedAt: serverTs(),
        };
        txn.set(receiptRef, receiptData);

        // 5. Marca créditos como aplicados
        creditos.forEach(c => {
          txn.update(db.collection('creditos_professores').doc(c.id), {
            status: 'aplicado',
            appliedAt: serverTs(),
            appliedToReciboId: receiptRef.id,
            updatedAt: serverTs(),
          });
        });

        // 6. Atualiza contador
        txn.set(counterRef, { value: nextNumber, updatedAt: serverTs() }, { merge: true });

        return { id: receiptRef.id, ...receiptData };
      });

      // Audit log (fora da transação)
      await AuditService.log({
        type: 'receipt_emitted',
        details: `Recibo ${result.numberFormatted} emitido (${result.teacherName} · ${result.year}-${String(result.month).padStart(2,'0')})`,
        entityType: 'receipt', entityId: result.id,
        before: null, after: result,
        module: 'pagamentos',
      });

      // Notificação pro professor
      const userSnap = await db.collection('users').where('professorId', '==', teacherId).limit(1).get();
      if (!userSnap.empty) {
        await NotificationService.create({
          recipientUserId: userSnap.docs[0].id,
          type: 'recibo_emitido',
          title: 'Recibo emitido',
          body: `Recibo ${result.numberFormatted} emitido · R$ ${result.valorLiquido.toFixed(2)}`,
          link: { type: 'receipt', id: result.id },
        });
      }

      return { success: true, data: result };
    } catch (err) {
      console.error('[ReceiptService.emit]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Emissão em lote — loop sequencial pra garantir ordem de numeração. */
  async emitBatch({ closingId, teacherIds }) {
    const results = []; const errors = [];
    for (const teacherId of teacherIds) {
      const r = await this.emit({ closingId, teacherId });
      if (r.success) results.push(r.data);
      else errors.push({ teacherId, error: r.error });
    }
    return { success: errors.length === 0, data: { results, errors } };
  },

  /** Cancela recibo (só se aguardando_pagamento). Reverte créditos aplicados. */
  async cancel(receiptId) {
    if (!receiptId) return { success: false, error: 'receiptId obrigatório' };
    try {
      const ref = db.collection('receipts').doc(receiptId);
      const doc = await ref.get();
      if (!doc.exists) return { success: false, error: 'Recibo não encontrado' };
      const receipt = doc.data();
      if (receipt.status !== 'aguardando_pagamento') {
        return { success: false, error: 'Só é possível cancelar recibos com status aguardando_pagamento' };
      }

      // Reverte créditos aplicados para pendente
      const creditosAplicados = receipt.creditosAplicados || [];
      const batch = db.batch();
      for (const c of creditosAplicados) {
        if (c.creditoId) {
          batch.update(db.collection('creditos_professores').doc(c.creditoId), {
            status: 'pendente',
            appliedAt: null,
            appliedToReciboId: null,
            updatedAt: serverTs(),
          });
        }
      }
      // Marca recibo como cancelado
      batch.update(ref, {
        status: 'cancelado',
        updatedAt: serverTs(),
        creditosAplicados: [],
        totalCreditoAplicado: 0,
      });
      await batch.commit();

      await AuditService.log({
        type: 'receipt_cancelled',
        details: `Recibo ${receipt.numberFormatted} cancelado. ${creditosAplicados.length} crédito(s) revertido(s) para pendente.`,
        entityType: 'receipt', entityId: receiptId,
        before: receipt, after: { ...receipt, status: 'cancelado', creditosAplicados: [], totalCreditoAplicado: 0 },
        module: 'pagamentos',
      });

      return { success: true, data: { ...receipt, status: 'cancelado' } };
    } catch (err) {
      console.error('[ReceiptService.cancel]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getById(receiptId) {
    try {
      const doc = await db.collection('receipts').doc(receiptId).get();
      if (!doc.exists) return { success: false, error: 'Recibo não encontrado' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      console.error('[ReceiptService.getById]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByClosing(closingId) {
    try {
      const snap = await db.collection('receipts')
        .where('closingId', '==', closingId)
        .orderBy('number', 'desc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[ReceiptService.listByClosing]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByTeacher(teacherId) {
    try {
      const snap = await db.collection('receipts')
        .where('teacherId', '==', teacherId)
        .orderBy('emittedAt', 'desc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[ReceiptService.listByTeacher]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ─── PaymentService ──────────────────────────────────────────────────────

const PaymentService = {
  /** Confirma pagamento de um recibo. Cria payment_record + atualiza recibo. */
  async confirm(receiptId, { valor, metodo, obs } = {}) {
    if (!receiptId) return { success: false, error: 'receiptId obrigatório' };
    if (!valor || valor <= 0) return { success: false, error: 'Valor do pagamento deve ser > 0' };
    try {
      const receiptRef = db.collection('receipts').doc(receiptId);
      const receiptDoc = await receiptRef.get();
      if (!receiptDoc.exists) return { success: false, error: 'Recibo não encontrado' };
      const receipt = receiptDoc.data();
      if (receipt.status === 'cancelado') return { success: false, error: 'Recibo cancelado' };
      if (receipt.status === 'pago') return { success: false, error: 'Recibo já está pago' };

      // Cria payment_record
      const payRef = db.collection('payment_records').doc();
      const payData = {
        receiptId, receiptNumber: receipt.number,
        closingId: receipt.closingId, teacherId: receipt.teacherId,
        teacherName: receipt.teacherName, unitId: receipt.unitId,
        valor, metodo: metodo || 'outros', obs: obs || '',
        paidAt: serverTs(), paidBy: currentUserId(), paidByName: currentUserName(),
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      // Atualiza recibo e cria payment_record atomicamente
      const batch = db.batch();
      batch.set(payRef, payData);
      batch.update(receiptRef, {
        status: 'pago', paidAt: serverTs(), paidBy: currentUserId(),
        paymentRecordId: payRef.id, updatedAt: serverTs(),
      });
      await batch.commit();

      // Audit log
      await AuditService.log({
        type: 'payment_confirmed',
        details: `Pagamento confirmado · Recibo ${receipt.numberFormatted} · ${receipt.teacherName} · R$ ${valor.toFixed(2)}`,
        entityType: 'payment_record', entityId: payRef.id,
        before: receipt, after: { ...receipt, status: 'pago', paymentRecordId: payRef.id },
        module: 'pagamentos',
      });

      // Notificação
      const userSnap = await db.collection('users').where('professorId', '==', receipt.teacherId).limit(1).get();
      if (!userSnap.empty) {
        await NotificationService.create({
          recipientUserId: userSnap.docs[0].id,
          type: 'pagamento_confirmado',
          title: 'Pagamento confirmado',
          body: `Pagamento de R$ ${valor.toFixed(2)} confirmado · Recibo ${receipt.numberFormatted}`,
          link: { type: 'receipt', id: receiptId },
        });
      }

      return { success: true, data: { id: payRef.id, ...payData } };
    } catch (err) {
      console.error('[PaymentService.confirm]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByClosing(closingId) {
    try {
      const snap = await db.collection('payment_records')
        .where('closingId', '==', closingId)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[PaymentService.listByClosing]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listByTeacher(teacherId) {
    try {
      const snap = await db.collection('payment_records')
        .where('teacherId', '==', teacherId)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[PaymentService.listByTeacher]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ─── CreditService ────────────────────────────────────────────────────────

const CreditService = {
  /** Registra crédito (positivo = pagou a mais, negativo = pagou a menos). */
  async register({ teacherId, teacherName, valor, motivo, reciboOrigemId, reciboOrigemNum, periodoOrigem }) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    if (!valor || valor === 0) return { success: false, error: 'Valor do crédito não pode ser zero' };
    try {
      const ref = db.collection('creditos_professores').doc();
      const data = {
        teacherId, teacherName: teacherName || '',
        valor, motivo: motivo || '', reciboOrigemId: reciboOrigemId || null,
        reciboOrigemNum: reciboOrigemNum || null, periodoOrigem: periodoOrigem || '',
        status: 'pendente',
        appliedAt: null, appliedToReciboId: null,
        registeredAt: serverTs(), registeredBy: currentUserId(),
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      await ref.set(data);

      await AuditService.log({
        type: 'credit_registered',
        details: `Crédito de R$ ${valor.toFixed(2)} registrado · ${teacherName || teacherId} · Motivo: ${motivo || '(não informado)'}`,
        entityType: 'credito_professor', entityId: ref.id,
        before: null, after: data,
        module: 'pagamentos',
      });

      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[CreditService.register]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listPending(teacherId) {
    try {
      const snap = await db.collection('creditos_professores')
        .where('teacherId', '==', teacherId)
        .where('status', '==', 'pendente')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[CreditService.listPending]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async listHistory(teacherId) {
    try {
      const snap = await db.collection('creditos_professores')
        .where('teacherId', '==', teacherId)
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[CreditService.listHistory]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ═════════════════════════════════════════════════════════════════════
// Sprint 5a — SpecialScaleService
// ═════════════════════════════════════════════════════════════════════

const SpecialScaleService = {
  async list() {
    try {
      const snap = await db.collection('special_scales').orderBy('date', 'desc').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[SpecialScaleService.list]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async getById(id) {
    try {
      const doc = await db.collection('special_scales').doc(id).get();
      if (!doc.exists) return { success: false, error: 'Escala não encontrada' };
      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (err) {
      console.error('[SpecialScaleService.getById]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async create({ scaleTypeId, date, name, unitIds, description }) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Não autenticado');
      const dateBR = new Date(date + 'T03:00:00Z');  // meia-noite BR
      const ref = db.collection('special_scales').doc();
      const data = {
        scaleTypeId, name,
        date: firebase.firestore.Timestamp.fromDate(dateBR),
        unitIds: unitIds || [],
        description: description || '',
        appliedToClasses: [],
        appliedAt: null,
        isActive: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: user.uid,
        createdByName: user.displayName || user.email || user.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      };
      await ref.set(data);

      // Audit log
      await AuditService.log({
        type: 'special_scale_created',
        details: `Escala "${name}" (${scaleTypeId}) criada para ${date}`,
        module: 'escalas',
        entityType: 'special_scale',
        entityId: ref.id,
        after: data,
      });

      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[SpecialScaleService.create]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async update(id, { name, date, unitIds, description, scaleTypeId }) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Não autenticado');
      const ref = db.collection('special_scales').doc(id);
      const before = await ref.get();
      if (!before.exists) return { success: false, error: 'Escala não encontrada' };

      const updates = {
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      };
      if (name !== undefined) updates.name = name;
      if (scaleTypeId !== undefined) updates.scaleTypeId = scaleTypeId;
      if (description !== undefined) updates.description = description;
      if (unitIds !== undefined) updates.unitIds = unitIds;
      if (date !== undefined) {
        const dateBR = new Date(date + 'T03:00:00Z');
        updates.date = firebase.firestore.Timestamp.fromDate(dateBR);
      }

      await ref.update(updates);

      await AuditService.log({
        type: 'special_scale_updated',
        details: `Escala "${name || before.data().name}" atualizada`,
        module: 'escalas',
        entityType: 'special_scale',
        entityId: id,
        before: before.data(),
        after: { ...before.data(), ...updates },
      });

      return { success: true, data: { id, ...before.data(), ...updates } };
    } catch (err) {
      console.error('[SpecialScaleService.update]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  async deactivate(id) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Não autenticado');
      const ref = db.collection('special_scales').doc(id);
      await ref.update({
        isActive: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      });

      await AuditService.log({
        type: 'special_scale_deactivated',
        details: `Escala ${id} inativada`,
        module: 'escalas',
        entityType: 'special_scale',
        entityId: id,
      });

      return { success: true };
    } catch (err) {
      console.error('[SpecialScaleService.deactivate]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },

  /** Aplica uma escala a classes existentes da data + unidades. */
  async applyToClasses(scaleId) {
    try {
      const scaleDoc = await db.collection('special_scales').doc(scaleId).get();
      if (!scaleDoc.exists) return { success: false, error: 'Escala não encontrada' };
      const scale = { id: scaleDoc.id, ...scaleDoc.data() };

      const dObj = scale.date && scale.date.toDate ? scale.date.toDate() : new Date(scale.date);
      const startBR = new Date(Date.UTC(
        dObj.getUTCFullYear(), dObj.getUTCMonth(), dObj.getUTCDate(), BR_OFFSET_HOURS, 0, 0
      ));
      const endBR = new Date(startBR.getTime() + 24 * 60 * 60 * 1000 - 1);

      const unitIds = scale.unitIds || [];
      const appliedIds = [];

      for (const uid of unitIds) {
        const snap = await db.collection('classes')
          .where('unitId', '==', uid)
          .where('scheduledDate', '>=', firebase.firestore.Timestamp.fromDate(startBR))
          .where('scheduledDate', '<=', firebase.firestore.Timestamp.fromDate(endBR))
          .get();

        const batch = db.batch();
        snap.docs.forEach(d => {
          batch.update(d.ref, {
            specialScaleType: scale.scaleTypeId,
            specialScaleId: scaleId,
            isHoliday: scale.scaleTypeId === 'feriado' ? true : d.data().isHoliday,
            holidayName: scale.scaleTypeId === 'feriado' ? scale.name : d.data().holidayName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          appliedIds.push(d.id);
        });
        if (snap.docs.length > 0) await batch.commit();
      }

      // Atualiza o campo appliedToClasses na escala
      await db.collection('special_scales').doc(scaleId).update({
        appliedToClasses: appliedIds,
        appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await AuditService.log({
        type: 'special_scale_applied',
        details: `Escala "${scale.name}" aplicada a ${appliedIds.length} classes existentes`,
        module: 'escalas',
        entityType: 'special_scale',
        entityId: scaleId,
      });

      return { success: true, data: { appliedCount: appliedIds.length, classIds: appliedIds } };
    } catch (err) {
      console.error('[SpecialScaleService.applyToClasses]', err);
      return { success: false, error: err.message, code: err.code };
    }
  },
};

// ═════════════════════════════════════════════════════════════════════
// Sprint 6a — VacationService (Férias e Recesso)
// ═════════════════════════════════════════════════════════════════════

const ANTECEDENCIA_EFETIVO = 5;
const ANTECEDENCIA_ESTAGIARIO = 5;
const FERIAS_TOTAL_EFETIVO = 30;
const PRIMEIRO_PERIODO_MIN = 14;
const DEMAIS_PERIODOS_MIN = 5;
const RECESSO_MAX_ESTAGIARIO = 30;

function validateVacationRequest({ teacher, type, periods, force = false }) {
  if (teacher.type === 'eventual') {
    return 'Professores eventuais não têm direito formal a férias/recesso. Fale com a gestão.';
  }
  if (!Array.isArray(periods) || periods.length === 0 || periods.length > 3) {
    return 'Informe entre 1 e 3 períodos.';
  }
  const periodsWithDays = periods.map(p => {
    const start = p.startDate && p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
    const end = p.endDate && p.endDate.toDate ? p.endDate.toDate() : new Date(p.endDate);
    const days = Math.round((end - start) / 86400000) + 1;
    return { ...p, days, _start: start, _end: end };
  });

  // Datas futuras
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const p of periodsWithDays) {
    if (p._start < today) return 'Datas no passado não são permitidas.';
    if (p._end < p._start) return 'Data fim anterior à data início em um dos períodos.';
  }

  // Sobreposição
  for (let i = 0; i < periodsWithDays.length; i++) {
    for (let j = i + 1; j < periodsWithDays.length; j++) {
      if (periodsWithDays[i]._start <= periodsWithDays[j]._end
        && periodsWithDays[j]._start <= periodsWithDays[i]._end) {
        return 'Períodos se sobrepõem.';
      }
    }
  }

  // Antecedência
  if (!force) {
    const earliest = periodsWithDays.map(p => p._start).reduce((a, b) => a < b ? a : b);
    const diasAteIniciar = Math.round((earliest - today) / 86400000);
    const minAnt = teacher.type === 'efetivo' ? ANTECEDENCIA_EFETIVO : ANTECEDENCIA_ESTAGIARIO;
    if (diasAteIniciar < minAnt) {
      return `Antecedência mínima de ${minAnt} dias não atendida (faltam ${diasAteIniciar} dias).`;
    }
  }

  const totalDays = periodsWithDays.reduce((s, p) => s + p.days, 0);

  if (teacher.type === 'efetivo') {
    if (totalDays !== FERIAS_TOTAL_EFETIVO) {
      return `CLT exige total de ${FERIAS_TOTAL_EFETIVO} dias para efetivo (informado: ${totalDays}).`;
    }
    if (periodsWithDays.length > 1) {
      const sorted = [...periodsWithDays].sort((a, b) => b.days - a.days);
      if (sorted[0].days < PRIMEIRO_PERIODO_MIN) {
        return `1º período deve ter no mínimo ${PRIMEIRO_PERIODO_MIN} dias (CLT).`;
      }
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].days < DEMAIS_PERIODOS_MIN) {
          return `Demais períodos devem ter no mínimo ${DEMAIS_PERIODOS_MIN} dias cada.`;
        }
      }
    }
  } else if (teacher.type === 'estagiario') {
    if (totalDays > RECESSO_MAX_ESTAGIARIO) {
      return `Recesso máximo de ${RECESSO_MAX_ESTAGIARIO} dias (informado: ${totalDays}).`;
    }
    if (periodsWithDays.some(p => p.days < DEMAIS_PERIODOS_MIN)) {
      return `Mínimo ${DEMAIS_PERIODOS_MIN} dias por período.`;
    }
  }

  return null;  // OK
}

const VacationService = {
  async request({ teacherId, periods, reason, force = false }) {
    if (!teacherId) return { success: false, error: 'teacherId obrigatório' };
    try {
      const teacherDoc = await db.collection('teachers').doc(teacherId).get();
      if (!teacherDoc.exists) return { success: false, error: 'Professor não encontrado' };
      const teacher = teacherDoc.data();

      const type = teacher.type === 'estagiario' ? 'recesso' : 'ferias';

      const validationErr = validateVacationRequest({ teacher, type, periods, force });
      if (validationErr) return { success: false, error: validationErr };

      const sortedPeriods = periods.map(p => {
        const start = p.startDate && p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
        const end = p.endDate && p.endDate.toDate ? p.endDate.toDate() : new Date(p.endDate);
        const days = Math.round((end - start) / 86400000) + 1;
        return {
          startDate: firebase.firestore.Timestamp.fromDate(start),
          endDate: firebase.firestore.Timestamp.fromDate(end),
          days,
        };
      }).sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());
      const totalDays = sortedPeriods.reduce((s, p) => s + p.days, 0);

      const ref = db.collection('vacation_requests').doc();
      const uid = currentUserId();
      const data = {
        teacherId,
        teacherName: teacher.name,
        teacherType: teacher.type,
        unitId: teacher.primaryUnitId || (teacher.unitIds && teacher.unitIds[0]) || null,
        type,
        periods: sortedPeriods,
        totalDays,
        // ─── Sprint 6b — denormalização pra query por período ───
        firstPeriodStart: sortedPeriods[0].startDate,
        lastPeriodEnd: sortedPeriods[sortedPeriods.length - 1].endDate,
        reason: (reason || '').toString().slice(0, 500),
        status: 'pendente',
        requestedAt: serverTs(),
        requestedBy: uid,
        requestedByName: currentUserName(),
        respondedAt: null, respondedBy: null, respondedByName: null, responseNote: null,
        cancelledAt: null, cancelledBy: null, cancelReason: null,
        createdAt: serverTs(), updatedAt: serverTs(),
      };
      await ref.set(data);

      // Notif pros admins/gestão
      const adminsSnap = await db.collection('users')
        .where('profiles', 'array-contains-any', ['admin', 'admin_gestao'])
        .get();
      for (const u of adminsSnap.docs) {
        await NotificationService.create({
          recipientUserId: u.id,
          type: 'vacation_requested',
          title: 'Nova solicitação de férias',
          body: `${teacher.name} (${teacher.type}) solicitou ${type} · ${totalDays} dias`,
          link: { type: 'vacation', id: ref.id },
        });
      }

      await AuditService.log({
        type: 'vacation_requested',
        details: `Solicitação de ${type} criada (${teacher.name} · ${totalDays} dias)`,
        entityType: 'vacation_request', entityId: ref.id,
        before: null, after: { ...data, id: ref.id },
        module: 'ferias',
      });

      return { success: true, data: { id: ref.id, ...data } };
    } catch (err) {
      console.error('[VacationService.request]', err);
      return { success: false, error: err.message };
    }
  },

  async approve(reqId, note = '', paymentData = null) { return this._respond(reqId, 'aprovada', note, paymentData); },
  async reject(reqId, note) {
    if (!note) return { success: false, error: 'Motivo da recusa é obrigatório' };
    return this._respond(reqId, 'recusada', note);
  },

  async _respond(reqId, status, note, paymentData = null) {
    try {
      const ref = db.collection('vacation_requests').doc(reqId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();
      if (before.status !== 'pendente') return { success: false, error: `Pedido já está como "${before.status}"` };

      const uid = currentUserId();
      const after = {
        status,
        respondedAt: serverTs(),
        respondedBy: uid,
        respondedByName: currentUserName(),
        responseNote: (note || '').toString().slice(0, 500) || null,
        updatedAt: serverTs(),
      };

      // Sprint 6b — se veio paymentData, inclui payment no mesmo update
      if (paymentData) {
        after.payment = {
          mode: paymentData.mode,
          value: paymentData.value || 0,
          calculation: paymentData.calculation || null,
          notes: paymentData.notes || null,
          setBy: currentUserId(),
          setByName: currentUserName(),
          setAt: serverTs(),
          updatedBy: null,
          updatedByName: null,
          updatedAt: null,
        };

        // Notificação de pagamento (junto com a aprovação)
        if (paymentData.mode !== 'deferred') {
          await NotificationService.create({
            recipientUserId: before.requestedBy,
            type: 'vacation_payment_set',
            title: 'Pagamento de férias definido',
            body: paymentData.value > 0
              ? `${before.type} de ${before.totalDays} dias — R$ ${paymentData.value.toFixed(2)} (${paymentData.mode})`
              : `${before.type} de ${before.totalDays} dias registrada sem pagamento`,
            link: { type: 'vacation', id: reqId },
          });
        }

        await AuditService.log({
          type: 'vacation_payment_set',
          details: `Definido pagamento de ${before.type} ${before.teacherName}: R$ ${(paymentData.value || 0).toFixed(2)} (${paymentData.mode})`,
          entityType: 'vacation_request', entityId: reqId,
          before: { payment: null },
          after: { payment: after.payment },
          module: 'ferias',
        });
      }

      await ref.update(after);

      await NotificationService.create({
        recipientUserId: before.requestedBy,
        type: status === 'aprovada' ? 'vacation_approved' : 'vacation_rejected',
        title: status === 'aprovada' ? 'Férias aprovadas' : 'Férias recusadas',
        body: status === 'aprovada'
          ? `Suas ${before.type} foram aprovadas (${before.totalDays} dias)`
          : `Suas ${before.type} foram recusadas. Motivo: ${note}`,
        link: { type: 'vacation', id: reqId },
      });

      await AuditService.log({
        type: `vacation_${status}`,
        details: `${status === 'aprovada' ? 'Aprovada' : 'Recusada'} ${before.type} de ${before.teacherName}${note ? ' · ' + note : ''}`,
        entityType: 'vacation_request', entityId: reqId,
        before, after: { ...before, ...after },
        module: 'ferias',
      });
      return { success: true };
    } catch (err) {
      console.error('[VacationService._respond]', err);
      return { success: false, error: err.message };
    }
  },

  async cancel(reqId, reason = '') {
    try {
      const ref = db.collection('vacation_requests').doc(reqId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();
      const uid = currentUserId();
      const after = {
        status: 'cancelada',
        cancelledAt: serverTs(),
        cancelledBy: uid,
        cancelReason: (reason || '').toString().slice(0, 500) || null,
        updatedAt: serverTs(),
      };
      await ref.update(after);

      // Notif: se admin cancelou, avisa solicitante; se solicitante cancelou, avisa admins
      const isSelfCancel = before.requestedBy === uid;
      if (isSelfCancel) {
        const adminsSnap = await db.collection('users')
          .where('profiles', 'array-contains-any', ['admin', 'admin_gestao'])
          .get();
        for (const u of adminsSnap.docs) {
          await NotificationService.create({
            recipientUserId: u.id,
            type: 'vacation_cancelled',
            title: 'Pedido de férias cancelado',
            body: `${before.teacherName} cancelou o pedido de ${before.type}`,
            link: { type: 'vacation', id: reqId },
          });
        }
      } else {
        await NotificationService.create({
          recipientUserId: before.requestedBy,
          type: 'vacation_cancelled',
          title: 'Pedido de férias cancelado',
          body: `Seu pedido de ${before.type} foi cancelado pela gestão.`,
          link: { type: 'vacation', id: reqId },
        });
      }

      await AuditService.log({
        type: 'vacation_cancelled',
        details: `Pedido de ${before.type} cancelado (${before.teacherName})`,
        entityType: 'vacation_request', entityId: reqId,
        before, after: { ...before, ...after },
        module: 'ferias',
      });
      return { success: true };
    } catch (err) {
      console.error('[VacationService.cancel]', err);
      return { success: false, error: err.message };
    }
  },

  async listByTeacher(teacherId) {
    try {
      const snap = await db.collection('vacation_requests')
        .where('teacherId', '==', teacherId)
        .orderBy('requestedAt', 'desc')
        .get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[VacationService.listByTeacher]', err);
      return { success: false, error: err.message };
    }
  },

  async listAll({ status, unitId } = {}) {
    try {
      let q = db.collection('vacation_requests');
      if (status) q = q.where('status', '==', status);
      if (unitId) q = q.where('unitId', '==', unitId);
      const snap = await q.orderBy('requestedAt', 'desc').get();
      return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (err) {
      console.error('[VacationService.listAll]', err);
      return { success: false, error: err.message };
    }
  },
};

// ─── Sprint 6b — VacationPaymentService ─────────────────────────────────────

const VacationPaymentService = {

  // ─── calculateForRequest ───────────────────────────────────────────────
  async calculateForRequest(req, opts = {}) {
    if (!req || !req.teacherId || !Array.isArray(req.periods)) {
      return { success: false, error: 'vacation_request inválido' };
    }
    const mode = opts.mode || 'auto';
    const notes = (opts.notes || '').trim();

    if (mode === 'deferred') {
      return { success: true, data: { mode: 'deferred', value: 0, calculation: null, notes: notes || 'Pagamento adiado pelo admin' } };
    }

    if (mode === 'none') {
      if (!notes) return { success: false, error: 'Justificativa obrigatória para "sem pagamento".' };
      return { success: true, data: { mode: 'none', value: 0, calculation: null, notes } };
    }

    if (mode === 'manual') {
      const value = parseFloat(opts.manualValue);
      if (isNaN(value) || value < 0) return { success: false, error: 'Valor manual inválido.' };
      if (value === 0 && !notes) return { success: false, error: 'Observação obrigatória se valor manual é zero.' };
      return { success: true, data: { mode: 'manual', value, calculation: null, notes: notes || null } };
    }

    // mode === 'auto'
    if (req.teacherType === 'efetivo') return this._calculateEfetivoAuto(req, notes);
    if (req.teacherType === 'estagiario') {
      if (opts.payIntern === false) {
        return { success: true, data: { mode: 'none', value: 0, calculation: null, notes: notes || 'Estagiário sem bolsa proporcional nesta solicitação.' } };
      }
      return this._calculateEstagiarioAuto(req, notes);
    }
    return { success: false, error: 'Tipo de professor não suportado.' };
  },

  // ─── _calculateEfetivoAuto (v2 com MAX) ─────────────────────────────────
  async _calculateEfetivoAuto(req, notes) {
    const db = firebase.firestore();
    // Nota v2.1: removido where('status','==','fechado') — único valor possível em monthly_closings,
    // filtro redundante que exigia índice composto não declarado.
    const snap = await db.collection('monthly_closings')
      .where('unitId', '==', req.unitId)
      .orderBy('year', 'desc').orderBy('month', 'desc')
      .limit(12).get();

    const monthsData = [];
    snap.docs.forEach(d => {
      const data = d.data();
      const t = (data.teachers || []).find(x => x.teacherId === req.teacherId);
      if (t && typeof t.valorHoras === 'number' && t.valorHoras > 0) {
        monthsData.push({ valorHoras: t.valorHoras, year: data.year, month: data.month });
      }
    });

    if (monthsData.length < 3) {
      return { success: false, error: `Histórico insuficiente (${monthsData.length} meses com horas). Defina pagamento manual.` };
    }

    const base12mAvg = monthsData.reduce((a, b) => a + b.valorHoras, 0) / monthsData.length;
    const baseLastMonth = monthsData[0].valorHoras;
    const baseMonthly = Math.max(base12mAvg, baseLastMonth);

    const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
    const proportionalBase = baseMonthly * daysCount / 30;
    const oneThirdValue = proportionalBase / 3;
    const value = Math.round((proportionalBase + oneThirdValue) * 100) / 100;

    return {
      success: true,
      data: {
        mode: 'auto', value,
        calculation: {
          baseMonthly: Math.round(baseMonthly * 100) / 100,
          base12mAvg: Math.round(base12mAvg * 100) / 100,
          baseLastMonth: Math.round(baseLastMonth * 100) / 100,
          monthsConsidered: monthsData.length,
          oneThirdValue: Math.round(oneThirdValue * 100) / 100,
          proportionalBase: Math.round(proportionalBase * 100) / 100,
          daysCount,
          formula: 'efetivo-clt-max',
        },
        notes: notes || null,
      }
    };
  },

  // ─── _calculateEstagiarioAuto ────────────────────────────────────────────
  async _calculateEstagiarioAuto(req, notes) {
    const db = firebase.firestore();
    const earliestStart = req.periods.reduce((min, p) => {
      const d = p.startDate.toDate ? p.startDate.toDate() : new Date(p.startDate);
      return (!min || d < min) ? d : min;
    }, null);

    const salaryDoc = await db.collection('teacher_salaries').doc(req.teacherId).get();
    if (!salaryDoc.exists) {
      return { success: false, error: 'Cadastro salarial do estagiário não encontrado.' };
    }
    const stipend = getEffectiveStipendAt(salaryDoc.data(), earliestStart);
    if (!stipend || stipend <= 0) {
      return { success: false, error: 'Bolsa mensal não definida para esta data. Use modo manual ou registre como sem pagamento.' };
    }

    const daysCount = (req.periods || []).reduce((s, p) => s + (p.days || 0), 0);
    const proportionalBase = stipend * daysCount / 30;
    const value = Math.round(proportionalBase * 100) / 100;

    return {
      success: true,
      data: {
        mode: 'auto', value,
        calculation: {
          baseMonthly: stipend, base12mAvg: stipend, baseLastMonth: stipend,
          monthsConsidered: 1,
          oneThirdValue: 0, proportionalBase: value,
          daysCount, formula: 'estagiario-bolsa-proporcional',
        },
        notes: notes || null,
      }
    };
  },

  // ─── getInternPayDefault ──────────────────────────────────────────────────
  getInternPayDefault(teacher, salaryData) {
    if (teacher.type !== 'estagiario') return false;
    const stipend = getEffectiveStipendAt(salaryData, new Date());
    return stipend > 0;
  },

  // ─── setPayment ───────────────────────────────────────────────────────────
  async setPayment(reqId, paymentData) {
    if (!reqId || !paymentData) return { success: false, error: 'Argumentos obrigatórios' };
    const db = firebase.firestore();
    try {
      const ref = db.collection('vacation_requests').doc(reqId);
      const beforeDoc = await ref.get();
      if (!beforeDoc.exists) return { success: false, error: 'Pedido não encontrado' };
      const before = beforeDoc.data();

      if (before.status !== 'aprovada') {
        return { success: false, error: 'Só é possível definir pagamento em férias aprovadas.' };
      }
      if (Array.isArray(before.paidInClosingIds) && before.paidInClosingIds.length > 0) {
        return { success: false, error: 'Pagamento já foi processado em fechamento — não pode ser editado.' };
      }

      const uid = currentUserId();
      const isUpdate = before.payment && before.payment.setAt;

      const payment = {
        mode: paymentData.mode,
        value: paymentData.value || 0,
        calculation: paymentData.calculation || null,
        notes: paymentData.notes || null,
      };

      if (isUpdate) {
        payment.setBy = before.payment.setBy;
        payment.setByName = before.payment.setByName;
        payment.setAt = before.payment.setAt;
        payment.updatedBy = uid;
        payment.updatedByName = currentUserName();
        payment.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      } else {
        payment.setBy = uid;
        payment.setByName = currentUserName();
        payment.setAt = firebase.firestore.FieldValue.serverTimestamp();
        payment.updatedBy = null;
        payment.updatedByName = null;
        payment.updatedAt = null;
      }

      await ref.update({
        payment,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // Notificação ao professor (só se NÃO é deferred)
      if (payment.mode !== 'deferred') {
        await NotificationService.create({
          recipientUserId: before.requestedBy,
          type: 'vacation_payment_set',
          title: isUpdate ? 'Pagamento de férias atualizado' : 'Pagamento de férias definido',
          body: payment.value > 0
            ? `${before.type} de ${before.totalDays} dias — R$ ${payment.value.toFixed(2)} (${payment.mode})`
            : `${before.type} de ${before.totalDays} dias registrada sem pagamento`,
          link: { type: 'vacation', id: reqId },
        });
      }

      await AuditService.log({
        type: isUpdate ? 'vacation_payment_updated' : 'vacation_payment_set',
        details: `${isUpdate ? 'Atualizado' : 'Definido'} pagamento de ${before.type} ${before.teacherName}: R$ ${payment.value.toFixed(2)} (${payment.mode})`,
        entityType: 'vacation_request', entityId: reqId,
        before: { payment: before.payment || null },
        after: { payment },
        module: 'ferias',
      });

      return { success: true, data: payment };
    } catch (err) {
      console.error('[VacationPaymentService.setPayment]', err);
      return { success: false, error: err.message };
    }
  },

  // ─── updatePayment ────────────────────────────────────────────────────────
  async updatePayment(reqId, paymentData) {
    return this.setPayment(reqId, paymentData);
  },

  // ─── previewMonthlyImpact ─────────────────────────────────────────────────
  async previewMonthlyImpact(reqId, year, month) {
    const db = firebase.firestore();
    const doc = await db.collection('vacation_requests').doc(reqId).get();
    if (!doc.exists) return { success: false, error: 'Pedido não encontrado' };
    const req = { id: doc.id, ...doc.data() };
    if (!req.payment || req.payment.value <= 0) {
      return { success: false, error: 'Pedido sem pagamento definido' };
    }

    const monthStart = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 3, 0, 0));
    monthEnd.setUTCHours(26, 59, 59, 999);

    let daysInMonth = 0;
    for (const p of (req.periods || [])) {
      const ps = p.startDate.toDate();
      const pe = p.endDate.toDate();
      const clipStart = ps < monthStart ? monthStart : ps;
      const clipEnd = pe > monthEnd ? monthEnd : pe;
      if (clipStart > clipEnd) continue;
      daysInMonth += Math.round((clipEnd - clipStart) / 86400000) + 1;
    }

    if (daysInMonth === 0) return { success: true, data: { daysInMonth: 0, proportionalValue: 0 } };

    const proportionalValue = Math.round((req.payment.value * daysInMonth / req.totalDays) * 100) / 100;
    return { success: true, data: { daysInMonth, proportionalValue } };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 6c — VacationBalanceService
// ═══════════════════════════════════════════════════════════════════════════

const VacationBalanceService = {

  /**
   * Calcula o saldo de férias de um professor.
   * @returns { success, data: { teacherId, teacherName, teacherType, currentPeriod,
   *   status, grantPeriod, history, estimatedStartDate } }
   */
  async getBalance(teacherId) {
    const teacherDoc = await db.collection('teachers').doc(teacherId).get();
    if (!teacherDoc.exists) return { success: false, error: 'Professor não encontrado' };
    const teacher = { id: teacherDoc.id, ...teacherDoc.data() };

    if (teacher.type === 'eventual') {
      return { success: false, error: 'Eventuais não têm direito formal a férias.' };
    }

    const periods = listAcquisitionPeriods(teacher);
    if (periods.length === 0) {
      return { success: false, error: 'Sem dados para calcular período aquisitivo.' };
    }

    // Busca todas as vacation_requests aprovadas
    const vacSnap = await db.collection('vacation_requests')
      .where('teacherId', '==', teacherId)
      .where('status', '==', 'aprovada').get();
    const allVacs = vacSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Atribui cada vacation_request ao período aquisitivo onde cai firstPeriodStart
    const vacsByPeriod = {};
    for (const v of allVacs) {
      let startDate;
      if (v.firstPeriodStart) {
        startDate = v.firstPeriodStart.toDate ? v.firstPeriodStart.toDate() : new Date(v.firstPeriodStart);
      } else if (v.periods && v.periods[0] && v.periods[0].startDate) {
        const ps = v.periods[0].startDate;
        startDate = ps.toDate ? ps.toDate() : new Date(ps);
      } else {
        continue; // sem data, não atribui
      }
      const period = periods.find(p => p.startDate <= startDate && startDate <= p.endDate);
      if (period) {
        if (!vacsByPeriod[period.index]) vacsByPeriod[period.index] = [];
        vacsByPeriod[period.index].push(v);
      }
    }

    // Calcula daysTaken por período
    const periodsWithUsage = periods.map(p => {
      const vacs = vacsByPeriod[p.index] || [];
      const daysTaken = vacs.reduce((s, v) => s + (v.totalDays || 0), 0);
      return {
        ...p,
        daysTaken,
        daysRemaining: Math.max(0, p.entitledDays - daysTaken),
        vacationRequestIds: vacs.map(v => v.id),
      };
    });

    // Período atual
    const now = new Date();
    const currentIdx = periodsWithUsage.findIndex(p => p.startDate <= now && now <= p.endDate);
    const current = currentIdx >= 0
      ? periodsWithUsage[currentIdx]
      : periodsWithUsage[periodsWithUsage.length - 1];

    // Status legal
    let status = 'ok';
    let grantDeadline = null;
    let daysOverdue = 0;

    if (current.endDate < now) {
      // Aquisitivo terminou, está em período concessivo.
      // Concessivo dura 12 meses APÓS o fim do aquisitivo (CLT Art. 134).
      // Deadline = endDate + 12 meses (último dia válido pra tirar férias).
      grantDeadline = addMonths(current.endDate, 12);
      if (now > grantDeadline) {
        status = 'overdue';
        daysOverdue = Math.floor((now - grantDeadline) / 86400000);
      } else {
        const monthsLeft = (grantDeadline - now) / (30 * 86400000);
        status = monthsLeft < 6 ? 'warning' : 'ok';
      }
    }

    // Histórico (períodos passados)
    const history = periodsWithUsage
      .slice(0, currentIdx >= 0 ? currentIdx : periodsWithUsage.length - 1)
      .map(p => {
        // Deadline do concessivo = aquisitivo.endDate + 12 meses (CLT Art. 134).
        const concessiveEnd = addMonths(p.endDate, 12);
        return {
          ...p,
          status: p.daysRemaining === 0
            ? 'closed'
            : (now > concessiveEnd ? 'expired' : 'pending'),
        };
      });

    // Sprint 6c fix: status agregado precisa considerar histórico.
    // Se há QUALQUER período expired no histórico, o prof tem férias vencidas
    // mesmo que o current esteja dentro do aquisitivo válido.
    const expiredPeriods = history.filter(p => p.status === 'expired');
    const expiredPeriodsCount = expiredPeriods.length;
    let aggregatedStatus = status;
    let aggregatedDaysOverdue = daysOverdue;
    if (expiredPeriodsCount > 0) {
      aggregatedStatus = 'overdue';
      // Pior caso: dias do período mais antigo vencido
      const oldest = expiredPeriods[0];
      const oldestConcessiveEnd = addMonths(oldest.endDate, 12);
      aggregatedDaysOverdue = Math.floor((now - oldestConcessiveEnd) / 86400000);
    }

    return {
      success: true,
      data: {
        teacherId,
        teacherName: teacher.name,
        teacherType: teacher.type,
        currentPeriod: current,
        status: aggregatedStatus,
        currentStatusOnly: status,  // mantém status do current pra UI específica se precisar
        grantPeriod: { deadlineDate: grantDeadline, daysOverdue: aggregatedDaysOverdue },
        expiredPeriodsCount,
        history,
        estimatedStartDate: !(teacher.hireDate || teacher.internshipStartDate),
      },
    };
  },

  /**
   * Lista saldos de todos os professores ativos (não eventuais).
   * @param options.unitId — filtra por unidade (opcional)
   */
  async getAllBalances({ unitId } = {}) {
    let q = db.collection('teachers').where('isActive', '==', true);
    const snap = await q.get();
    const teachers = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.type !== 'eventual')
      .filter(t => !unitId || t.primaryUnitId === unitId || (t.unitIds || []).includes(unitId));

    const results = await Promise.all(teachers.map(t => this.getBalance(t.id)));
    return {
      success: true,
      data: results.filter(r => r.success).map(r => r.data),
    };
  },

  /**
   * Lista professores com status='overdue' (férias vencidas).
   */
  async listOverdueTeachers() {
    const all = await this.getAllBalances();
    if (!all.success) return all;
    return { success: true, data: all.data.filter(b => b.status === 'overdue') };
  },

  /**
   * Varredura idempotente: detecta férias vencidas e grava 1 audit log por dia.
   * Dedup via metaDayKey='YYYY-MM-DD'.
   */
  async checkAndLogOverdue() {
    const overdue = await this.listOverdueTeachers();
    if (!overdue.success || overdue.data.length === 0) return { success: true, logged: 0 };

    const todayKey = new Date().toISOString().slice(0, 10);
    const uid = currentUserId();
    if (!uid) return { success: false, error: 'Sem usuário autenticado para gerar audit log.' };

    let logged = 0;
    for (const o of overdue.data) {
      // Dedup: já auditou hoje? Usa module='ferias' (índice existe) + filtra client-side
      const snap = await db.collection('audit_log')
        .where('module', '==', 'ferias')
        .where('entityId', '==', o.teacherId)
        .limit(10).get();
      const alreadyLogged = snap.docs.some(d => {
        const a = d.data();
        return a.type === 'vacation_overdue_detected' && a.metaDayKey === todayKey;
      });
      if (alreadyLogged) continue;

      // Escreve diretamente porque AuditService.log não aceita metaDayKey
      await db.collection('audit_log').add({
        type: 'vacation_overdue_detected',
        module: 'ferias',
        details: `Férias vencidas: ${o.teacherName} (${o.grantPeriod.daysOverdue} dias após período concessivo)`,
        entityType: 'teacher',
        entityId: o.teacherId,
        before: null,
        after: {
          teacherName: o.teacherName,
          status: o.status,
          daysOverdue: o.grantPeriod.daysOverdue,
          currentPeriodIndex: o.currentPeriod.index,
        },
        userId: uid,
        userName: currentUserName(),
        role: currentUserRoles(),
        unitId: null,
        timestamp: serverTs(),
        metaDayKey: todayKey,
      });
      logged++;
    }
    return { success: true, logged };
  },
};

// ────────────────────────────────────────────────────────────────────────
// Sprint 9 — Empty state helper
// ────────────────────────────────────────────────────────────────────────

function emptyStateHtml(icon, title, suggestion) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      ${suggestion ? '<div class="empty-suggestion">' + escapeHtml(suggestion) + '</div>' : ''}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════
// Sprint 8 — ReportService
// ═══════════════════════════════════════════════════════════════════════

function isInRange(year, month, yearMin, monthMin, yearMax, monthMax) {
  const v = year * 12 + (month || 1);
  const vMin = (yearMin || 2000) * 12 + (monthMin || 1);
  const vMax = (yearMax || yearMin || 2099) * 12 + (monthMax || 12);
  return v >= vMin && v <= vMax;
}

const ReportService = {

  /** R1: Fechamentos Mensais */
  async getFechamentosReport(filters) {
    const { unitId, yearMin, monthMin, yearMax, monthMax } = filters;
    if (!unitId) return { success: false, error: 'Unidade obrigatória.' };

    let q = db.collection('monthly_closings').where('unitId', '==', unitId);
    const snap = await q.get();
    const closings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => isInRange(c.year, c.month, yearMin, monthMin, yearMax, monthMax))
      .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));

    if (closings.length === 0) {
      return { success: false, error: 'Nenhum fechamento encontrado pra esses filtros.' };
    }

    const rows = [];
    for (const c of closings) {
      for (const t of (c.teachers || [])) {
        rows.push({
          year: c.year, month: c.month,
          monthLabel: `${String(c.month).padStart(2, '0')}/${c.year}`,
          teacherName: t.teacherName, teacherType: t.teacherType,
          classesCount: t.classesCount || 0,
          totalHoras: t.totalHoras || 0,
          valorHoras: t.valorHoras || 0,
          mealAllowance: t.mealAllowance || 0,
          transportAllowance: t.transportAllowance || 0,
          otherBenefits: t.otherBenefits || 0,
          vacationValue: t.vacationValue || 0,
          isVacationOnly: t.isVacationOnly || false,
          valorTotal: (t.valorTotal || 0) + (t.vacationValue || 0),
        });
      }
    }

    return {
      success: true,
      data: {
        title: closings.length === 1
          ? `Fechamento — Unidade ${unitId} — ${String(closings[0].month).padStart(2, '0')}/${closings[0].year}`
          : `Fechamentos — Unidade ${unitId} — ${rows.length} linhas (${closings.length} meses)`,
        generatedAt: new Date(),
        filters,
        columns: [
          { key: 'monthLabel',    label: 'Mês',       width: 10 },
          { key: 'teacherName',   label: 'Professor', width: 30 },
          { key: 'teacherType',   label: 'Tipo',      width: 12 },
          { key: 'classesCount',  label: 'Aulas',     width: 8,  type: 'number' },
          { key: 'totalHoras',    label: 'Horas',     width: 8,  type: 'number' },
          { key: 'valorHoras',    label: 'Valor Horas', width: 14, type: 'currency' },
          { key: 'mealAllowance', label: 'VR',        width: 10, type: 'currency' },
          { key: 'transportAllowance', label: 'VT',   width: 10, type: 'currency' },
          { key: 'otherBenefits', label: 'Outros',    width: 10, type: 'currency' },
          { key: 'vacationValue', label: 'Férias',    width: 12, type: 'currency' },
          { key: 'valorTotal',    label: 'Total',     width: 14, type: 'currency', bold: true },
        ],
        rows,
        summary: {
          totalRows: rows.length,
          totalClassesCount: rows.reduce((s, r) => s + r.classesCount, 0),
          totalHoras: rows.reduce((s, r) => s + r.totalHoras, 0),
          totalValor: rows.reduce((s, r) => s + r.valorTotal, 0),
        },
      },
    };
  },

  /** R2: Saldos de Férias */
  async getSaldosFeriasReport(filters) {
    const { unitId, teacherType, statusFilter } = filters;
    const all = await VacationBalanceService.getAllBalances({ unitId });
    if (!all.success) return all;

    let data = all.data;
    if (teacherType) data = data.filter(b => b.teacherType === teacherType);
    if (statusFilter && statusFilter !== 'todos') data = data.filter(b => b.status === statusFilter);

    if (data.length === 0) {
      return { success: false, error: 'Nenhum professor encontrado pra esses filtros.' };
    }

    const rows = data.map(b => ({
      teacherName: b.teacherName,
      teacherType: b.teacherType,
      periodIndex: b.currentPeriod ? b.currentPeriod.index : 0,
      periodStart: b.currentPeriod ? b.currentPeriod.startDate.toLocaleDateString('pt-BR') : '—',
      periodEnd: b.currentPeriod ? b.currentPeriod.endDate.toLocaleDateString('pt-BR') : '—',
      entitledDays: b.currentPeriod ? b.currentPeriod.entitledDays : 30,
      daysTaken: b.currentPeriod ? b.currentPeriod.daysTaken : 0,
      daysRemaining: b.currentPeriod ? b.currentPeriod.daysRemaining : 30,
      status: b.status,
      estimatedStartDate: b.estimatedStartDate,
    }));

    const byStatus = { ok: 0, warning: 0, overdue: 0 };
    rows.forEach(r => { if (byStatus[r.status] !== undefined) byStatus[r.status]++; });

    return {
      success: true,
      data: {
        title: `Saldos de Férias — ${rows.length} professores`,
        generatedAt: new Date(),
        filters,
        columns: [
          { key: 'teacherName',    label: 'Professor',   width: 30 },
          { key: 'teacherType',    label: 'Tipo',         width: 12 },
          { key: 'periodIndex',    label: 'Período',      width: 8,  type: 'number' },
          { key: 'periodStart',    label: 'Início',       width: 14 },
          { key: 'periodEnd',      label: 'Fim',          width: 14 },
          { key: 'entitledDays',   label: 'Direito',      width: 10, type: 'number' },
          { key: 'daysTaken',      label: 'Tirados',      width: 10, type: 'number' },
          { key: 'daysRemaining',  label: 'Restantes',    width: 10, type: 'number' },
          { key: 'status',         label: 'Status',       width: 14 },
        ],
        rows,
        summary: { totalProfessors: rows.length, ok: byStatus.ok, warning: byStatus.warning, overdue: byStatus.overdue },
      },
    };
  },

  /** R3: Horas por Professor */
  async getHorasPorProfessorReport(filters) {
    const { unitId, teacherId, dateStart, dateEnd } = filters;
    if (!dateStart || !dateEnd) return { success: false, error: 'Período obrigatório.' };

    const start = new Date(dateStart);
    const end = new Date(dateEnd);
    end.setHours(23, 59, 59, 999);

    let q = db.collection('classes')
      .where('scheduledDate', '>=', firebase.firestore.Timestamp.fromDate(start))
      .where('scheduledDate', '<=', firebase.firestore.Timestamp.fromDate(end));
    const snap = await q.get();
    let classes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtros client-side
    if (unitId) classes = classes.filter(c => c.unitId === unitId);
    if (teacherId) classes = classes.filter(c => c.teacherId === teacherId);

    // Só aulas com conteúdo (realizada, substituição)
    classes = classes.filter(c => ['realizada', 'substituida'].includes(c.status));
    classes.sort((a, b) => {
      const da = a.scheduledDate ? a.scheduledDate.toDate().getTime() : 0;
      const db2 = b.scheduledDate ? b.scheduledDate.toDate().getTime() : 0;
      return da - db2 || (a.teacherName || '').localeCompare(b.teacherName || '');
    });

    if (classes.length === 0) {
      // Segundo fallback: buscar por teacherId diretamente (quando especificado)
      if (teacherId) {
        const tSnap = await db.collection('classes')
          .where('teacherId', '==', teacherId)
          .where('scheduledDate', '>=', firebase.firestore.Timestamp.fromDate(start))
          .where('scheduledDate', '<=', firebase.firestore.Timestamp.fromDate(end))
          .get();
        classes = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        classes = classes.filter(c => ['realizada', 'substituida'].includes(c.status));
        classes.sort((a, b) => {
          const da = a.scheduledDate ? a.scheduledDate.toDate().getTime() : 0;
          const db2 = b.scheduledDate ? b.scheduledDate.toDate().getTime() : 0;
          return da - db2;
        });
      }

      if (classes.length === 0) {
        return { success: false, error: 'Nenhuma aula encontrada pra esses filtros.' };
      }
    }

    // Sprint 8 fix: classes não denormalizam teacherName/teacherType/value.
    // Precisamos buscar teachers + teacher_salaries pra preencher esses dados.
    const teacherIdsToLookup = [...new Set(classes.map(c => c.teacherId).filter(Boolean))];
    const teacherMap = {};
    const salaryMap = {};
    await Promise.all(teacherIdsToLookup.map(async (tid) => {
      try {
        const tDoc = await db.collection('teachers').doc(tid).get();
        if (tDoc.exists) teacherMap[tid] = { id: tDoc.id, ...tDoc.data() };
        const sDoc = await db.collection('teacher_salaries').doc(tid).get();
        if (sDoc.exists) salaryMap[tid] = { id: sDoc.id, ...sDoc.data() };
      } catch (_) {}
    }));

    // Buscar modalities pra resolver nome (cache simples)
    const modalityIds = [...new Set(classes.map(c => c.modalityId).filter(Boolean))];
    const modalityMap = {};
    await Promise.all(modalityIds.map(async (mid) => {
      try {
        const mDoc = await db.collection('modalities').doc(mid).get();
        if (mDoc.exists) modalityMap[mid] = mDoc.data().name || '—';
      } catch (_) {}
    }));

    // Agrupa por professor
    const groups = {};
    for (const c of classes) {
      const key = c.teacherId || 'desconhecido';
      const teacher = teacherMap[key];
      const salary = salaryMap[key];
      // Sprint 8 fix v2: pegar taxa horária correta conforme tipo do prof.
      // - Efetivo: hourlyRate
      // - Estagiário: internProportionalHourlyRate · fallback internMonthlyStipend/internMonthlyLimitHours
      const classDate = c.scheduledDate ? c.scheduledDate.toDate() : new Date();
      let hourlyRate = 0;
      let eff = null;
      if (salary && typeof getEffectiveSalaryAt === 'function') {
        eff = getEffectiveSalaryAt(salary, classDate);
      } else {
        eff = salary;
      }
      const isIntern = teacher && teacher.type === 'estagiario';
      if (eff) {
        if (isIntern) {
          if (typeof eff.internProportionalHourlyRate === 'number' && eff.internProportionalHourlyRate > 0) {
            hourlyRate = eff.internProportionalHourlyRate;
          } else if (typeof eff.internMonthlyStipend === 'number' && eff.internMonthlyStipend > 0
                     && typeof eff.internMonthlyLimitHours === 'number' && eff.internMonthlyLimitHours > 0) {
            hourlyRate = eff.internMonthlyStipend / eff.internMonthlyLimitHours;
          }
        } else if (typeof eff.hourlyRate === 'number' && eff.hourlyRate > 0) {
          hourlyRate = eff.hourlyRate;
        }
      }

      if (!groups[key]) {
        groups[key] = {
          teacherId: key,
          teacherName: teacher ? (teacher.name || 'Desconhecido') : 'Desconhecido',
          teacherType: teacher ? (teacher.type || '—') : '—',
          totalHoras: 0,
          totalValor: 0,
          classesCount: 0,
          details: [],
          // Sprint 9 fix: flag pra UI exibir "Sem cadastro salarial" em vez de R$ 0,00
          noSalaryData: !salary || hourlyRate === 0,
        };
      }
      // Sprint 9 fix: se algum cálculo de aula posterior tiver hourlyRate > 0, desfaz a flag
      if (hourlyRate > 0) groups[key].noSalaryData = false;
      const horas = (c.durationMinutes || 60) / 60;
      const valor = hourlyRate > 0 ? Math.round(horas * hourlyRate * 100) / 100 : 0;
      groups[key].totalHoras += horas;
      groups[key].totalValor += valor;
      groups[key].classesCount++;
      groups[key].details.push({
        date: c.scheduledDate ? c.scheduledDate.toDate().toLocaleDateString('pt-BR') : '—',
        modalityName: modalityMap[c.modalityId] || '—',
        startTime: c.startTime || '—',
        durationMin: c.durationMinutes || 60,
        horas,
        valor,
        status: c.status,
        isSubstitution: c.isSubstitution || c.status === 'substituida',
      });
    }

    const summaryRows = Object.values(groups)
      .map(g => ({
        teacherName: g.teacherName,
        teacherType: g.teacherType,
        classesCount: g.classesCount,
        totalHoras: Math.round(g.totalHoras * 10) / 10,
        totalValor: Math.round(g.totalValor * 100) / 100,
        // Sprint 9 fix: propaga flag pro renderer
        noSalaryData: g.noSalaryData,
      }))
      .sort((a, b) => b.totalValor - a.totalValor);

    return {
      success: true,
      data: {
        title: `Horas por Professor — ${new Date(dateStart).toLocaleDateString('pt-BR')} a ${new Date(dateEnd).toLocaleDateString('pt-BR')}`,
        generatedAt: new Date(),
        filters,
        summaryColumns: [
          { key: 'teacherName',  label: 'Professor',    width: 30 },
          { key: 'teacherType',  label: 'Tipo',          width: 12 },
          { key: 'classesCount', label: 'Aulas',         width: 8,  type: 'number' },
          { key: 'totalHoras',   label: 'Horas',         width: 8,  type: 'number' },
          { key: 'totalValor',   label: 'Valor Total',   width: 14, type: 'currency', bold: true },
        ],
        rows: summaryRows,
        details: groups,
        summary: {
          totalProfessors: summaryRows.length,
          totalClasses: summaryRows.reduce((s, r) => s + r.classesCount, 0),
          totalHoras: Math.round(summaryRows.reduce((s, r) => s + r.totalHoras, 0) * 10) / 10,
          totalValor: Math.round(summaryRows.reduce((s, r) => s + r.totalValor, 0) * 100) / 100,
        },
      },
    };
  },

  /** R4: Recibos em Lote — retorna dados pra gerar recibos */
  async getRecibosLoteData(closingId) {
    const doc = await db.collection('monthly_closings').doc(closingId).get();
    if (!doc.exists) return { success: false, error: 'Fechamento não encontrado.' };
    const closing = { id: doc.id, ...doc.data() };

    const profs = (closing.teachers || []).filter(t => t.valorTotal > 0 || (t.vacationValue || 0) > 0);
    if (profs.length === 0) {
      return { success: false, error: 'Nenhum professor com valor a receber neste fechamento.' };
    }

    // Sprint 8 fix: renderizador genérico exige columns + rows. Sem isso,
    // d.rows.length jogava TypeError e preview ficava em "Carregando...".
    const rows = profs.map(p => ({
      teacherName: p.teacherName || '—',
      teacherType: p.teacherType || '—',
      classesCount: p.classesCount || 0,
      totalHoras: Math.round((p.totalHoras || 0) * 10) / 10,
      valorTotal: Math.round(((p.valorTotal || 0) + (p.vacationValue || 0)) * 100) / 100,
    }));

    return {
      success: true,
      data: {
        title: `Recibos — ${String(closing.month).padStart(2, '0')}/${closing.year} — ${closing.unitId}`,
        generatedAt: new Date(),
        filters: { closingId, unitId: closing.unitId, month: closing.month, year: closing.year },
        closing,
        profs,
        columns: [
          { key: 'teacherName',  label: 'Professor', width: 30 },
          { key: 'teacherType',  label: 'Tipo',      width: 12 },
          { key: 'classesCount', label: 'Aulas',     width: 8,  type: 'number' },
          { key: 'totalHoras',   label: 'Horas',     width: 8,  type: 'number' },
          { key: 'valorTotal',   label: 'Total',     width: 14, type: 'currency', bold: true },
        ],
        rows,
        summary: {
          totalRecibos: profs.length,
          totalValor: Math.round(profs.reduce((s, p) => s + (p.valorTotal || 0) + (p.vacationValue || 0), 0) * 100) / 100,
        },
      },
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// Expor para depuração via console
// ────────────────────────────────────────────────────────────────────────
window.ReportService = ReportService;
window.VacationBalanceService = VacationBalanceService;
window.ModalityService = ModalityService;
window.UnitService     = UnitService;
window.TeacherService  = TeacherService;
window.SalaryService   = SalaryService;
window.AuditService    = AuditService;
window.ScheduleTemplateService = ScheduleTemplateService;
window.ScheduleSlotService     = ScheduleSlotService;
window.ClassService            = ClassService;
window.NotificationService     = NotificationService;
window.SubstitutionService     = SubstitutionService;
window.CoverageService         = CoverageService;
window.ClosingService         = ClosingService;
window.ReceiptService         = ReceiptService;
window.PaymentService         = PaymentService;
window.CreditService          = CreditService;
window.SpecialScaleService    = SpecialScaleService;
window.VacationService        = VacationService;
window.VacationPaymentService = VacationPaymentService;
window.ProfHelpers     = {
  mascararCpf, getInitials, avatarHtml, internAlertHtml, fmt, formatDate, toTimestamp, escapeHtml,
  // Sprint 2 — helpers de horário
  timeToMinutes, minutesToTime, minutesBetween, slotsOverlap, detectSlotConflict,
  WEEKDAY_LABEL, WEEKDAY_LABEL_SHORT,
  // Sprint 3a — helpers de data + constantes de classe
  getStartOfWeek, getEndOfWeek, ymdFromDate, formatDateBR,
  CLASS_STATUS_LABEL, CLASS_STATUS_COLOR,
  // Sprint 3b — constantes de notif/sub/cov
  // Sprint 6a — VacationService
  VacationService, validateVacationRequest,
  VACATION_ANTECEDENCIA_EFETIVO: ANTECEDENCIA_EFETIVO,
  VACATION_ANTECEDENCIA_ESTAGIARIO: ANTECEDENCIA_ESTAGIARIO,
  NOTIF_TYPE_META, SUBSTITUTION_STATUS_LABEL, COVERAGE_STATUS_LABEL,
  // Sprint 4a — helpers de fechamento
  calculateTeacherHours, calculateTeacherValue, getEffectiveSalaryAt,
  // Sprint 6b — VacationPaymentService
  VacationPaymentService, getEffectiveStipendAt,
  // Sprint 4b — serviços de pagamento/recibo/crédito
  ReceiptService, PaymentService, CreditService,
  // Sprint 6c — VacationBalanceService + helpers de período aquisitivo
  VacationBalanceService, getEntitlementStartDate, addMonths, listAcquisitionPeriods, findCurrentPeriod,
  // Sprint 8 — ReportService
  ReportService, emptyStateHtml,
};

console.log('[CrossTainer Professores] professores-shared.js carregado · Services Sprint 1+1.5+2+3a+3b (todos)');
