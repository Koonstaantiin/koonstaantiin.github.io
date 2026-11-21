// =========================================================================
// 2. WORD & PUNCTUATION LCS DIFF ENGINE
// Chrome Side Panel Extension (chrome_plugin/sidepanel.html)
// =========================================================================

function tokenizeWithLeadingSpace(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const tokens = [];
  const regex = /([ \t]*)(\n+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-])/gu;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    tokens.push({
      space: match[1] || '',
      val: match[2],
      isNewline: /^\n+$/.test(match[2]),
      isPunct: !/^\n+$/.test(match[2]) && !/^[\p{L}\p{N}_'’-]+$/u.test(match[2])
    });
  }
  return tokens;
}

function computeWordDiff(originalText, correctedText) {
  const origTokens = tokenizeWithLeadingSpace(originalText);
  const corrTokens = tokenizeWithLeadingSpace(correctedText);
  const n = origTokens.length;
  const m = corrTokens.length;

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (origTokens[i].val === corrTokens[j].val) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawOps = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (origTokens[i].val === corrTokens[j].val) {
      rawOps.push({ type: 'equal', token: corrTokens[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawOps.push({ type: 'del', token: origTokens[i] });
      i++;
    } else {
      rawOps.push({ type: 'ins', token: corrTokens[j] });
      j++;
    }
  }
  while (i < n) {
    rawOps.push({ type: 'del', token: origTokens[i++] });
  }
  while (j < m) {
    rawOps.push({ type: 'ins', token: corrTokens[j++] });
  }

  const blocks = [];
  let idx = 0;
  while (idx < rawOps.length) {
    if (rawOps[idx].type === 'equal') {
      blocks.push({
        type: 'equal',
        tokens: [rawOps[idx].token]
      });
      idx++;
    } else {
      const delTokens = [];
      const insTokens = [];
      while (idx < rawOps.length && rawOps[idx].type !== 'equal') {
        if (rawOps[idx].type === 'del') {
          delTokens.push(rawOps[idx].token);
        } else {
          insTokens.push(rawOps[idx].token);
        }
        idx++;
      }
      blocks.push({
        type: 'change',
        delTokens,
        insTokens
      });
    }
  }

  return blocks;
}

function joinTokensText(tokens, includeFirstLeadingSpace = false) {
  return tokens
    .map((t, idx) => (idx === 0 && !includeFirstLeadingSpace ? '' : t.space) + t.val)
    .join('');
}

function buildDiffHtml(originalText, correctedText, mode = 'wavy') {
  const rawBlocks = computeWordDiff(originalText, correctedText);

  const blocks = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const cur = rawBlocks[i];
    if (
      mode === 'wavy' &&
      cur.type === 'change' &&
      cur.insTokens.length === 0 &&
      cur.delTokens.length > 0
    ) {
      const next = rawBlocks[i + 1];
      if (next && next.type === 'equal' && next.tokens[0] && !next.tokens[0].isPunct && !next.tokens[0].isNewline) {
        blocks.push({
          type: 'change',
          delTokens: [...cur.delTokens, ...next.tokens],
          insTokens: [...next.tokens],
          deletedOnlyText: joinTokensText(cur.delTokens, false)
        });
        i++;
        continue;
      }
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'equal' && prev.tokens[0] && !prev.tokens[0].isPunct && !prev.tokens[0].isNewline) {
        blocks[blocks.length - 1] = {
          type: 'change',
          delTokens: [...prev.tokens, ...cur.delTokens],
          insTokens: [...prev.tokens],
          deletedOnlyText: joinTokensText(cur.delTokens, false)
        };
        continue;
      }
    }
    blocks.push(cur);
  }

  let changeCount = 0;

  const htmlParts = blocks.map(block => {
    if (block.type === 'equal') {
      const t = block.tokens[0];
      return safeEscapeHtml(t.space + t.val);
    }

    changeCount++;
    const delStr = joinTokensText(block.delTokens, false);
    const insStr = joinTokensText(block.insTokens, false);

    const leadingSpace = block.insTokens.length > 0
      ? block.insTokens[0].space
      : (block.delTokens.length > 0 ? block.delTokens[0].space : '');

    const dataAttrs = `data-diff-del="${safeEscapeHtml(delStr.toLowerCase())}" data-diff-ins="${safeEscapeHtml(insStr.toLowerCase())}"`;
    const titleAttr = block.deletedOnlyText
      ? ` title="Видалено: «${safeEscapeHtml(block.deletedOnlyText)}»"`
      : '';

    if (mode === 'wavy') {
      if (!insStr) {
        return '';
      }
      return `${safeEscapeHtml(leadingSpace)}<span class="diff-wavy-added proofread-diff-span" ${dataAttrs}${titleAttr}>${safeEscapeHtml(insStr)}</span>`;
    } else {
      let chunk = safeEscapeHtml(leadingSpace);
      if (delStr) {
        chunk += `<span class="diff-inline-del proofread-diff-span" ${dataAttrs}>${safeEscapeHtml(delStr)}</span>`;
      }
      if (insStr) {
        chunk += `<span class="diff-inline-ins proofread-diff-span" ${dataAttrs}>${safeEscapeHtml(insStr)}</span>`;
      }
      return chunk;
    }
  });

  return {
    html: htmlParts.join(''),
    changeCount
  };
}
