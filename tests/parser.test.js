const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Import functions to test (will create later)
const { scanExamples, parseLLMFile, parseExample } = require('../view.js');

describe('scanExamples', () => {
  test('should return array of examples from examples directory', () => {
    const examples = scanExamples();

    assert.ok(Array.isArray(examples), 'should return an array');
    assert.ok(examples.length > 0, 'should have at least one example');
  });

  test('each example should have id and name properties', () => {
    const examples = scanExamples();
    const example = examples[0];

    assert.ok(example.id, 'example should have id');
    assert.ok(example.name, 'example should have name');
    assert.strictEqual(typeof example.id, 'string');
    assert.strictEqual(typeof example.name, 'string');
  });

  test('should ignore non-directory files like .DS_Store', () => {
    const examples = scanExamples();

    // All examples should be directories (id should match directory pattern)
    examples.forEach(ex => {
      assert.match(ex.id, /^\d+_/, 'id should start with number prefix');
    });
  });
});

describe('parseLLMFile', () => {
  test('should parse LLM Request file', () => {
    const testFile = path.join(__dirname, '../examples/01_explain-this-repo-and-dump-to-contentmd/llm/[1885] Request - api.anthropic.com_v1_messages.txt');

    if (fs.existsSync(testFile)) {
      const parsed = parseLLMFile(testFile);

      assert.ok(parsed, 'should return parsed data');
      assert.strictEqual(parsed.type, 'request', 'should identify as request');
      assert.strictEqual(parsed.timestamp, 1885, 'should extract timestamp');
      assert.ok(parsed.endpoint, 'should have endpoint');
    }
  });

  test('should parse LLM Response file', () => {
    const testFile = path.join(__dirname, '../examples/01_explain-this-repo-and-dump-to-contentmd/llm/[1885] Response - api.anthropic.com_v1_messages.txt');

    if (fs.existsSync(testFile)) {
      const parsed = parseLLMFile(testFile);

      assert.ok(parsed, 'should return parsed data');
      assert.strictEqual(parsed.type, 'response', 'should identify as response');
      assert.strictEqual(parsed.timestamp, 1885, 'should extract timestamp');
    }
  });
});

describe('parseExample', () => {
  test('should parse complete example directory', () => {
    const exampleId = '01_explain-this-repo-and-dump-to-contentmd';
    const parsed = parseExample(exampleId);

    assert.ok(parsed, 'should return parsed data');
    assert.strictEqual(parsed.id, exampleId, 'should have correct id');
    assert.ok(Array.isArray(parsed.llmTraces), 'should have llmTraces array');
  });

  test('llmTraces should be sorted by timestamp', () => {
    const exampleId = '01_explain-this-repo-and-dump-to-contentmd';
    const parsed = parseExample(exampleId);

    const timestamps = parsed.llmTraces.map(t => t.timestamp);
    const sorted = [...timestamps].sort((a, b) => a - b);

    assert.deepStrictEqual(timestamps, sorted, 'timestamps should be in ascending order');
  });
});
