import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { assert, id, now, normalizeExperience, validateExperienceInput } from './types.mjs';
import { parseMarkdown, serializeMarkdown } from './markdown.mjs';

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
const readJson = async (p, fallback = null) => {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
};
const writeJson = async (p, value) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, p);
};

export function createStore(root = process.env.WORKBENCH_DATA_DIR || path.join(import.meta.dirname, '..', 'local-data')) {
  const base = path.join(path.resolve(root), 'v5');
  const paths = {
    base,
    experiences: path.join(base, 'experiences'),
    questions: path.join(base, 'questions'),
    runs: path.join(base, 'runs'),
    debug: path.join(base, 'debug'),
  };
  const store = {
    root: path.resolve(root),
    paths,
    async init() {
      await fs.mkdir(paths.experiences, { recursive: true });
      await fs.mkdir(paths.questions, { recursive: true });
      await fs.mkdir(paths.runs, { recursive: true });
      await fs.mkdir(paths.debug, { recursive: true });
      return store;
    },
    expDir(expId) { return path.join(paths.experiences, safe(expId)); },
    experiencePath(expId) { return path.join(store.expDir(expId), 'experience.json'); },
    rawDir(expId) { return path.join(store.expDir(expId), 'raw'); },
    draftPath(expId) { return path.join(store.expDir(expId), 'draft.json'); },
    markdownPath(expId) { return path.join(store.expDir(expId), 'content.md'); },
    async createExperience(input) {
      validateExperienceInput(input);
      await store.init();
      const expId = id('exp', 8);
      const exp = {
        experience_id: expId, ...normalizeExperience(input),
        evidence_rev: 0, created_at: now(), confirmed_at: null,
      };
      await fs.mkdir(store.rawDir(expId), { recursive: true });
      await writeJson(store.experiencePath(expId), exp);
      return exp;
    },
    async listExperiences() {
      await store.init();
      const dirs = await fs.readdir(paths.experiences, { withFileTypes: true });
      const out = [];
      for (const d of dirs.filter((x) => x.isDirectory())) {
        const exp = await readJson(store.experiencePath(d.name), null);
        if (exp) out.push(exp);
      }
      return out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    },
    async readExperience(expId) {
      const exp = await readJson(store.experiencePath(expId), null);
      assert(exp, 'EXPERIENCE_NOT_FOUND', `经历不存在: ${expId}`);
      return exp;
    },
    async saveExperience(exp) {
      assert(exp?.experience_id, 'INVALID_EXPERIENCE', '缺少 experience_id');
      await writeJson(store.experiencePath(exp.experience_id), exp);
      return exp;
    },
    async appendRaw(expId, text) {
      const exp = await store.readExperience(expId);
      assert(String(text ?? '').trim().length >= 1, 'INVALID_RAW', '输入不能为空');
      assert(String(text).length <= 30000, 'INVALID_RAW', '单次输入过长（≤30000 字符）');
      const raw = { raw_id: id('raw', 8), experience_id: exp.experience_id, text: String(text), at: now() };
      await writeJson(path.join(store.rawDir(expId), `${raw.raw_id}.json`), raw);
      return raw;
    },
    async listRaw(expId = null) {
      const exps = expId ? [await store.readExperience(expId)] : await store.listExperiences();
      const out = [];
      for (const exp of exps) {
        const dir = store.rawDir(exp.experience_id);
        let files = [];
        try { files = await fs.readdir(dir); } catch {}
        for (const f of files.filter((x) => x.endsWith('.json')).sort()) {
          const r = await readJson(path.join(dir, f), null);
          if (r) out.push(r);
        }
      }
      return out;
    },
    async rawTextFor(expId) {
      const rows = await store.listRaw(expId);
      return rows.map((r) => r.text).join('\n\n');
    },
    async saveDraft(expId, draft) {
      await fs.mkdir(store.expDir(expId), { recursive: true });
      await writeJson(store.draftPath(expId), draft);
      return draft;
    },
    async readDraft(expId) { return readJson(store.draftPath(expId), null); },
    async writeMarkdown(expId, model) {
      const text = serializeMarkdown(model);
      await fs.mkdir(store.expDir(expId), { recursive: true });
      await fs.writeFile(store.markdownPath(expId), text, 'utf8');
      return text;
    },
    async readMarkdown(expId) {
      try { return await fs.readFile(store.markdownPath(expId), 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
    },
    async readModel(expId) {
      const text = await store.readMarkdown(expId);
      return text ? parseMarkdown(text, { experience_id: expId }) : null;
    },
    async bumpEvidence(expId) {
      const exp = await store.readExperience(expId);
      exp.evidence_rev = Number(exp.evidence_rev || 0) + 1;
      exp.updated_at = now();
      await store.saveExperience(exp);
      return exp.evidence_rev;
    },
    async loadLibrary() {
      const exps = await store.listExperiences();
      const library = [];
      for (const exp of exps) {
        const text = await store.readMarkdown(exp.experience_id);
        let model = null;
        if (text) {
          try { model = parseMarkdown(text, { experience_id: exp.experience_id }); }
          catch (e) { model = { error: e.message, experience: exp, stories: [], fragments: [] }; }
        }
        library.push({ ...exp, markdown: text, model, stories: model?.stories ?? [], fragments: model?.fragments ?? [] });
      }
      return library;
    },
    questionPath(scope, target) {
      const key = scope === 'experience' ? `experience-${safe(target)}` : `resume-${safe(target)}`;
      return path.join(paths.questions, `${key}.json`);
    },
    async saveQuestions(scope, target, payload) {
      assert(['experience', 'resume'].includes(scope), 'INVALID_QUESTION_SCOPE', 'scope 必须是 experience/resume');
      const next = {
        scope, target, evidence_rev: payload.evidence_rev ?? 0,
        updated_at: now(), questions: payload.questions ?? [],
      };
      await writeJson(store.questionPath(scope, target), next);
      return next;
    },
    async loadQuestions(scope, target) {
      return readJson(store.questionPath(scope, target), { scope, target, evidence_rev: 0, questions: [] });
    },
    async listQuestions(scope = null, target = null) {
      await store.init();
      const files = await fs.readdir(paths.questions);
      const out = [];
      for (const f of files.filter((x) => x.endsWith('.json'))) {
        const q = await readJson(path.join(paths.questions, f), null);
        if (!q) continue;
        if (scope && q.scope !== scope) continue;
        if (target && q.target !== target) continue;
        out.push(q);
      }
      return out;
    },
    async saveRun(run) {
      assert(run?.run_id, 'INVALID_RUN', '缺少 run_id');
      await writeJson(path.join(paths.runs, `${run.run_id}.json`), run);
      return run;
    },
    async loadRun(runId) {
      const run = await readJson(path.join(paths.runs, `${runId}.json`), null);
      assert(run, 'RUN_NOT_FOUND', `run 不存在: ${runId}`);
      return run;
    },
    async listRuns() {
      await store.init();
      const files = await fs.readdir(paths.runs);
      const out = [];
      for (const f of files.filter((x) => x.endsWith('.json'))) out.push(await readJson(path.join(paths.runs, f), null));
      return out.filter(Boolean).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    async debug(node, data) {
      await fs.mkdir(paths.debug, { recursive: true });
      const file = path.join(paths.debug, `${new Date().toISOString().replace(/[:.]/g, '-')}-${safe(node)}.json`);
      await writeJson(file, { node, at: now(), ...data });
      return file;
    },
  };
  return store;
}

export { readJson, writeJson };
