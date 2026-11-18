#!/usr/bin/env node
/*
 * Claude Code PreToolUse hook：保護不該手改的東西（只在 Claude Code 編輯檔案／跑指令時觸發，不影響工具本身）
 *
 *   1. 版本號佔位符 __APP_VERSION__（以及停用偵測守衛 '__APP_' + 'VERSION__'）
 *      → 編輯後數量變少 ＝ 有人把佔位符換成真實版本字串或刪掉 → 拒絕（deny）。
 *        版本號由 CI（deploy-pages.yml）在部署時自動戳，見 CLAUDE.md「軟體版本戳記是自動的」。
 *   2. thermal_db_backup*.json（驗證用的真實資料備份）→ 要使用者確認（ask）。
 *   3. .github/workflows/deploy-pages.yml（負責戳版本號與部署）→ 要使用者確認（ask）。
 *   4. Bash：sed -i／重導向／rm／mv 碰到上面這些 → 要使用者確認（ask）。
 *
 * 腳本本身出錯 → 放行（exit 0），不會因為 hook 壞掉而卡住正常工作。
 */
const fs = require('fs');
const path = require('path');

const PLACEHOLDERS = ['__APP_VERSION__', "'__APP_' + 'VERSION__'"];
const BACKUP_RE = /(^|[\\/])thermal_db_backup[^\\/]*\.json$/i;
const DEPLOY_RE = /(^|[\\/])\.github[\\/]workflows[\\/]deploy-pages\.ya?ml$/i;

function count(s) {
  if (typeof s !== 'string') return 0;
  return PLACEHOLDERS.reduce((n, p) => n + s.split(p).length - 1, 0);
}

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function checkFileTool(name, inp) {
  const fp = inp.file_path || '';
  if (BACKUP_RE.test(fp)) {
    decide('ask', `${path.basename(fp)} 是驗證用的真實資料備份，通常不該修改。確定要改嗎？`);
  }
  if (DEPLOY_RE.test(fp)) {
    decide('ask', 'deploy-pages.yml 負責自動戳版本號與部署 GitHub Pages，改錯會讓版本提醒失效或部署失敗。確定要改嗎？');
  }

  let before = 0, after = 0;
  if (name === 'Edit') {
    before = count(inp.old_string);
    after = count(inp.new_string);
  } else if (name === 'MultiEdit') {
    for (const e of inp.edits || []) { before += count(e.old_string); after += count(e.new_string); }
  } else if (name === 'Write') {
    let old = '';
    try { old = fs.readFileSync(fp, 'utf8'); } catch (e) { old = ''; }
    before = count(old);
    after = count(inp.content);
  }
  if (after < before) {
    decide('deny',
      '這次編輯會移除版本號佔位符 __APP_VERSION__（或停用偵測守衛 \'__APP_\' + \'VERSION__\'）。' +
      '版本號由 CI 部署時自動戳，原始碼裡必須保留佔位符（CLAUDE.md「軟體版本戳記是自動的，不要手改」）。' +
      '請改寫成不動到佔位符的編輯。');
  }
}

function checkBash(inp) {
  const cmd = String(inp.command || '');
  const inplace = /\b(sed|perl)\b[^|;&]*\s-[a-zA-Z]*i/.test(cmd);
  if (inplace && /__APP_/.test(cmd)) {
    decide('ask', '這個指令會就地改寫並碰到 __APP_VERSION__ 佔位符（版本號應由 CI 自動戳）。確定要執行嗎？');
  }
  const touchesBackup =
    (inplace && /thermal_db_backup/i.test(cmd)) ||
    />>?\s*["']?[^\s;&|]*thermal_db_backup/i.test(cmd) ||
    /\b(rm|mv|truncate)\b[^|;&]*thermal_db_backup/i.test(cmd) ||
    /\bcp\b[^|;&]*\s["']?[^\s;&|]*thermal_db_backup[^\s;&|]*["']?\s*($|[;&|])/i.test(cmd);
  if (touchesBackup) {
    decide('ask', '這個指令會修改、移動或刪除 thermal_db_backup*.json（驗證用的真實資料備份）。確定要執行嗎？');
  }
  const touchesDeploy =
    (inplace && /deploy-pages\.ya?ml/i.test(cmd)) ||
    />>?\s*["']?[^\s;&|]*deploy-pages\.ya?ml/i.test(cmd) ||
    /\b(rm|mv)\b[^|;&]*deploy-pages\.ya?ml/i.test(cmd);
  if (touchesDeploy) {
    decide('ask', '這個指令會修改或刪除 deploy-pages.yml（負責戳版本號與部署）。確定要執行嗎？');
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');
    const name = data.tool_name;
    const inp = data.tool_input || {};
    if (name === 'Edit' || name === 'MultiEdit' || name === 'Write') checkFileTool(name, inp);
    else if (name === 'Bash') checkBash(inp);
  } catch (e) {
    // hook 自己出錯 → 放行
  }
  process.exit(0);
});
