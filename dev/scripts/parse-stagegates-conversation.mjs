#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HELP = `Parse a long conversation about stagegates-to-projects conversion into structured JSON.

Usage:
  node dev/scripts/parse-stagegates-project-conversation.mjs --input <file>
  node dev/scripts/parse-stagegates-project-conversation.mjs --input <file> --format auto --pretty
  node dev/scripts/parse-stagegates-project-conversation.mjs --stdin --format markdown --output parsed.json

Input formats:
  auto      Detect from file extension/content
  openclaw  OpenClaw/OpenAI-style JSONL transcripts with message events
  markdown  Plain text or markdown transcripts
  text      Alias for markdown

Output:
  JSON document with:
  - transcript metadata and message list
  - stagegate/project mapping candidates
  - decisions, action items, questions, risks, and timeline events
  - summary statistics for follow-up work

Options:
  --input <file>     Input transcript path
  --stdin            Read transcript from stdin
  --format <name>    auto | openclaw | markdown | text
  --output <file>    Write JSON output to file
  --pretty           Pretty-print JSON output
  --help             Show this help
`;

function parseArgs(argv) {
  const args = { format: 'auto', pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--input':
        args.input = argv[++i];
        break;
      case '--stdin':
        args.stdin = true;
        break;
      case '--format':
        args.format = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--pretty':
        args.pretty = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readInput(args) {
  if (args.stdin) {
    return fs.readFileSync(0, 'utf8');
  }
  if (!args.input) {
    throw new Error('Missing --input <file> or --stdin');
  }
  return fs.readFileSync(args.input, 'utf8');
}

function detectFormat(raw, inputPath, explicitFormat) {
  if (explicitFormat && explicitFormat !== 'auto') {
    if (explicitFormat === 'text') return 'markdown';
    return explicitFormat;
  }

  const ext = inputPath ? path.extname(inputPath).toLowerCase() : '';
  if (ext === '.jsonl') return 'openclaw';
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return 'markdown';

  const firstNonEmptyLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0) || '';
  try {
    const parsed = JSON.parse(firstNonEmptyLine);
    if (parsed && typeof parsed === 'object' && parsed.type && parsed.message) {
      return 'openclaw';
    }
  } catch {
    // Fall back to markdown.
  }
  return 'markdown';
}

function normaliseText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        return '';
      })
      .join('\n')
      .trim();
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim();
    if (Array.isArray(value.content)) return normaliseText(value.content);
  }
  return '';
}

function parseOpenClawJsonl(raw) {
  const messages = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const message = parsed?.message;
    if (!message || typeof message !== 'object') continue;

    const text = normaliseText(message.content);
    if (!text) continue;

    messages.push({
      role: message.role || parsed.role || 'unknown',
      timestamp: parsed.timestamp || message.timestamp || null,
      text,
      source: parsed.type || 'jsonl-message',
    });
  }
  return messages;
}

function normaliseRole(rawRole) {
  const role = rawRole.trim().toLowerCase();
  if (['user', 'assistant', 'system', 'developer', 'tester', 'reviewer', 'architect', 'orchestrator', 'human', 'bot'].includes(role)) {
    return role;
  }
  return rawRole.trim();
}

function parseMarkdownTranscript(raw) {
  const lines = raw.split(/\r?\n/);
  const messages = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    current.text = current.text.join('\n').trim();
    if (current.text) messages.push(current);
    current = null;
  };

  for (const line of lines) {
    const timestampMatch = line.match(/^\s*\[(.*?)\]\s*([^:|\-]{1,80})\s*[:|-]\s*(.*)$/i);
    if (timestampMatch) {
      flush();
      current = {
        role: normaliseRole(timestampMatch[2]),
        timestamp: timestampMatch[1],
        text: [timestampMatch[3]],
        source: 'markdown-timestamp-speaker-line',
      };
      continue;
    }

    const match = line.match(/^\s*([^:|\-]{1,80})\s*[:|-]\s*(.*)$/i);
    if (match) {
      flush();
      current = {
        role: normaliseRole(match[1]),
        timestamp: null,
        text: [match[2]],
        source: 'markdown-speaker-line',
      };
      continue;
    }

    if (!current) {
      current = {
        role: 'unknown',
        timestamp: null,
        text: [line],
        source: 'markdown-block',
      };
    } else {
      current.text.push(line);
    }
  }

  flush();
  return messages;
}

function findQuotedListItem(text, prefixes) {
  const lines = text.split(/\r?\n/);
  const results = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const bullet = trimmed.replace(/^[-*\d.)\s]+/, '');
    for (const prefix of prefixes) {
      if (bullet.toLowerCase().startsWith(prefix)) {
        results.push(bullet);
        break;
      }
    }
  }
  return results;
}

function cleanIdentifier(value) {
  return value.replace(/[.,;:!?]+$/g, '').trim();
}

function collectStagegateProjectMappings(text) {
  const mappings = [];
  const patterns = [
    /\bstagegate\s+([a-z0-9._/-]+)\s+(?:->|=>|to|maps to|becomes|should become)\s+(?:project\s+)?([a-z0-9._/-]+)/gi,
    /\bproject\s+([a-z0-9._/-]+)\s+(?:covers|owns|replaces)\s+stagegate\s+([a-z0-9._/-]+)/gi,
  ];

  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      if (patternIndex === 0) {
        mappings.push({ stagegate: cleanIdentifier(match[1]), project: cleanIdentifier(match[2]), confidence: 'explicit' });
      } else {
        mappings.push({ stagegate: cleanIdentifier(match[2]), project: cleanIdentifier(match[1]), confidence: 'explicit' });
      }
    }
  }

  return mappings;
}

function collectTaggedSentences(text, tag) {
  const results = [];
  for (const sentence of splitSentences(text)) {
    if (sentence.toLowerCase().includes(tag)) {
      results.push(sentence.trim());
    }
  }
  return results;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyMessage(message) {
  const lower = message.text.toLowerCase();
  const actionItems = [];
  const decisions = [];
  const questions = [];
  const risks = [];
  const mappings = collectStagegateProjectMappings(message.text);

  if (/\b(action item|todo|to do|next step|follow up|we should|need to)\b/.test(lower)) {
    for (const sentence of splitSentences(message.text)) {
      if (/\b(action item|todo|to do|next step|follow up|we should|need to)\b/i.test(sentence)) {
        actionItems.push(sentence.trim());
      }
    }
  }

  if (/\b(decide|decision|agreed|agreement|resolved|we will|we'll)\b/.test(lower)) {
    for (const sentence of splitSentences(message.text)) {
      if (/\b(decide|decision|agreed|agreement|resolved|we will|we'll)\b/i.test(sentence)) {
        decisions.push(sentence.trim());
      }
    }
  }

  if (/\?/.test(message.text) || /\b(open question|unclear|unknown)\b/.test(lower)) {
    for (const sentence of splitSentences(message.text)) {
      if (sentence.includes('?') || /\b(open question|unclear|unknown)\b/i.test(sentence)) {
        questions.push(sentence.trim());
      }
    }
  }

  if (/\b(risk|concern|blocker|problem|issue|tradeoff|trade-off)\b/.test(lower)) {
    for (const sentence of splitSentences(message.text)) {
      if (/\b(risk|concern|blocker|problem|issue|tradeoff|trade-off)\b/i.test(sentence)) {
        risks.push(sentence.trim());
      }
    }
  }

  return { actionItems, decisions, questions, risks, mappings };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueMappings(mappings) {
  const seen = new Set();
  const results = [];
  for (const mapping of mappings) {
    const key = `${mapping.stagegate}=>${mapping.project}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(mapping);
  }
  return results;
}

function buildOutput(messages, format, inputPath) {
  const extracted = {
    decisions: [],
    actionItems: [],
    openQuestions: [],
    risks: [],
    stagegateProjectMappings: [],
    timeline: [],
  };

  messages.forEach((message, index) => {
    const classified = classifyMessage(message);
    extracted.decisions.push(...classified.decisions.map((text) => ({ text, messageIndex: index, role: message.role })));
    extracted.actionItems.push(...classified.actionItems.map((text) => ({ text, messageIndex: index, role: message.role })));
    extracted.openQuestions.push(...classified.questions.map((text) => ({ text, messageIndex: index, role: message.role })));
    extracted.risks.push(...classified.risks.map((text) => ({ text, messageIndex: index, role: message.role })));
    extracted.stagegateProjectMappings.push(...classified.mappings.map((mapping) => ({ ...mapping, messageIndex: index, role: message.role })));

    if (message.timestamp) {
      extracted.timeline.push({ timestamp: message.timestamp, role: message.role, summary: message.text.slice(0, 200), messageIndex: index });
    }
  });

  const roleCounts = messages.reduce((acc, message) => {
    acc[message.role] = (acc[message.role] || 0) + 1;
    return acc;
  }, {});

  const highlights = {
    decisions: uniqueStrings(extracted.decisions.map((item) => item.text)),
    actionItems: uniqueStrings(extracted.actionItems.map((item) => item.text)),
    openQuestions: uniqueStrings(extracted.openQuestions.map((item) => item.text)),
    risks: uniqueStrings(extracted.risks.map((item) => item.text)),
    stagegateProjectMappings: uniqueMappings(extracted.stagegateProjectMappings),
  };

  return {
    meta: {
      inputPath: inputPath || null,
      format,
      parsedAt: new Date().toISOString(),
      messageCount: messages.length,
      roleCounts,
    },
    messages,
    extracted,
    highlights,
    guidance: {
      notes: [
        'Mapping extraction is heuristic and should be reviewed by a human before execution.',
        'Plain-text transcripts without explicit speakers are grouped into block messages.',
        'For richer extraction, keep speaker labels or use OpenClaw JSONL session transcripts.',
      ],
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const raw = readInput(args);
  const format = detectFormat(raw, args.input, args.format);
  const messages = format === 'openclaw' ? parseOpenClawJsonl(raw) : parseMarkdownTranscript(raw);
  const output = buildOutput(messages, format, args.input);
  const serialised = JSON.stringify(output, null, args.pretty ? 2 : 0);

  if (args.output) {
    fs.writeFileSync(args.output, serialised + '\n', 'utf8');
  } else {
    process.stdout.write(serialised + '\n');
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
